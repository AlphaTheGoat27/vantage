"""Model-family comparison on the same walk-forward folds (early-warning stratum, H=14).

Why: LightGBM could not extrapolate to a never-seen event type (Red Sea 2023). Does a smoother model do better?
Run: python ml/compare_models.py
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import RobustScaler

import backtest as B
import features as F

warnings.filterwarnings("ignore")
H = 14
SMALL = ["r7", "r14", "slope14", "accel", "rz7", "drawdown60", "vol28", "global_r7", "global_frac_low", "peer_r7", "cape_r7", "news_log", "news_surge", "tanker_share_chg"]


def make(kind):
    if kind == "lgbm":
        return None
    return make_pipeline(SimpleImputer(strategy="median"), RobustScaler(), LogisticRegression(C=0.05, class_weight="balanced", max_iter=500))


def main():
    ft = pd.read_pickle(B.OUT / "features.pkl")
    out = {}
    for kind, cols in (("lgbm", F.FEATURES), ("logit_all", F.FEATURES), ("logit_small", SMALL), ("logit_small_nonews", [c for c in SMALL if not c.startswith("news")])):
        ps, ys, rs = [], [], []
        for q in pd.period_range(B.FIRST_TEST, ft["date"].max(), freq="Q"):
            q0, q1 = q.start_time, q.end_time.normalize()
            end = q0 - pd.Timedelta(days=H + F.RUN + 1)
            fit = ft[(ft["date"] <= end) & ft["valid"] & (ft["r7"] >= F.NORMAL_R7) & ft[f"y{H}"].notna()]
            test = ft[(ft["date"] >= q0) & (ft["date"] <= q1) & ft["valid"] & (ft["r7"] >= F.NORMAL_R7) & ft[f"y{H}"].notna()]
            if len(fit) < 3000 or test.empty or fit[f"y{H}"].sum() < 5:
                continue
            if kind == "lgbm":
                m = B.fit_model(ft[ft["date"] <= end], H)
                p = m.predict_proba(test[F.FEATURES])[:, 1]
            else:
                m = make(kind).fit(fit[cols], fit[f"y{H}"].astype(int))
                p = m.predict_proba(test[cols])[:, 1]
            ps.append(p); ys.append(test[f"y{H}"].values); rs.append(test[["date", "portname"]].assign(p=p))
        p, y = np.concatenate(ps), np.concatenate(ys)
        r = pd.concat(rs)
        redsea = r[(r.portname == "Bab el-Mandeb Strait") & (r.date >= "2023-11-15") & (r.date <= "2023-12-20")]["p"]
        out[kind] = dict(auc=roc_auc_score(y, p), pr_auc=average_precision_score(y, p), base=y.mean(), redsea_pmax_nov15_dec20=float(redsea.max()), redsea_p_dec01=float(r[(r.portname == "Bab el-Mandeb Strait") & (r.date == "2023-12-01")]["p"].iloc[0]))
        print(kind, {k: round(v, 4) for k, v in out[kind].items()})


if __name__ == "__main__":
    main()
