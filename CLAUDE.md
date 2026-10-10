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

## Status (2026-10-10 ~10:00 UTC)
- Draft PR #1 (`claude/project-thread-dd6yj4` → main) has the full end-to-end build; Gemini tested live and working.
- Vercel preview builds green but is behind Vercel login; merge to main (or turn off Deployment Protection) for a public link. `GEMINI_API_KEY` must be set in Vercel for Production and Preview.
- A first full plan takes ~25–35 s (live fetches + 3 Gemini calls), cached afterwards.

## Ideas not done yet
- Proof slide: backtest the Red Sea crisis (PortWatch shows Suez/Bab el-Mandeb transits falling after Nov 2023) to show when our score would have crossed the threshold.
- Live AIS ship dots (needs a free AISStream.io key).
- Streaming progress in the UI while a plan runs; mobile layout polish; PDF slides.
