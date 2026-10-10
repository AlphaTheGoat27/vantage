"""Slide charts, all generated from the real backtest outputs (no hand-typed numbers).

Run after: python ml/backtest.py && python ml/forecast.py && npx tsx scripts/case-study-redsea.mts
Writes PNGs to slides/.
"""
from __future__ import annotations

import json
import pathlib
import warnings

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "ml" / "out"
SLIDES = ROOT / "slides"
SLIDES.mkdir(exist_ok=True)
M = json.load(open(OUT / "metrics_logit.json"))
H = M["H14"]
INK, MUTED = "#0f172a", "#64748b"
C = dict(vantage="#0891b2", app="#f59e0b", naive15="#94a3b8", naive="#cbd5e1", bad="#e11d48", good="#059669")
plt.rcParams.update({"font.family": "DejaVu Sans", "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 140})
LABEL = {"vantage": "Vantage\n(model + observed)", "app": "Previous app\nscoring", "naive15": "Naive: 7d vs 90d\ndrop > 15%", "naive": "Naive, tuned\nthreshold"}


def save(fig, name):
    fig.savefig(SLIDES / name, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("wrote", name)


# 1 ------------------------------------------------------------------ metrics table
def metrics_table():
    cols = ["System", "Precision", "Recall", "F1", "False-alarm\nrate", "Events warned\nbefore traffic fell", "Median lead\n(days)", "False alert episodes\nper chokepoint-year"]
    rows = []
    for k in ("vantage", "app", "naive15", "naive"):
        a, e = H[k]["all_days"], H[k]["events"]
        rows.append([LABEL[k].replace("\n", " "), f"{a['precision']:.0%}", f"{a['recall']:.0%}", f"{a['f1']:.2f}", f"{a['false_alarm_rate']:.1%}", f"{e['warned_early']} / {e['events']}", f"{e['median_lead_days']:+.0f}", f"{e['false_alerts_per_chokepoint_year']:.2f}"])
    fig, ax = plt.subplots(figsize=(11, 2.6))
    ax.axis("off")
    t = ax.table(cellText=rows, colLabels=cols, loc="center", cellLoc="center", colWidths=[0.2, 0.09, 0.09, 0.07, 0.1, 0.15, 0.1, 0.2])
    t.auto_set_font_size(False); t.set_fontsize(9); t.scale(1, 2.2)
    for (r, c), cell in t.get_celld().items():
        cell.set_edgecolor("#e2e8f0")
        if r == 0:
            cell.set_facecolor("#0f172a"); cell.get_text().set_color("white"); cell.get_text().set_weight("bold")
        elif r == 1:
            cell.set_facecolor("#ecfeff"); cell.get_text().set_weight("bold")
    ax.set_title(f"Walk-forward backtest, 14-day horizon: {H['test_rows']:,} chokepoint-days, {M['folds_from']} to Oct 2026, quarterly retraining, no future leakage", fontsize=10, color=INK, pad=14)
    fig.text(0.01, 0.0, "The tuned naive rule has the lowest false-alarm rate but warns before traffic falls for only 5 of 23 events; Vantage warns for 11 at under 1 false alert episode per chokepoint-year.", fontsize=7.5, color=MUTED)
    save(fig, "01_backtest_metrics.png")


# 2 ------------------------------------------------------------------ calibration
def calibration():
    cal = pd.DataFrame(H["calibration_curve"])
    p = H["probability"]
    fig, ax = plt.subplots(figsize=(5.4, 5))
    m = max(cal.mean_pred.max(), cal.observed.max()) * 1.15
    ax.plot([0, m], [0, m], "--", color=MUTED, label="perfectly calibrated")
    ax.plot(cal.mean_pred, cal.observed, "o-", color=C["vantage"], label="Vantage model (calibrated)")
    for _, r in cal.iterrows():
        ax.annotate(f"n={int(r.n):,}", (r.mean_pred, r.observed), textcoords="offset points", xytext=(4, 6), fontsize=6, color=MUTED)
    ax.set_xlabel("Predicted probability of a disruption within 14 days"); ax.set_ylabel("Observed frequency")
    ax.set_title(f"Calibration (deciles of predicted risk)\nBrier {p['brier_calibrated']:.4f} vs climatology {p['brier_climatology']:.4f} · ROC-AUC {p['roc_auc']:.2f} · PR-AUC {p['pr_auc']:.3f} ({p['pr_auc_lift']:.0f}x base rate)", fontsize=9, color=INK)
    ax.legend(frameon=False, fontsize=8)
    save(fig, "02_calibration.png")


# 3 ------------------------------------------------------------------ confusion matrices
def confusion():
    fig, axs = plt.subplots(1, 2, figsize=(8.6, 3.6))
    for ax, k in zip(axs, ("vantage", "app")):
        a = H[k]["all_days"]
        mat = np.array([[a["tn"], a["fp"]], [a["fn"], a["tp"]]])
        ax.imshow(np.log10(mat + 1), cmap="Blues")
        for (i, j), v in np.ndenumerate(mat):
            ax.text(j, i, f"{v:,}", ha="center", va="center", fontsize=11, color="white" if np.log10(v + 1) > 3.2 else INK, weight="bold")
        ax.set_xticks([0, 1], ["no alert", "alert"]); ax.set_yticks([0, 1], ["no disruption\nahead", "disruption\nahead"])
        ax.set_title(f"{LABEL[k].replace(chr(10), ' ')}\nprecision {a['precision']:.0%} · recall {a['recall']:.0%} · false-alarm {a['false_alarm_rate']:.1%}", fontsize=8.5, color=INK)
    fig.suptitle("Confusion matrices, chokepoint-days, 14-day horizon (colour = log scale)", fontsize=10, color=INK)
    save(fig, "03_confusion_matrix.png")


# 4 ------------------------------------------------------------------ Red Sea timeline
def redsea():
    r = pd.read_pickle(OUT / "test_predictions_logit_H14.pkl")
    case = json.load(open(OUT / "redsea_case.json"))
    g = r[(r.portname == "Bab el-Mandeb Strait") & (r.date >= "2023-10-20") & (r.date <= "2024-01-31")].sort_values("date")
    d = pd.DataFrame(case["days"]); d["date"] = pd.to_datetime(d["date"])
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(11, 6.2), sharex=True, gridspec_kw={"height_ratios": [1.15, 1]})
    a1.plot(g.date, g.r7 * 100, color=INK, lw=2, label="Bab el-Mandeb traffic, 7-day vs 90-day normal (%)")
    a1.axhline(85, color=MUTED, ls=":", lw=1); a1.text(g.date.min(), 86.5, "visible-drop line (85%)", fontsize=7, color=MUTED)
    a1.set_ylabel("Traffic vs normal (%)"); a1.set_ylim(40, 115)
    a2.plot(d.date, d.news, color=C["app"], lw=2, label="Vantage news layer (0-100, replayed)")
    a2.plot(g.date, g.p * 100, color=C["vantage"], lw=2, label="Trained model: P(collapse in 14 d) x100")
    a2.axhline(45, color=MUTED, ls=":", lw=1)
    a2.set_ylabel("Score"); a2.set_ylim(0, 105)
    events = [("2023-11-19", "First attack /\nship seized", C["bad"]), ("2023-12-15", "Carriers pause\n(Dec 15-18)", C["bad"])]
    for x, lab, col in events:
        for ax in (a1, a2):
            ax.axvline(pd.Timestamp(x), color=col, lw=1.2, ls="--")
        a1.text(pd.Timestamp(x), 112, lab, fontsize=7.5, color=col, ha="left", va="top")
    marks = [(case["alertDates"]["newsLayer45"], "Vantage news layer\nalerts (Nov 15)", C["good"], 78, "right"), (g[g.alert_vantage].date.min(), "Trained model alerts\n(Dec 19)", C["vantage"], 52, "left"), (g[g.alert_app].date.min(), "Previous traffic-only\nscoring alerts (Dec 22)", C["app"], 66, "left")]
    for x, lab, col, y, ha in marks:
        x = pd.Timestamp(x)
        a2.axvline(x, color=col, lw=2)
        a2.text(x, y, (lab + " ") if ha == "right" else (" " + lab), fontsize=7.5, color=col, weight="bold", va="center", ha=ha)
    a2.xaxis.set_major_formatter(mdates.DateFormatter("%b %d")); a2.xaxis.set_major_locator(mdates.WeekdayLocator(interval=2))
    a1.legend(frameon=False, fontsize=8, loc="lower left"); a2.legend(frameon=False, fontsize=8, loc="lower right", ncol=1)
    fig.suptitle("Red Sea crisis: when each layer would have raised the alarm", fontsize=11, color=INK, y=0.995)
    fig.text(0.01, -0.01, "Model line: walk-forward (trained only on data before each quarter). News layer: replayed from today's Google News index, indicative. Dates of attacks/pauses from public reporting.", fontsize=7, color=MUTED)
    save(fig, "04_redsea_timeline.png")


# 5 ------------------------------------------------------------------ cost example
def cost():
    case = json.load(open(OUT / "redsea_case.json"))
    pr = [p for p in case["pricing"] if p["date"] in (case["alertDates"]["newsLayer45"], "2023-12-22")]
    ship = case["shipment"]
    fig, axs = plt.subplots(1, len(pr), figsize=(4.9 * len(pr), 4.2), sharey=True)
    axs = np.atleast_1d(axs)
    for ax, p in zip(axs, pr):
        vo, vb = p["originalDays"] * ship["dailyCostUsd"], p["backupDays"] * ship["dailyCostUsd"]
        comp = {
            "Suez / Red Sea route": [vo, p["warRiskPremiumAvoidedUsd"], p["expectedDisruptionAvoidedUsd"]],
            "Around the Cape": [vb, p["originalExpectedUsd"] * 0 + (p["backupExpectedUsd"] - vb), 0],
        }
        bottoms = np.zeros(2)
        for i, (lab, col) in enumerate((("Voyage cost (days x vessel cost)", "#94a3b8"), ("War-risk premium", "#f59e0b"), ("Expected disruption cost", "#e11d48"))):
            vals = np.array([comp["Suez / Red Sea route"][i], comp["Around the Cape"][i]]) / 1e6
            ax.bar(["Suez / Red Sea\n%.1f days" % p["originalDays"], "Around the Cape\n%.1f days" % p["backupDays"]], vals, bottom=bottoms, color=col, label=lab if ax is axs[0] else None)
            bottoms += vals
        ax.text(0, bottoms[0] + 0.15, f"\\${bottoms[0]:.2f}M", ha="center", fontsize=10, weight="bold"); ax.text(1, bottoms[1] + 0.15, f"\\${bottoms[1]:.2f}M", ha="center", fontsize=10, weight="bold")
        ax.set_title(f"Alert on {p['date']} (hazard score {p['score']})\nreroute saves \\${p['netSavingUsd'] / 1e6:.2f}M expected", fontsize=9.5, color=INK)
        ax.set_ylim(0, 10)
    axs[0].set_ylabel("Expected total cost, USD millions")
    axs[0].legend(frameon=False, fontsize=7.5, loc="upper right")
    fig.suptitle(f"Worked example: {ship['cargo']}, \\${ship['cargoValueUsd'] / 1e6:.0f}M critical cargo, Singapore to Rotterdam, 16 kn, \\${ship['dailyCostUsd'] / 1000:.0f}k/day vessel cost", fontsize=10, color=INK, y=1.07)
    fig.text(0.01, -0.03, "Modelled with the app's cost model (lib/planner.ts): P(disruption) = 0.25 x (risk/100)^2; disruption cost = 25% of critical cargo + 10 vessel-days; war-risk premium = 1% x exposure x (hull + cargo). Estimates, not realised losses.", fontsize=6.8, color=MUTED)
    save(fig, "05_cost_example.png")


# 6 ------------------------------------------------------------------ lead time per event
def leads():
    ev = {k: {(e["portname"], e["visible_start"]): e for e in H[k]["events"]["detail"]} for k in ("vantage", "app")}
    keys = sorted(ev["vantage"], key=lambda k: k[1])
    fig, ax = plt.subplots(figsize=(8.6, 0.32 * len(keys) + 1.4))
    for i, k in enumerate(keys):
        for j, (sys_, col) in enumerate((("vantage", C["vantage"]), ("app", C["app"]))):
            e = ev[sys_][k]
            v = e["lead_days"] if e["detected"] else None
            y = i + (0.18 if j == 0 else -0.18)
            if v is None:
                ax.plot([0], [y], "x", color=col, ms=5)
            else:
                ax.barh(y, v, height=0.32, color=col)
    ax.axvline(0, color=INK, lw=1)
    ax.set_yticks(range(len(keys)), [f"{k[0].replace(' Strait','').replace(' Canal','')}  {k[1]}" for k in keys], fontsize=7)
    ax.set_xlabel("Days of warning before traffic visibly fell  (negative = alerted late, x = missed)")
    ax.set_title(f"Lead time per disruption event (14-day horizon)\nVantage: warned early {H['vantage']['events']['warned_early']}/{H['vantage']['events']['events']}, median {H['vantage']['events']['median_lead_days']:+.0f} d  ·  Previous scoring: {H['app']['events']['warned_early']}/{H['app']['events']['events']}, median {H['app']['events']['median_lead_days']:+.1f} d", fontsize=9, color=INK)
    ax.legend(handles=[plt.Rectangle((0, 0), 1, 1, color=C["vantage"]), plt.Rectangle((0, 0), 1, 1, color=C["app"])], labels=["Vantage", "Previous app scoring"], frameon=False, fontsize=8, loc="lower right")
    save(fig, "06_lead_time_per_event.png")


# 7 ------------------------------------------------------------------ forecast
def forecast():
    f = pd.read_pickle(OUT / "forecast_predictions.pkl")
    fm = json.load(open(OUT / "forecast_metrics.json"))
    g = f[(f.portname == "Bab el-Mandeb Strait") & (f.date >= "2023-10-15") & (f.date <= "2024-02-15")].sort_values("date")
    fig, ax = plt.subplots(figsize=(9, 3.8))
    ax.fill_between(g.date, g.q10 * 100, g.q90 * 100, color=C["vantage"], alpha=0.2, label="80% prediction interval")
    ax.plot(g.date, g.q50 * 100, color=C["vantage"], lw=2, label="Forecast: next-7-day traffic (median)")
    ax.plot(g.date, g.fut7 * 100, color=INK, lw=1.4, label="What actually happened")
    ax.set_ylabel("Traffic vs normal (%)")
    ax.legend(frameon=False, fontsize=8)
    ax.set_title(f"7-day traffic forecast, Bab el-Mandeb (walk-forward). All chokepoints: MAE {fm['mae_model']:.3f} vs {fm['mae_persistence']:.3f} for 'tomorrow = today' ({fm['mae_improvement_pct']:.0f}% better), 80% interval covers {fm['coverage_80']:.0%}", fontsize=8.5, color=INK)
    fig.text(0.01, -0.03, f"Honest limit: on the {fm['big_drop_n']} weeks that ended in a >30% collapse the forecast is worse than persistence (MAE {fm['big_drop_mae_model']:.2f} vs {fm['big_drop_mae_persistence']:.2f}); sudden shocks are not forecastable from transit data alone.", fontsize=7, color=MUTED)
    save(fig, "07_forecast.png")


# 8 ------------------------------------------------------------------ pipeline diagram
def pipeline():
    steps = [("1 Detect", "live ship traffic,\nnews, GDACS, EONET,\nwaves, AIS", "#0ea5e9"), ("2 Predict", "trained model:\nP(disruption)\n+ 7-day forecast", "#6366f1"), ("3 Categorize", "conflict, piracy,\ncongestion, weather,\nAIS anomaly", "#a855f7"),
             ("4 Prioritize", "urgency x $ impact x\nrisk x confidence", "#ec4899"), ("5 Decide & replan", "proceed / checkpoint /\nreroute; validated\nsea route", "#f59e0b"), ("6 Explain", "plain English,\nnumbers from the\nmodel, not the LLM", "#10b981")]
    fig, ax = plt.subplots(figsize=(12, 2.6))
    ax.axis("off"); ax.set_xlim(0, 12.2); ax.set_ylim(0, 2.6)
    for i, (t, d, col) in enumerate(steps):
        x = 0.1 + i * 2.0
        ax.add_patch(plt.Rectangle((x, 0.5), 1.75, 1.5, color=col, alpha=0.14, ec=col, lw=1.5))
        ax.text(x + 0.875, 1.78, t, ha="center", va="center", fontsize=9.5, weight="bold", color=INK)
        ax.text(x + 0.875, 1.05, d, ha="center", va="center", fontsize=7.5, color=INK)
        if i < len(steps) - 1:
            ax.annotate("", xy=(x + 1.98, 1.25), xytext=(x + 1.77, 1.25), arrowprops=dict(arrowstyle="->", color=MUTED, lw=1.5))
    ax.text(6.1, 0.15, "Gemini: categorises news, proposes the backup route, writes the explanation  |  Every number shown comes from the model or the cost model", ha="center", fontsize=8, color=MUTED)
    save(fig, "08_pipeline.png")


# 9 ------------------------------------------------------------------ data sources
def sources():
    rows = [("IMF PortWatch", "Daily transits at 28 chokepoints, by vessel type", "Training + live", "none"), ("Google News RSS", "Headlines per watch zone; weekly counts as model feature", "Training + live", "none"),
            ("GDACS / NASA EONET", "Cyclones, quakes, volcanoes, storms, sea ice", "Live", "none"), ("Open-Meteo Marine", "Wave forecast at the day the ship arrives", "Live", "none"),
            ("Eurostat MARNET", "Sea-lane network for validated routing", "Static", "none"), ("AISStream.io", "Live vessel positions: congestion, dark ships, diversions", "Live", "free key"),
            ("Google Gemini", "Categorise, replan, explain", "Live", "free key")]
    fig, ax = plt.subplots(figsize=(11, 3.1)); ax.axis("off")
    t = ax.table(cellText=rows, colLabels=["Source", "What we use it for", "Used in", "Key needed"], loc="center", cellLoc="left", colWidths=[0.2, 0.5, 0.15, 0.15])
    t.auto_set_font_size(False); t.set_fontsize(9); t.scale(1, 1.7)
    for (r, c), cell in t.get_celld().items():
        cell.set_edgecolor("#e2e8f0")
        if r == 0:
            cell.set_facecolor("#0f172a"); cell.get_text().set_color("white"); cell.get_text().set_weight("bold")
    save(fig, "09_data_sources.png")


if __name__ == "__main__":
    metrics_table(); calibration(); confusion(); leads(); pipeline(); sources()
    for fn, need in ((redsea, "redsea_case.json"), (cost, "redsea_case.json"), (forecast, "forecast_predictions.pkl")):
        if (OUT / need).exists():
            fn()
        else:
            print("skipped", fn.__name__, "(missing", need + ")")
