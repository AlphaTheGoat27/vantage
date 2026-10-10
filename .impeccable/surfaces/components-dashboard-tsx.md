---
version: 1
slug: "components-dashboard-tsx"
primary_target: "components/Dashboard.tsx"
related_targets: ["components/Globe.tsx","components/Pipeline.tsx","app/globals.css"]
---

# Surface: Vantage console (app/page.tsx → components/Dashboard.tsx)

Mode: Operate. Build path: code-led (Operate surface; no image generation available).
Audience and job: voyage planners decide proceed / checkpoint / reroute for a critical shipment, with a defensible reason. Judges must see Detect, Categorize, Prioritize, Explain within one screen.
Constraints: the globe stays full-bleed and is the content. Live / snapshot / down / simulated / demo states always visible. Backtest numbers untouched.
Direction: pinned by the product owner (Apple HIG world); no concept roll run, the pinned direction beats the roll.

## Direction contract

THESIS: A planning console that behaves like Apple Maps on macOS: the earth is the canvas and one translucent sidebar carries the whole decision. It refuses the category default of a dark "command center" with neon accents, monospace everywhere and three always-open panels fighting the globe.

OWN-WORLD: Apple dark appearance. Black space, Esri dark-gray earth. Sidebar and controls in thick dark material (rgba(28,28,30,0.72), blur 40px, saturate 180%), 0.5px light hairline, soft deep shadow, 16px continuous-feel corners. Type: SF Pro (Inter as the off-Apple fallback), size-specific tracking, tabular numerals instead of mono. Colour only does jobs, using Apple's dark system colours: blue #0A84FF for the action and recommended route; red / orange / yellow / green for risk bands; category hues from the same set. Labels in Apple's label / secondary / tertiary opacities. Icons are drawn line icons at one stroke weight, never emoji.

STORY: The visitor sees a calm, slowly turning earth with live hazards and ships. They pick a voyage and press Assess Route. The pipeline streams six stages, then the sidebar leads with one sentence of decision in large type, the route options as an inset grouped list, and the reasoning one disclosure deeper. They trust it because every score shows its confidence and sources.

FIRST VIEWPORT: Desktop: globe full-bleed; left floating sidebar (≈380px wide, 12px inset from the edges, full height) with "Vantage", a one-line live status, a segmented control (Voyage · Threats · Sources) and the voyage form whose primary action, a full-width blue "Assess Route" button, sits above the fold. Top-right: a small floating cluster with the map-style segmented control and the Simulate Strike / Demo toggles. Bottom-centre: a legend pill only once routes exist. Mobile: the sidebar becomes a bottom sheet with three detents (peek, half, full) dragged with spring physics.

FORM: Apple Maps sidebar-over-map (macOS/iPadOS), position 1 of 1 (pinned by the brief, no seed key; concept-seed not run because the direction was pinned).

Signature interaction: the idle earth. After about 12 s without any input, the globe eases into a slow rotation (about 360° every 4 minutes), with the angular speed ramping up from zero like a spring; any pointer, wheel, touch or key input stops it instantly. It is disabled under prefers-reduced-motion. Motion grammar: critically damped springs (response 0.3-0.4 s) for panels and the sheet, a slight bounce only after a flick, and the iOS sheet curve cubic-bezier(0.32, 0.72, 0, 1) for CSS transitions.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
