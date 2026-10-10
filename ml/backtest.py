"""Walk-forward backtest of the Vantage disruption model.

Task (per chokepoint-day t, using data up to t only):
  "Will this chokepoint enter a sustained disruption (7-day mean >= 30% below its pre-event
   baseline, for 7 straight days) at some point in the next H days (H = 7 and 14)?"

Walk-forward: one fold per calendar quarter from 2022Q1. Each fold trains only on rows whose labels are fully
resolved before the quarter starts (purge gap = H + 8 days). Probabilities are calibrated (isotonic) on
*cross-fitted* out-of-fold predictions from the training window (blocked time folds, purged), and the alert
thresholds are tuned on the most recent 2 years of those out-of-fold predictions. Nothing from the test quarter
is used for fitting, calibrating or tuning. No random splits, no future leakage.

Two model families are evaluated side by side (see ml/README.md for how production was chosen):
  logit : regularised logistic regression on 14 robust features (exports as plain coefficients)
  lgbm  : LightGBM, 26 features (exports as JSON trees)

Compared alert systems (all pass through the same persistence + hysteresis logic):
  naive   : alert if the 7-day mean is > X% below the 90-day median            (X tuned on the tuning window)
  naive15 : the same with X fixed at 15%
  app     : the traffic score shipped in lib/signals.ts before this work (score >= 25, i.e. drop >= 19.2%)
  vantage : observed-drop rule (X tuned) OR model probability >= T (T tuned)

Lead time is measured against the first day traffic visibly degrades (7-day mean < 85% of baseline), so a
system that only reacts to the drop scores about 0 and only a genuine early warning scores > 0.

Run:  python ml/backtest.py [logit|lgbm|both]
"""
from __future__ import annotations

import json
import sys
import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import RobustScaler

import features as F

warnings.filterwarnings("ignore")
SEED = 42
ROOT = F.ROOT
OUT = ROOT / "ml" / "out"
FAR_TARGET = 0.03            # day-level false-alarm rate budget (alerts on days with no disruption ahead)
EPISODE_BUDGET = 1.0         # false alert episodes per chokepoint-year budget
N_ON, N_OFF = 2, 3           # persistence: 2 raw days to raise; 3 clear days to drop (hysteresis)
FIRST_TEST = pd.Timestamp("2022-01-01")
TUNE_DAYS = 730
OOF_BLOCKS = 5
X_GRID = [0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40]
T_GRID = [0.02, 0.03, 0.05, 0.08, 0.12, 0.18, 0.25, 0.35, 0.50, 0.70, 1.01]

LOGIT_FEATURES = ["r7", "r14", "slope14", "accel", "rz7", "drawdown60", "vol28", "global_r7", "global_frac_low", "peer_r7", "cape_r7", "news_log", "news_surge", "tanker_share_chg"]
LGBM_PARAMS = dict(
    n_estimators=220, learning_rate=0.04, num_leaves=8, max_depth=4, min_child_samples=60, subsample=0.8, subsample_freq=1,
    colsample_bytree=0.8, reg_lambda=5.0, random_state=SEED, deterministic=True, force_row_wise=True, n_jobs=1, verbose=-1,
)
LOGIT_C = 0.05


# ---------------------------------------------------------------- model families
def features_of(kind: str) -> list[str]:
    return LOGIT_FEATURES if kind == "logit" else F.FEATURES


def new_model(kind: str):
    if kind == "logit":
        return make_pipeline(SimpleImputer(strategy="median"), RobustScaler(), LogisticRegression(C=LOGIT_C, class_weight="balanced", max_iter=1000, random_state=SEED))
    return lgb.LGBMClassifier(**LGBM_PARAMS)


def normal_rows(df: pd.DataFrame, H: int) -> pd.DataFrame:
    return df[df["valid"] & (df["r7"] >= F.NORMAL_R7) & df[f"y{H}"].notna()]


def fit_model(kind: str, train: pd.DataFrame, H: int):
    t = normal_rows(train, H)
    return new_model(kind).fit(t[features_of(kind)], t[f"y{H}"].astype(int))


def predict(kind: str, model, df: pd.DataFrame) -> np.ndarray:
    return model.predict_proba(df[features_of(kind)])[:, 1]


