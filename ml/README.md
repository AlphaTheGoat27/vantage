# Vantage ML: measured, trained, explainable disruption prediction

Everything here is reproducible with `python ml/run_all.py` (fixed seed 42). Numbers below are generated into [`RESULTS.md`](RESULTS.md) from the metrics JSON in [`results/`](results); charts for the slides are in [`../slides`](../slides).

## What is predicted, and from what

For every chokepoint-day, using only data up to that day: **will traffic through this chokepoint collapse (7-day mean at least 30% below its pre-event baseline for a full week) within the next 14 days?** (and 7 days). Data: IMF PortWatch daily transits at 28 chokepoints, 2019 to Oct 2026, plus weekly Google News headline counts for the zone around each chokepoint ([`../data/README.md`](../data/README.md)).

Features (26, all causal, [`features.py`](features.py)): robust ratios of 1/3/7/14/28-day traffic to a rolling-median baseline, a MAD-based robust z-score, trend and acceleration, robust volatility, drop from the 60-day peak, days below 80%, tanker/container/bulk mix shift, diversion traffic at the Cape of Good Hope, neighbouring and global chokepoint state, headline volume and headline surge versus the 8-week norm, season, and a missing-data fraction. The production classifier uses 14 of them.

**Robustness to noisy data.** Daily counts are winsorised (capped at 3x the trailing 8-week median); baselines are medians and spread is MAD (never mean/std); missing days are kept as NaN and handled explicitly (min-period rules, a `miss28` feature, median imputation in the model); the alert needs the signal to persist 2 days and clears only after 3 quiet days (hysteresis), so it does not flicker.

**Calibrated probabilities.** Isotonic regression fitted on cross-fitted, purged out-of-fold predictions from the training window, so a number shown to a user ("12% chance") is a frequency, not a raw score.

**Low false alarms by construction.** Thresholds are tuned to maximise early-warning recall *subject to* a 3% day-level false-alarm rate and at most 1 false alert episode per chokepoint-year.

## How we avoid fooling ourselves

- **Walk-forward, time-based**: one fold per quarter from 2022Q1; each fold trains only on rows whose labels were fully resolved before the quarter began (purge gap = horizon + 8 days). No random splits.
- Calibration and thresholds use only out-of-fold predictions from the training window. Nothing from the test quarter touches fitting, calibration or tuning.
- **Lead time is measured against the first day traffic visibly falls** (7-day mean below 85% of normal), not against a late "sustained" onset. A rule that only reacts to the drop scores about 0; only genuine early warning scores above 0. (An earlier version of this harness measured against the late onset and gave every system a flattering 8-14 days of "lead"; we caught and fixed that.)
- Baselines get the same persistence/hysteresis logic and the same tuning budget: (a) naive "7-day vs 90-day drop > X%" (X tuned, and fixed at 15%), (b) the traffic scoring that shipped in the app before this work (`lib/signals.ts trafficSignal() >= 25`).
- A parity test (`npx tsx lib/model.test.ts`) proves the TypeScript implementation used on Vercel reproduces the Python features and probabilities (697 feature values, max relative difference 4e-16).

## Headline results (14-day horizon, 44,864 chokepoint-days, 23 disruption events)

See [`RESULTS.md`](RESULTS.md) for the full tables, the 7-day horizon, the per-event list and the model-family comparison.

| System | Precision | Recall | False-alarm rate | Warned before traffic fell | False alert episodes / chokepoint-year |
|---|---|---|---|---|---|
| **Vantage** (trained model + observed drop) | 36.6% | 75.4% | 2.9% | 11 / 23 | 0.95 |
| Previous app scoring | 30.1% | 73.4% | 3.8% | 10 / 23 | 1.82 |
| Naive 7d-vs-90d drop > 15% | 21.4% | 76.9% | 6.4% | 10 / 23 | 2.83 |
| Naive, tuned threshold | 54.0% | 56.6% | 1.1% | 5 / 23 | 0.64 |

Model probability: ROC-AUC 0.80, PR-AUC 0.093 (16x the base rate), Brier skill +2.3%.

### What this says, honestly

- **Better than what shipped, modestly.** About half the false alert episodes and a lower false-alarm rate than the previous scoring, with a similar number of events warned early (11 vs 10) and a longer median lead (+10 vs +0.5 days). It is a real but small gain on a hard, rare-event problem (0.6% of days precede a disruption).
- **Not a free lunch.** The tuned naive rule has the lowest false-alarm rate and highest F1, but warns early on only 5 of 23 events and detects 8 of 23 at all. We optimised for catching events early under a false-alarm budget, and say so.
- **Brier skill is small** because events are rare; at the 7-day horizon it is slightly negative (-3%), i.e. no better than always predicting the base rate, even though ranking quality (AUC 0.83) is good. Use the probabilities for ranking and thresholds, not as precise odds, at 7 days.
- **Only 23 events** in the test period, several at low-traffic straits and some seasonal. Uncertainty on event counts is wide.
- **The headline Red Sea case is not a trained-model win.** The transit model alerted on 19 Dec 2023, three days before the old scoring (22 Dec) but a few days *after* the carrier pauses (15-18 Dec). The real early signal, headline volume 4x normal from 20 Nov, was not used by the model: no comparable event existed in its training data, so it learned nothing to do with it. The deterministic news layer in the app (headline score) would have crossed 45 on 15 Nov and 70 on 19 Nov, about four weeks before the carriers paused. That layer is replayed on one event, not backtested for false alarms, so we do not claim its false-alarm rate.
- **Forecast**: next-7-day traffic with an 80% interval is 16% more accurate than "tomorrow = today" and well calibrated (79% coverage), but worse than persistence in the weeks that end in a collapse; sudden shocks are not forecastable from transit data.
- **Model families**: logistic regression (14 features) and LightGBM (26 features) tie on ROC-AUC (0.80); logistic is better on PR-AUC (0.093 vs 0.063) and false alerts, extrapolates more gracefully to unseen event types, and exports as plain coefficients with exact per-feature contributions. LightGBM trees are still used for the quantile forecast.

## Not done / known limits

- No incident-count features (the NGA ASAM API was down when tested) and no AIS features in the trained model (no free historical archive without a key). Live AIS anomalies are rule-based with robust cross-region statistics and are not backtested.
- News features exist for 13 of 28 chokepoints (those inside a watch zone); the rest use transit features only.
- PortWatch publishes with about a week of lag, so a live prediction "today" is really a prediction from the last data date; the horizon starts there.
- Google News history is today's index of old articles: indicative, not tick-exact.
- Thresholds are tuned on out-of-fold predictions of the training window, not on a separate untouched year; the walk-forward test quarters are untouched.

## Files

| File | Purpose |
|---|---|
| `download_portwatch.py`, `download_news.py` | data download (resumable) |
| `features.py` | causal features, labels, event definition |
| `backtest.py` | walk-forward backtest, cross-fitted calibration, tuning, baselines, metrics |
| `forecast.py` | 7-day quantile forecast |
| `compare_models.py` | quick model-family comparison used during development |
| `export_model.py` | trains the production model on all data, exports `lib/data/vantage-model.json` and the parity fixture |
| `summary.py`, `write_report.py`, `make_charts.py` | summary for the app, `RESULTS.md`, slide charts |
| `run_all.py` | everything, one command |
