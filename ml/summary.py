"""Distil out/metrics_<model>.json into lib/data/backtest-summary.json (shown in the app under Data sources)."""
import json, sys
kind = sys.argv[1] if len(sys.argv) > 1 else "logit"
m = json.load(open(f"out/metrics_{kind}.json"))
f = json.load(open("out/forecast_metrics.json")) if __import__("pathlib").Path("out/forecast_metrics.json").exists() else None
out = {"model": kind, "period": f"{m['folds_from']} to 2026-10", "foldsFrom": m["folds_from"], "farTarget": m["far_target"], "episodeBudget": m["episode_budget_per_chokepoint_year"], "forecast": f}
for H in ("H7", "H14"):
    r = m[H]
    sysm = {}
    for k, label in (("vantage", "Vantage (model + observed)"), ("app", "Previous app scoring"), ("naive15", "Naive: 7d vs 90d drop > 15%"), ("naive", "Naive, tuned")):
        a, ev = r[k]["all_days"], r[k]["events"]
        sysm[k] = {"label": label, "precision": a["precision"], "recall": a["recall"], "f1": a["f1"], "falseAlarmRate": a["false_alarm_rate"], "tp": a["tp"], "fp": a["fp"], "fn": a["fn"], "tn": a["tn"],
                   "events": ev["events"], "detected": ev["detected"], "warnedEarly": ev["warned_early"], "medianLeadDays": ev["median_lead_days"], "falseAlertsPerYear": ev["false_alerts_per_chokepoint_year"]}
    out[H] = {"systems": sysm, "probability": r["probability"], "calibration": r["calibration_curve"], "testRows": r["test_rows"]}
json.dump(out, open("../lib/data/backtest-summary.json", "w"), indent=1, default=float)
print("wrote lib/data/backtest-summary.json")