def cross_fit_oof(kind: str, train: pd.DataFrame, H: int) -> np.ndarray:
    """Out-of-fold probabilities for every row of `train` (blocked time folds, purged around each block)."""
    purge = pd.Timedelta(days=H + F.RUN + 1)
    dates = np.sort(train["date"].unique())
    edges = np.array_split(dates, OOF_BLOCKS)
    oof = np.full(len(train), np.nan)
    for blk in edges:
        lo, hi = blk[0], blk[-1]
        in_blk = ((train["date"] >= lo) & (train["date"] <= hi)).values
        near = ((train["date"] >= lo - purge) & (train["date"] <= hi + purge)).values
        fit = train[~near]
        if normal_rows(fit, H)[f"y{H}"].sum() < 3:
            continue
        m = fit_model(kind, fit, H)
        oof[in_blk] = predict(kind, m, train[in_blk])
    return oof


# ---------------------------------------------------------------- alert logic
def alert_state_2d(raw: np.ndarray, n_on: int = N_ON, n_off: int = N_OFF) -> np.ndarray:
    """Persistence + hysteresis, vectorised over series: raw is (T, S) booleans."""
    T, S = raw.shape
    out = np.zeros((T, S), bool)
    on = np.zeros(S, bool)
    up = np.zeros(S, int)
    down = np.zeros(S, int)
    for i in range(T):
        r = raw[i]
        up = np.where(r, up + 1, 0)
        down = np.where(r, 0, down + 1)
        on = np.where(~on & (up >= n_on), True, np.where(on & (down >= n_off), False, on))
        out[i] = on
    return out


def apply_alerts(df: pd.DataFrame, raw) -> np.ndarray:
    """df sorted by (portname, date) with identical date ranges per series."""
    raw = np.asarray(raw, bool)
    S = df["portname"].nunique()
    T = len(df) // S
    assert S * T == len(df)
    return alert_state_2d(raw.reshape(S, T).T).T.reshape(-1)


def raw_naive(df, x):
    return ((1 - df["r7"]) > x).values & df["valid"].values


def raw_app(df):                 # exactly lib/signals.ts trafficSignal() >= 25
    chg = df["app_change_pct"]
    score = np.where(chg < -15, np.minimum(90, np.round(-chg * 1.3)), 0)
    return (score >= 25) & (df["app_baseline"] >= 3).values & df["valid"].values


def raw_vantage(df, x, t, p):
    normal = (df["r7"] >= 1 - x).values
    return raw_naive(df, x) | (normal & (p >= t) & df["valid"].values)


# ---------------------------------------------------------------- metrics
def day_metrics(y: np.ndarray, a: np.ndarray) -> dict:
    tp, fp = int((a & (y == 1)).sum()), int((a & (y == 0)).sum())
    fn, tn = int((~a & (y == 1)).sum()), int((~a & (y == 0)).sum())
    prec = tp / (tp + fp) if tp + fp else float("nan")
    rec = tp / (tp + fn) if tp + fn else float("nan")
    f1 = 2 * prec * rec / (prec + rec) if tp and prec + rec else 0.0
    far = fp / (fp + tn) if fp + tn else float("nan")
    return dict(tp=tp, fp=fp, fn=fn, tn=tn, precision=prec, recall=rec, f1=f1, false_alarm_rate=far)


def false_episodes(df: pd.DataFrame, alert: np.ndarray, H: int) -> tuple[int, int, float]:
    """Alert episodes (rising edges); an episode is false if no disruption is in progress or starts within H days."""
    S = df["portname"].nunique()
    T = len(df) // S
    a = alert.reshape(S, T)
    y = df[f"y_all{H}"].values.reshape(S, T)
    edges = a & ~np.concatenate([np.zeros((S, 1), bool), a[:, :-1]], axis=1)
    tot = int(edges.sum())
    fa = int((edges & (y == 0)).sum())
    years = df["valid"].sum() / 365.25
    return tot, fa, fa / years if years else float("nan")


def event_metrics(df: pd.DataFrame, alert: np.ndarray, H: int) -> dict:
    """Event-level. Event = fresh sustained disruption; its visible start = first day of the r7<0.85 run leading into it.
    lead_days = visible start - first alert day inside [start-H, onset]; > 0 means warned before traffic visibly fell."""
    d = df.assign(alert=alert)
    detail, leads = [], []
    for name, g in d.groupby("portname"):
        g = g.reset_index(drop=True)
        for i in np.where((g["onset"] == 1) & g["valid"])[0]:
            j = i
            while j > 0 and i - j < 30 and g.loc[j - 1, "r7"] < F.NORMAL_R7:
                j -= 1
            start = g.loc[j, "date"]
            onset = g.loc[i, "date"]
            win = g[(g["date"] >= start - pd.Timedelta(days=H)) & (g["date"] <= onset)]
            hit = win[win["alert"]]
            row = dict(portname=name, visible_start=start.strftime("%Y-%m-%d"), onset=onset.strftime("%Y-%m-%d"))
            if len(hit):
                lead = int((start - hit["date"].iloc[0]).days)
                leads.append(lead)
                row.update(detected=True, lead_days=lead, first_alert=hit["date"].iloc[0].strftime("%Y-%m-%d"))
            else:
                row.update(detected=False)
            detail.append(row)
    tot, fa, per_year = false_episodes(df, alert, H)
    n = len(detail)
    return dict(
        events=n, detected=len(leads), detected_recall=len(leads) / n if n else float("nan"),
        warned_early=int(sum(1 for l in leads if l >= 1)), warned_early_recall=sum(1 for l in leads if l >= 1) / n if n else float("nan"),
        median_lead_days=float(np.median(leads)) if leads else float("nan"),
        alert_episodes=tot, false_alert_episodes=fa, false_alerts_per_chokepoint_year=per_year, detail=detail,
    )


