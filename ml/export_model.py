"""Train the production model and export it as JSON that lib/model.ts evaluates on Vercel (no Python at runtime).

Recipe is identical to one backtest fold, with "test" = the future:
  fit  : rows whose labels resolved at least 365 days before the cut-off
  val  : the last 365 labelled days -> isotonic calibration + operating-point tuning
Also exports the quantile forecast models and a parity fixture (python features/probabilities for a few
real chokepoint-days) that `node lib/model.test.mjs` checks the TypeScript port against.

Run:  python ml/export_model.py
"""
from __future__ import annotations

import json
import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd

import backtest as B
import features as F
import forecast as FC

warnings.filterwarnings("ignore")
H = 14
MODEL_OUT = F.ROOT / "lib" / "data" / "vantage-model.json"
FIXTURE_OUT = F.ROOT / "lib" / "data" / "model-fixture.json"


def compact(node: dict) -> dict:
    if "leaf_value" in node:
        return {"v": round(node["leaf_value"], 9)}
    thr = node["threshold"]
    mt = node["missing_type"]
    nan_left = bool(node["default_left"]) if mt == "NaN" else bool(0.0 <= thr)   # missing_type None: NaN is treated as 0
    return {"f": node["split_feature"], "t": thr, "nl": nan_left, "iv": round(node["internal_value"], 9),
            "l": compact(node["left_child"]), "r": compact(node["right_child"])}


def dump_trees(booster) -> list:
    return [compact(t["tree_structure"]) for t in booster.dump_model()["tree_info"]]


def classifier_json(kind: str, model) -> dict:
    if kind == "lgbm":
        return {"kind": "lgbm", "trees": dump_trees(model.booster_)}
    imp, scaler, lr = model.named_steps["simpleimputer"], model.named_steps["robustscaler"], model.named_steps["logisticregression"]
    return {
        "kind": "logit", "features": B.features_of("logit"),
        "median": [float(v) for v in imp.statistics_], "center": [float(v) for v in scaler.center_], "scale": [float(v) for v in scaler.scale_],
        "coef": [float(v) for v in lr.coef_[0]], "intercept": float(lr.intercept_[0]),
    }


def main(kind: str = "logit"):
    ft = pd.read_pickle(B.OUT / "features.pkl")
    last = ft["date"].max()
    end = last - pd.Timedelta(days=H + F.RUN + 1)          # labels fully resolved
    model, iso, x_naive, x_obs, p_on = B.fit_for_cutoff(kind, ft, end, H)
    train = ft[ft["date"] <= end]
    nrows = B.normal_rows(train, H)

    # forecast models on everything with a resolved target
    qm = FC.fit_quantiles(ft[ft["date"] <= last - pd.Timedelta(days=9)])

    out = {
        "version": 1, "horizonDays": H, "trainedThrough": str(last.date()), "features": F.FEATURES,
        "newsZones": F.NEWS_ZONES, "newsQueries": __import__("download_news").ZONES, "newsBaselineWeeks": F.NEWS_BASE_WEEKS,
        "classifier": classifier_json(kind, model),
        "calibration": {"x": [float(v) for v in iso.X_thresholds_], "y": [float(v) for v in iso.y_thresholds_]} if iso is not None else None,
        "operating": {"observedDrop": x_obs, "probabilityOn": p_on, "persistDays": B.N_ON, "clearDays": B.N_OFF, "normalR7": F.NORMAL_R7, "disruptionDrop": F.DROP},
        "forecast": {f"q{int(q * 100)}": {"trees": dump_trees(m.booster_)} for q, m in qm.items()},
        "training": {"kind": kind, "fitRows": int(len(nrows)), "positives": int(nrows[f"y{H}"].sum()), "farTarget": B.FAR_TARGET, "episodeBudget": B.EPISODE_BUDGET, "seed": B.SEED},
    }
    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    MODEL_OUT.write_text(json.dumps(out, separators=(",", ":")))
    print("model ->", MODEL_OUT, f"{MODEL_OUT.stat().st_size / 1024:.0f} KB", "| kind", kind, "| operating", out["operating"])

    # ---- parity fixture: raw inputs for the last 200 days of every chokepoint + python's features/probabilities ----
    raw = F.load()
    day = last
    window = raw[raw["date"] > day - pd.Timedelta(days=200)]
    inputs = {n: g.sort_values("date")[["date", "n_total", "n_tanker", "n_container", "n_dry_bulk"]].assign(date=lambda d: d["date"].dt.strftime("%Y-%m-%d")).values.tolist()
              for n, g in window.groupby("portname")}
    news = pd.read_csv(F.NEWS).drop_duplicates(["zone", "week_start"])
    news = news[news["week_start"] >= str((day - pd.Timedelta(days=130)).date())]
    snap = ft[ft["date"] == day].set_index("portname")
    exp = {}
    praw = B.predict(kind, model, snap)
    pcal = B.calibrate(iso, praw)
    fq = {f"q{int(q * 100)}": [float(v) for v in m.predict(snap[F.FEATURES])] for q, m in qm.items()}
    for i, n in enumerate(snap.index):
        exp[n] = {"valid": bool(snap.loc[n, "valid"]), "features": {k: (None if pd.isna(v) else float(v)) for k, v in snap.loc[n, F.FEATURES].items()},
                  "pRaw": float(praw[i]), "pCal": float(pcal[i]), "forecast": {k: v[i] for k, v in fq.items()}}
    FIXTURE_OUT.write_text(json.dumps({"asOf": str(day.date()), "inputs": inputs, "news": news.values.tolist(), "expected": exp}, separators=(",", ":")))
    print("fixture ->", FIXTURE_OUT, f"{FIXTURE_OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else "logit")
