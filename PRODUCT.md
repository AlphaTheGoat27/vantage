# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Voyage planners and risk managers at shipping companies who move high-value or critical cargo (semiconductors, EV batteries, medical supplies, LNG equipment) by sea. They come to Vantage before or during a voyage with one job: decide quickly whether to proceed on the original route, sail to a checkpoint port and reassess, or reroute now, and come away with a reason they can defend to their manager, the cargo owner and the insurer.

Secondary audience: hackathon judges (Dormathon 2026, Track 1), who score Detect, Categorize, Prioritize, Explain and ask "does it help someone make a better decision, and can you prove it".

## Product Purpose

Vantage watches live maritime threats (armed conflict, missile strikes, piracy, military tension, cyclones, severe waves, earthquakes, chokepoint traffic collapse, port congestion), scores each one for risk to a specific shipment, and replans a feasible, validated fallback route with a plain-language explanation of why the original route is risky or safe, why a backup is needed and how it averts the risk. Success means a planner reaches a confident decision in under a minute and the cost trade-off (extra days versus war-risk premium and expected disruption) is visible and believable.

## Positioning

The replan is real, not decorative: Gemini proposes hazards to avoid and named waypoints, the Eurostat MARNET sea-lane graph validates the route, and a trained disruption model (walk-forward backtested on IMF PortWatch transits) supplies the predictive signal. Every score carries a confidence and an explanation. The "sail the short way to a checkpoint, then reassess" option is a decision most routing tools do not offer.

## Operating Context

- A single working screen: a 3D globe (CesiumJS) showing the original route, danger zones, congestion zones, chokepoints, live ships (AISStream.io) and the replanned routes, with the planning and explanation UI floating over it.
- Typical session: pick or enter a voyage (origin, destination, cargo, value, speed, vessel cost, critical flag), run the assessment, watch the pipeline stream (Detect, Predict, Categorize, Prioritize, Decide, Explain), compare the route options and read the reasoning. "Simulate strike" drops a hypothetical missile strike on the globe to show the plan adapting.
- A labeled demo scenario can stand in for quiet or rate-limited live feeds during a presentation. Live mode is the default and the demo is always visibly badged.
- The globe slowly rotates when nobody is using the app (ambient presence in a demo or ops-room setting).
- Deployed on Vercel; must work on a laptop at a judging table and hold up on a phone.

## Capabilities and Constraints

- Ships only (no flights, no road traffic). Free, live APIs only for live mode: IMF PortWatch, Google News RSS, GDELT, GDACS, NASA EONET, Open-Meteo Marine, AISStream.io (needs `AISSTREAM_API_KEY`). Gemini free API (`GEMINI_API_KEY`) for categorization, reasoning and explanations, with a rule-based fallback.
- Next.js 16 App Router, React 19, Tailwind CSS 4, CesiumJS 1.146 loaded from jsDelivr (no bundling, no ion token).
- A cold plan takes ~20-35 s; the pipeline stages stream so the wait is visible.
- Resilience: sources fall back to bundled snapshots and the UI marks each as live / snapshot / down.
- Terminology: hazard, watch zone, chokepoint, exposure, risk index (0-100), confidence (0-100), war-risk premium, expected disruption, checkpoint, original / AI replanned / safest / balanced / via-checkpoint routes; decisions PROCEED, PROCEED_TO_CHECKPOINT, REROUTE.

## Brand Commitments

- Name: Vantage.
- Binding visual constraint from the product owner: the interface follows Apple's Human Interface design principles (clarity, deference to content, depth; translucent materials, system typography, spring motion) and should feel minimalist, uncluttered and utilitarian.
- The globe is a "God's Eye" style earth view; it is the hero of the screen and the UI defers to it.

## Evidence on Hand

- Walk-forward backtest and calibrated model: `ml/README.md`, `ml/RESULTS.md`, `lib/data/backtest-summary.json`, charts in `slides/`. These numbers are measured and must never be altered or embellished.
- Red Sea case study (`npm run case:redsea`): the transit model alerted as carriers paused; the news layer was about 4 weeks earlier.
- Demo scenario data is hand-authored and must always be labeled as such in the UI; it never feeds the backtest or any accuracy claim.
- No customers, testimonials or pricing exist; do not invent them.

## Product Principles

1. The decision comes first: proceed, checkpoint or reroute, stated plainly, before any supporting detail.
2. Every number explains itself: a risk score always travels with its confidence, its sources and the reasoning behind it.
3. Honest by construction: live, snapshot, down, simulated and demo states are always visible; measured results are never dressed up.
4. The globe is the content; the interface floats over it and gets out of its way.
5. Show the common path first and keep advanced inputs and evidence one level deeper.

## Accessibility & Inclusion

Respect `prefers-reduced-motion` (no idle globe rotation, cross-fades instead of slides), `prefers-reduced-transparency` and `prefers-contrast`. Text meets WCAG AA contrast over the translucent panels. All controls are keyboard reachable with visible focus.