# ---------------------------------------------------------------- calibration and tuning
def fit_calibrator(p: np.ndarray, y: np.ndarray):
    if y.sum() < 3:
        return None
    return IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip", increasing=True).fit(p, y)


def calibrate(iso, p):
    return np.asarray(p) if iso is None else iso.predict(p)


def tune(win: pd.DataFrame, p: np.ndarray, H: int):
    """Operating points from the tuning window (out-of-fold predictions only).
    naive: X maximising F1 under the day-level false-alarm budget.
    vantage: (X, T) maximising early-warning recall (normal-state days) under BOTH budgets: day FAR and false episodes/yr."""
    y = win[f"y_all{H}"].values
    ok = ~np.isnan(y)
    early = (win["r7"] >= F.NORMAL_R7).values & ok
    best_n = None
    for x in X_GRID:
        a = apply_alerts(win, raw_naive(win, x))
        m = day_metrics(y[ok], a[ok])
        if m["false_alarm_rate"] <= FAR_TARGET and (best_n is None or m["f1"] > best_n[0]):
            best_n = (m["f1"], x)
    best_v = None
    for x in X_GRID:
        for t in T_GRID:
            a = apply_alerts(win, raw_vantage(win, x, t, p))
            m = day_metrics(y[ok], a[ok])
            _, _, per_year = false_episodes(win, a, H)
            if m["false_alarm_rate"] <= FAR_TARGET and per_year <= EPISODE_BUDGET:
                e = day_metrics(y[early], a[early])
                key = (e["tp"], m["f1"])
                if best_v is None or key > best_v[0]:
                    best_v = (key, x, t)
    x_naive = best_n[1] if best_n else X_GRID[-1]
    return x_naive, (best_v[1] if best_v else X_GRID[-1]), (best_v[2] if best_v else 1.01)


def add_all_labels(ft: pd.DataFrame) -> pd.DataFrame:
    """y_all{H}: any sustained disruption in (t, t+H] OR one already in progress (what a user cares about)."""
    ft = ft.copy()
    for H in (7, 14):
        inprog = (ft["r7"] < 1 - F.DROP) & (ft["r28"] < 1 - F.DROP + 0.1)
        ft[f"y_all{H}"] = np.where(ft[f"y{H}"].isna(), np.nan, np.maximum(ft[f"y{H}"].values, inprog.values.astype(float)))
    return ft


def fit_for_cutoff(kind: str, ft: pd.DataFrame, end: pd.Timestamp, H: int):
    """Everything a deployed model needs, using only rows dated <= end: model, calibrator, thresholds."""
    train = ft[ft["date"] <= end]
    oof = cross_fit_oof(kind, train, H)
    nm = (train["valid"] & (train["r7"] >= F.NORMAL_R7) & train[f"y{H}"].notna()).values & ~np.isnan(oof)
    iso = fit_calibrator(oof[nm], train.loc[nm, f"y{H}"].values)
    p_oof = np.where(np.isnan(oof), 0.0, calibrate(iso, np.nan_to_num(oof)))
    win_mask = (train["date"] > end - pd.Timedelta(days=TUNE_DAYS)).values
    win = train[win_mask]
    x_naive, x_v, t_v = tune(win, p_oof[win_mask], H)
    model = fit_model(kind, train, H)
    return model, iso, x_naive, x_v, t_v


