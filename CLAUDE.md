@AGENTS.md

# Vantage: context for Claude Code

Hackathon project (Dormathon 2026, Track 1, submission due Sunday 9:30 AM). Judging: **Detect, Categorize, Prioritize, Explain**, and "does it help someone make a better decision, and can you prove it". Submission needs a public GitHub repo, a deployed app (Vercel) and PDF slides.

## Locked product decisions (from Shyam)
1. Ships only (no flights, no road traffic).
2. CesiumJS globe, God's Eye style (reference only, we don't build on that repo).
3. Free **live** APIs only, no replay mode.
4. Gemini free API does categorization, reasoning and explanations.
5. Users: shipping companies planning high-risk, critical shipments to save cost.
6. Risk score from live signals plus Gemini reasoning, with an explanation for each score.
7. Deploy on Vercel.
8. Core feature: the LLM replans to a feasible, valid fallback route. The globe shows the original route, danger spots, congestion zones and the replanned route. The app explains why the original is risky or safe, why a backup is needed and how it averts the risk, plus a "go the short way to a checkpoint, then reassess" option.
Raise any major decision with Shyam before acting on it.

## Architecture
- `app/page.tsx` → `components/Dashboard.tsx` (client UI: threat board, shipment planner, route cards, explanations, "Simulate strike").
- `components/Globe.tsx`: CesiumJS 1.146 loaded from jsDelivr (no bundling, no ion token). Basemaps: Esri Dark Gray (default), OpenStreetMap, Esri satellite. CARTO tiles now need a key, so they are not used.
- `app/api/signals/route.ts` → `lib/signals.ts`: aggregates live hazards. Gemini scores each watch zone (category, severity, confidence, `threatToShipping` to cut false alarms).
- `app/api/plan/route.ts` → `lib/planner.ts`: route exposure, costs, original/safest/balanced/checkpoint routes, then Gemini replanner (decision + hazards to avoid + named waypoints), validated on the sea graph, then a Gemini explainer. Rule-based fallback without a key.
- `lib/sources.ts`: IMF PortWatch (chokepoint transits, 7d vs 90d baseline), Google News RSS per watch zone (GDELT as second source, often rate-limited), GDACS, NASA EONET, Open-Meteo Marine (waves at the day the ship arrives).
- `lib/seagraph.ts` + `lib/data/searoute-graph.json`: Dijkstra on the Eurostat MARNET sea-lane network (rebuilt by `scripts/build-searoute-graph.mjs` from searoute-js data; densified to ≤150 km edges; only the main connected component is routable).
- `lib/places.ts`: ports (staging ports flagged), named waypoints Gemini may use, and the 12 news watch zones.
- `lib/cache.ts`: in-memory TTL cache that serves the last good value if an upstream fails.

## Cost model (shown in the UI under "Assumptions")
Voyage = days × daily vessel cost. War-risk premium = 1% × conflict exposure × (hull + cargo), when exposure ≥ 25%. P(disruption) = 0.25 × (risk/100)². Disruption cost = 15% of cargo (25% if critical) + 10 vessel-days. Hazards containing the origin/destination port are shown but not scored.

## Setup
```
cp .env.example .env.local   # set GEMINI_API_KEY (never commit it; the repo will be public)
npm install
npm run dev
```
Gemini model order: `GEMINI_MODEL` env, then gemini-3.5-flash, gemini-flash-lite-latest, gemini-flash-latest. `gemini-2.5-flash` is closed to new keys. gemini-3.8-flash was too slow (>2 min).
Checks: `npx eslint .`, `npx tsc --noEmit`, `npm run build`.

## Trained model, pipeline, AIS (added 2026-10-10 evening, branch feat/trained-model-backtest)
- `ml/` (Python, seed 42, `python ml/run_all.py`): walk-forward backtest on IMF PortWatch daily transits + weekly Google News counts (`data/news_weekly.csv`), calibrated logistic model (production) vs LightGBM, 7-day quantile forecast, charts in `slides/`. Honest write-up: `ml/README.md`, `ml/RESULTS.md`. The model is a modest gain over the old traffic score; on the Red Sea case the transit model alerted as carriers paused, the news layer was ~4 weeks earlier.
- `lib/model.ts` evaluates `lib/data/vantage-model.json` in TypeScript (features, logistic, isotonic, forecast trees, persistence/hysteresis). `npm run test:model` proves parity with Python. `lib/confidence.ts` gives each hazard a 0-100 confidence + reason.
- `lib/planner.ts` computes the priority ranking (urgency x USD impact x risk x confidence) and route justification itself and emits pipeline steps; `/api/plan?stream=1` streams them (NDJSON); `components/Pipeline.tsx` renders Detect, Predict, Categorize, Prioritize, Decide, Explain.
- Resilience: `lib/cache.ts resilient()` falls back to bundled `lib/data/snapshots/*.json` (refresh with `npm run snapshot`); the UI marks sources live / snapshot / down. `signals.filtering` lists signals dismissed as false alarms.
- `lib/ais.ts` + `/api/ais`: AISStream.io sampled for ~8 s server-side, cached 90 s, needs `AISSTREAM_API_KEY` (server-side only). Not testable without a key.
- Env on Vercel (Production + Preview): `GEMINI_API_KEY`, optional `AISSTREAM_API_KEY`. Turn Deployment Protection off for the public link.
- Gotcha: PortWatch `date` is a `YYYY-MM-DD` string. The Bash tool in this environment halves backslashes inside heredocs, so write files containing backslash escapes with the Write/Edit tools instead.

## Status
- PR #1 (full end-to-end build) is merged to `main`; production is https://vantage-rust-alpha.vercel.app. The trained-model work is on `feat/trained-model-backtest` (PR open for review).
- A first full plan takes ~20-35 s cold (live fetches + Gemini), cached afterwards; the UI now streams the pipeline stages.

## Ideas not done yet
- Live AIS test with a real key; more AIS anomaly tuning.
- Historical incident feed (ASAM was down; ACLED/Kaggle need keys) to train incident features.
- Mobile layout polish; PDF slides (charts are ready in `slides/`).
