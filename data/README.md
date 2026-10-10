# Data

The live app runs on live free APIs only. Offline data is used here for **training and backtesting only**.

## Chosen dataset: IMF PortWatch daily chokepoint transits

| | |
|---|---|
| Source | IMF PortWatch, ArcGIS FeatureServer `Daily_Chokepoints_Data` (https://portwatch.imf.org) |
| Licence / terms | Published openly by IMF PortWatch (free, no key). Cite "IMF PortWatch"; see https://portwatch.imf.org for the current terms of use. |
| Size | 79,352 rows, 28 chokepoints, 2019-01-01 to 2026-10-04, ~5 MB as CSV |
| Columns used | `date`, `portid`, `portname`, `n_total`, `n_tanker`, `n_container`, `n_dry_bulk` (also `n_general_cargo`, `n_roro`, `n_cargo`, `capacity`) |
| Download | `python ml/download_portwatch.py` writes `data/raw/portwatch_daily.csv` (git-ignored). A 7-month sample of Suez and Bab el-Mandeb is committed in `data/sample/`. |

**Why this dataset (3 lines).** (1) It is exactly the series the live app already reads, so a model trained on it transfers directly to production with no train/serve skew. (2) It covers 7.7 years and several real disruptions (for example Black Sea / Kerch 2022, Red Sea 2023-24 and Hormuz 2026 appear as labelled events in the test period), so disruption labels can be derived from sharp, sustained transit drops. (3) It is free, keyless and reproducible, unlike AIS archives (NOAA / Danish Maritime Authority are regional and gigabytes; Kaggle AIS sets need an API key and rarely cover chokepoints over years).

**Considered and rejected.** Kaggle AIS/piracy sets (need an API key; asked for rather than scraped; not needed once PortWatch fit). NGA ASAM piracy/incident database (the API was returning a 503 maintenance page when tested, 10 Oct 2026, so no incident-count features could be backtested). GDELT history (BigQuery, not keyless). ACLED (key).

## Second dataset: weekly news volume per watch zone

`data/news_weekly.csv` (committed, 97 KB): number of Google News RSS headlines per week for each of 9 watch zones, 2018-10 to 2026-10, using the **same zone queries as the live app** (`ml/download_news.py` is the single source of truth; the app reads the queries from the exported model JSON). Counts saturate at ~100 (the feed's page size), which is treated as "100+".

Caveat: Google News serves today's index of old articles, so historical counts are indicative rather than a tick-exact record of what a user would have seen then.

## Labels

A chokepoint is **disrupted** when its 7-day mean transit count stays at least 30% below its pre-event baseline (median of the 91 days ending 7 days earlier) for 7 straight days. The prediction target is "a sustained disruption starts within the next H days (H = 7, 14)", evaluated for chokepoints currently in normal state (7-day mean >= 85% of baseline). Chokepoints with a baseline under 5 transits/day are excluded (Bering, Magellan: ratios are meaningless). See `ml/features.py`.