def run(kind: str, H: int, ft: pd.DataFrame, verbose=True):
    purge = pd.Timedelta(days=H + F.RUN + 1)
    rows, picks = [], []
    for q in pd.period_range(FIRST_TEST, ft["date"].max(), freq="Q"):
        q0, q1 = q.start_time, q.end_time.normalize()
        end = q0 - purge
        ctx = ft[(ft["date"] >= q0 - pd.Timedelta(days=30)) & (ft["date"] <= q1)]
        if ft[ft["date"] <= end]["valid"].sum() < 5000 or ctx[f"y{H}"].notna().sum() < 100:
            continue
        model, iso, x_naive, x_v, t_v = fit_for_cutoff(kind, ft, end, H)
        pt_raw = predict(kind, model, ctx)
        pt = calibrate(iso, pt_raw)
        tc = ctx.assign(p_raw=pt_raw, p=pt)
        tc["raw_naive"] = raw_naive(tc, x_naive)
        tc["raw_naive15"] = raw_naive(tc, 0.15)
        tc["raw_app"] = raw_app(tc)
        tc["raw_vantage"] = raw_vantage(tc, x_v, t_v, pt)
        for c in ("naive", "naive15", "app", "vantage"):
            tc[f"alert_{c}"] = apply_alerts(tc, tc[f"raw_{c}"].values)
        tc = tc[tc["date"] >= q0].assign(fold=str(q))
        rows.append(tc)
        picks.append(dict(fold=str(q), x_naive=x_naive, x_vantage=x_v, t_vantage=t_v))
        if verbose:
            print(f"  {kind} H={H} {q}: x_naive={x_naive:.2f} x_v={x_v:.2f} T={t_v:.2f}", flush=True)
    return pd.concat(rows), picks


def summarize(res: pd.DataFrame, H: int) -> dict:
    out = {}
    res = res.sort_values(["portname", "date"]).reset_index(drop=True)      # uniform (series x days) layout for episode counting
    ok = res[res[f"y_all{H}"].notna() & res["valid"]]
    y = ok[f"y_all{H}"].values
    early = (ok["r7"] >= F.NORMAL_R7).values
    for name in ("naive", "naive15", "app", "vantage"):
        a = ok[f"alert_{name}"].values
        out[name] = dict(all_days=day_metrics(y, a), early_warning_stratum=day_metrics(y[early], a[early]), events=event_metrics(res, res[f"alert_{name}"].values, H))
    nm = ok[(ok["r7"] >= F.NORMAL_R7) & ok[f"y{H}"].notna()]
    yy, p, pr = nm[f"y{H}"].values, nm["p"].values, nm["p_raw"].values
    base = yy.mean()
    out["probability"] = dict(
        n=int(len(yy)), base_rate=float(base), positives=int(yy.sum()),
        brier_calibrated=float(brier_score_loss(yy, p)), brier_uncalibrated=float(brier_score_loss(yy, pr)),
        brier_climatology=float(brier_score_loss(yy, np.full_like(p, base))),
        brier_skill=float(1 - brier_score_loss(yy, p) / brier_score_loss(yy, np.full_like(p, base))),
        roc_auc=float(roc_auc_score(yy, p)), pr_auc=float(average_precision_score(yy, p)), pr_auc_lift=float(average_precision_score(yy, p) / base),
    )
    q = pd.qcut(nm["p"], 10, duplicates="drop")
    cal = nm.assign(bin=q).groupby("bin", observed=True).agg(mean_pred=("p", "mean"), observed=(f"y{H}", "mean"), n=("p", "size"))
    out["calibration_curve"] = cal.reset_index(drop=True).to_dict("records")
    return out


def main():
    kinds = ["logit", "lgbm"] if len(sys.argv) < 2 or sys.argv[1] == "both" else [sys.argv[1]]
    OUT.mkdir(parents=True, exist_ok=True)
    ft = add_all_labels(F.build())
    ft.to_pickle(OUT / "features.pkl")
    for kind in kinds:
        report = {"model": kind, "seed": SEED, "far_target": FAR_TARGET, "episode_budget_per_chokepoint_year": EPISODE_BUDGET,
                  "persistence": {"on_days": N_ON, "off_days": N_OFF}, "folds_from": str(FIRST_TEST.date()), "features": features_of(kind)}
        for H in (7, 14):
            print(f"== {kind} horizon {H} days ==", flush=True)
            res, picks = run(kind, H, ft)
            res.to_pickle(OUT / f"test_predictions_{kind}_H{H}.pkl")
            report[f"H{H}"] = summarize(res, H) | {"operating_points": picks, "test_rows": int(res["valid"].sum())}
        (OUT / f"metrics_{kind}.json").write_text(json.dumps(report, indent=1, default=float))
        print("wrote", OUT / f"metrics_{kind}.json", flush=True)


if __name__ == "__main__":
    main()
