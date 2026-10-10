"""Next-7-day transit forecast with prediction intervals (quantile LightGBM), walk-forward.

Target: fut7 = mean transits over days t+1..t+7, relative to the robust 90-day baseline.
Quantiles 0.10 / 0.50 / 0.90 -> an 80% prediction interval.  Baseline to beat: persistence (r7).
Run after backtest.py:  python ml/forecast.py
"""
from __future__ import annotations

import json
import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd

import features as F
from backtest import FIRST_TEST, OUT, SEED

warnings.filterwarnings("ignore")
QS = (0.1, 0.5, 0.9)
PARAMS = dict(n_estimators=200, learning_rate=0.04, num_leaves=8, max_depth=4, min_child_samples=80, subsample=0.8,
              subsample_freq=1, colsample_bytree=0.8, reg_lambda=5.0, random_state=SEED, deterministic=True,
              force_row_wise=True, n_jobs=1, verbose=-1)


def fit_quantiles(train: pd.DataFrame):
    t = train[train["valid"] & train["fut7"].notna()]
    return {q: lgb.LGBMRegressor(objective="quantile", alpha=q, **PARAMS).fit(t[F.FEATURES], t["fut7"]) for q in QS}


def main():
    ft = pd.read_pickle(OUT / "features.pkl")
    rows = []
    for q in pd.period_range(FIRST_TEST, ft["date"].max(), freq="Q"):
        q0, q1 = q.start_time, q.end_time.normalize()
        train = ft[ft["date"] <= q0 - pd.Timedelta(days=9)]            # fut7 of the last training day ends 7 days later
        test = ft[(ft["date"] >= q0) & (ft["date"] <= q1) & ft["valid"] & ft["fut7"].notna()]
        if train["valid"].sum() < 5000 or test.empty:
            continue
        ms = fit_quantiles(train)
        o = test[["date", "portname", "r7", "fut7"]].copy()
        for qq, m in ms.items():
            o[f"q{int(qq * 100)}"] = m.predict(test[F.FEATURES])
        rows.append(o)
    r = pd.concat(rows)
    r["q10"], r["q50"], r["q90"] = np.sort(r[["q10", "q50", "q90"]].values, axis=1).T
    y = r["fut7"]
    summary = dict(
        n=int(len(r)),
        mae_model=float((r["q50"] - y).abs().mean()), mae_persistence=float((r["r7"] - y).abs().mean()),
        coverage_80=float(((y >= r["q10"]) & (y <= r["q90"])).mean()), mean_interval_width=float((r["q90"] - r["q10"]).mean()),
    )
    summary["mae_improvement_pct"] = 100 * (1 - summary["mae_model"] / summary["mae_persistence"])
    # the cases that matter: big drops ahead (fut7 < 0.7)
    big = r[y < 0.7]
    summary["big_drop_n"] = int(len(big))
    summary["big_drop_mae_model"] = float((big["q50"] - big["fut7"]).abs().mean())
    summary["big_drop_mae_persistence"] = float((big["r7"] - big["fut7"]).abs().mean())
    r.to_pickle(OUT / "forecast_predictions.pkl")
    (OUT / "forecast_metrics.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
