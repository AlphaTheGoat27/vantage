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

## Run locally

```bash
cp .env.example .env.local   # add GEMINI_API_KEY (free)
npm install
npm run dev
```

Deploy on Vercel: import the repo and set `GEMINI_API_KEY` in the project's environment variables.

## Data sources (all free)

| Signal | Source |
|---|---|
| Chokepoint transits | IMF PortWatch (ArcGIS REST) |
| Conflict, piracy, military news | Google News RSS, GDELT 2.0 DOC API |
| Cyclones, earthquakes, volcanoes | GDACS |
| Storms, icebergs | NASA EONET |
| Wave forecast | Open-Meteo Marine |
| Sea-lane network | Eurostat MARNET (via searoute-js), `scripts/build-searoute-graph.mjs` |
| Globe imagery | Esri Dark Gray, OpenStreetMap, Esri World Imagery |
| Reasoning | Google Gemini (free tier) |
