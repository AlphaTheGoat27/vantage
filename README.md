# Vantage

Live maritime risk intelligence for shipping companies. Vantage watches the world's sea lanes on a CesiumJS globe, **detects** threats to a shipment from free live data, **categorizes** them, **prioritizes** them by risk and cost to *this* voyage, and **replans** a feasible safer route with a plain-English **explanation** from Gemini.

## How it works

```
live APIs ─► detect hazards ─► Gemini categorizes & scores each zone ─► route exposure & cost
          ─► Gemini replans (what to avoid, which waypoints) ─► sea-lane router builds & validates the path
          ─► Gemini explains: why the original is risky, why a backup, how it averts the risk
```

1. **Detect** (`lib/sources.ts`, `lib/signals.ts`): IMF PortWatch chokepoint transits (7-day vs 90-day baseline), live maritime-security news for 12 watch zones (Google News RSS, GDELT), GDACS cyclone/quake/volcano alerts, NASA EONET storms and icebergs, Open-Meteo wave forecasts at the day the ship arrives.
2. **Categorize** (`lib/signals.ts`): Gemini reads each zone's headlines and traffic data and returns a category (armed conflict, piracy, military tension, congestion…), severity, confidence and rationale. Headlines that are commentary or land-only fighting are marked as not a threat to shipping, which keeps false alarms down.
3. **Prioritize** (`lib/planner.ts`): every hazard near the route gets an exposure (score × proximity, discounted for storms far ahead). Risk index, war-risk premium, voyage cost and expected disruption cost are computed per route.
4. **Replan** (`lib/planner.ts`, `lib/seagraph.ts`): Dijkstra on the Eurostat MARNET sea-lane network gives the original (shortest), safest (blocks high-risk zones) and balanced (soft penalty) routes, plus a **checkpoint plan**: sail the short route to a staging port before the first hazard, reassess with fresh data, then continue or divert. Gemini picks the decision (proceed / checkpoint / reroute), the hazards to avoid and optional waypoints; the router builds that path and rejects it if it is not sailable or still crosses an avoided hazard.
5. **Explain**: Gemini writes the decision, why the original is risky, why a backup is needed, how it averts the risk and the trade-offs, using only computed numbers. Without a key, rule-based reasoning fills in.

**Simulate strike**: click anywhere on the globe to drop a missile strike on shipping and watch the plan change.

## Trained prediction model, with proof

Beyond live signals, Vantage runs a **trained, calibrated model** that estimates the chance a chokepoint's traffic collapses within the next 14 days, plus a 7-day forecast with a prediction interval. It is trained and backtested on 7.7 years of IMF PortWatch transits plus weekly news volume, walk-forward with no future leakage, and evaluated in TypeScript on Vercel (no Python at runtime). It is compared with a naive rule and with the scoring the app shipped with before:

| 14-day horizon, 23 events | False-alarm rate | False alert episodes / chokepoint-year | Events warned before traffic fell | Median lead |
|---|---|---|---|---|
| **Vantage** | 2.9% | 0.95 | 11 / 23 | +10 d |
| Previous app scoring | 3.8% | 1.82 | 10 / 23 | +0.5 d |
| Naive drop > 15% | 6.4% | 2.83 | 10 / 23 | -1 d |

A modest, honestly measured gain on a rare-event problem, including where it did *not* help (the Red Sea case: the transit model alerted as carriers reacted; the news layer was four weeks earlier). Method, data, caveats and the Red Sea case study: [`ml/README.md`](ml/README.md), [`ml/RESULTS.md`](ml/RESULTS.md), [`data/README.md`](data/README.md), charts in [`slides/`](slides).

Each hazard also carries a **confidence score (0-100%)** built from source agreement, data freshness, model/AI certainty and missing-data penalty, with a one-line reason, and the planner streams a visible **Detect, Predict, Categorize, Prioritize, Decide, Explain** pipeline. Prioritisation is computed (urgency x business impact in USD x risk x confidence) and the LLM only supplies reasoning text. The Data sources tab lists which feeds are live, on a bundled last-good snapshot, or down, and which signals were dismissed as false alarms and why.

**Live ships (AIS):** with a free `AISSTREAM_API_KEY` the server samples AISStream for a few seconds around the watch zones (Vercel functions cannot hold a socket open), draws ships on the globe, and flags congestion, speed drops, scattered courses and AIS gaps as anomalies that raise the zone's hazard score.

## Run locally

```bash
cp .env.example .env.local   # add GEMINI_API_KEY (free) and optionally AISSTREAM_API_KEY (free)
npm install
npm run dev
```

Checks: `npx eslint .`, `npx tsc --noEmit`, `npm run build`, `npx tsx lib/model.test.ts` (Python/TypeScript parity). Retrain and re-run the backtest: `pip install -r ml/requirements.txt && python ml/run_all.py --skip-news`.

## Deploy on Vercel

Import the repo and set these environment variables for **Production and Preview** (Project, Settings, Environment Variables):

| Variable | Required | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | yes (the app falls back to rule-based reasoning without it) | https://aistudio.google.com/apikey |
| `AISSTREAM_API_KEY` | optional (no live ships or AIS anomalies without it) | https://aisstream.io (free) |
| `GEMINI_MODEL` | optional | overrides the default model order |

Turn off Deployment Protection for Production so the public link opens logged out (Settings, Deployment Protection).

## Data sources (all free)

| Signal | Source |
|---|---|
| Chokepoint transits (live + training) | IMF PortWatch (ArcGIS REST) |
| Conflict, piracy, military news | Google News RSS, GDELT 2.0 DOC API |
| Cyclones, earthquakes, volcanoes | GDACS |
| Storms, icebergs | NASA EONET |
| Wave forecast | Open-Meteo Marine |
| Live ships (optional) | AISStream.io (free key) |
| Sea-lane network | Eurostat MARNET (via searoute-js), `scripts/build-searoute-graph.mjs` |
| Globe imagery | Esri Dark Gray, OpenStreetMap, Esri World Imagery |
| Reasoning | Google Gemini (free tier) |
