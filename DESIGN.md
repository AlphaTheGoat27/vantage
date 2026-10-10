---
name: Vantage
description: Live maritime risk and rerouting console, drawn in Apple's dark appearance over a full-bleed globe.
colors:
  space: "#000"
  elevated: "#1c1c1e"
  elevated-2: "#2c2c2e"
  elevated-3: "#3a3a3c"
  material-thick: "rgb(28 28 30 / 0.72)"
  material-regular: "rgb(36 36 38 / 0.62)"
  ink: "#f5f5f7"
  ink-2: "rgb(235 235 245 / 0.64)"
  ink-3: "rgb(235 235 245 / 0.5)"
  ink-4: "rgb(235 235 245 / 0.28)"
  fill: "rgb(120 120 128 / 0.32)"
  fill-2: "rgb(120 120 128 / 0.2)"
  fill-3: "rgb(120 120 128 / 0.12)"
  separator: "rgb(84 84 88 / 0.55)"
  hairline: "rgb(255 255 255 / 0.08)"
  accent: "#0a84ff"
  accent-hover: "#409cff"
  link: "#409cff"
  red: "#ff453a"
  orange: "#ff9f0a"
  yellow: "#ffd60a"
  green: "#30d158"
  mint: "#63e6e2"
  teal: "#40c8e0"
  cyan: "#64d2ff"
  indigo: "#5e5ce6"
  purple: "#bf5af2"
  pink: "#ff375f"
  gray: "#8e8e93"
  route-original: "#d1d1d6"
  segment-selected: "#636366"
typography:
  large:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: "2.125rem"
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: "1.375rem"
    letterSpacing: "-0.012em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.3125rem"
    letterSpacing: "-0.006em"
  callout:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.125rem"
    letterSpacing: "-0.003em"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
    letterSpacing: "0em"
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: "0.875rem"
    letterSpacing: "0.006em"
  coordinate:
    fontFamily: "SF Mono, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: "1rem"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  2xl: "22px"
  full: "9999px"
spacing:
  float-inset: "12px"
  panel: "16px"
  row-x: "12px"
  row-y: "10px"
  stack: "16px"
  stack-tight: "12px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#fff"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 14px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-gray:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    typography: "{typography.callout}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "32px"
  button-plain:
    backgroundColor: "transparent"
    textColor: "{colors.link}"
    typography: "{typography.callout}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "32px"
  button-plain-hover:
    backgroundColor: "{colors.fill-3}"
  input:
    backgroundColor: "{colors.fill-2}"
    textColor: "{colors.ink}"
    typography: "{typography.callout}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  input-hover:
    backgroundColor: "{colors.fill}"
  segmented:
    backgroundColor: "{colors.fill-2}"
    rounded: "9px"
    padding: "2px"
  segmented-item:
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
    rounded: "7px"
    padding: "0 12px"
    height: "28px"
  segmented-item-selected:
    backgroundColor: "{colors.segment-selected}"
    textColor: "#fff"
  group-inset:
    backgroundColor: "{colors.fill-3}"
    rounded: "{rounded.lg}"
    padding: "10px 12px"
  sidebar:
    backgroundColor: "{colors.material-thick}"
    rounded: "{rounded.2xl}"
    padding: "16px"
    width: "380px"
  capsule-neutral:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink-2}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    padding: "0 8px"
    height: "18px"
  capsule-demo:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    padding: "0 8px"
    height: "18px"
  capsule-accent:
    backgroundColor: "rgb(10 132 255 / 0.25)"
    textColor: "{colors.ink}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    padding: "0 8px"
    height: "18px"
  switch-on:
    backgroundColor: "{colors.green}"
    rounded: "{rounded.full}"
    width: "46px"
    height: "28px"
  switch-off:
    backgroundColor: "{colors.fill}"
    rounded: "{rounded.full}"
    width: "46px"
    height: "28px"
---

# Design System: Vantage

## Overview

**Creative North Star: "The Earth Is the Canvas"**

Vantage behaves like Apple Maps on macOS in dark appearance. The globe runs full-bleed over black space on an Esri dark-gray basemap and is the content; one translucent sidebar (a bottom sheet on phones) carries the whole decision, and a few small floating controls sit over the map. Everything that is not the earth is Apple's thick dark material: blurred, saturated glass with a half-pixel light edge and a soft, deep shadow.

The system is calm and dense in the way an operating tool is dense: Apple's label opacities do the hierarchy, grouped inset lists (iOS Settings style) hold rows, and colour only appears where it carries meaning (an action, a risk band, a hazard category, a source state). It deliberately rejects the dark "command center" default: no neon, no monospace as an aesthetic, no three always-open panels fighting the globe.

Motion is physical and quiet. Panels, the sheet, switches and disclosures move on critically damped springs (0.3 to 0.35 s, no bounce); a slight bounce appears only after a flick carries momentum. The idle earth is the signature: after 12 s without input it eases into a slow eastward turn and stops the instant anyone touches anything.

**Key Characteristics:**
- Full-bleed globe; UI floats on it in thick dark material with a 0.5px light top edge.
- One sidebar (380px, inset 12px from the edges) on desktop; a three-detent bottom sheet on mobile.
- Apple dark system colours, used only for jobs; neutrals are Apple's label and fill opacities.
- SF Pro through the system stack, Inter off-Apple; size-specific tracking; tabular numerals instead of mono.
- Line icons at one stroke weight (1.75), never emoji or glyph icons.
- Honest state is always visible: live, snapshot, down, scenario (demo), simulated.

## Colors

Black space and dark glass, with Apple's dark system colours reserved for meaning.

### Primary
- **System Blue** (accent): the one action colour. The full-width Assess Route button, the selected or recommended route on the globe, the focus ring, the Recommended capsule tint. Hover lifts to **Light System Blue** (accent-hover).
- **Link Blue** (link): blue as small text on the material (plain buttons such as Edit and Retry), lighter so it keeps AA contrast.

### Secondary (risk bands and decisions)
- **System Red** (red): risk 70 and over ("Severe"), the Reroute now decision, armed-conflict hazards, a source that is down, error text.
- **System Orange** (orange): risk 45 to 69 ("High"), piracy and volcano hazards, low confidence.
- **System Yellow** (yellow): risk 25 to 44 ("Elevated"), the Sail to checkpoint decision, military tension, chokepoint disruption and congestion, a source on snapshot.
- **System Green** (green): risk under 25 ("Low"), the Proceed decision, a live source, high confidence, savings figures, the on state of a switch.

### Tertiary (hazard categories and ship classes)
- **Pink** (pink): simulated strikes only, so a hypothetical is never confused with a live conflict.
- **Cyan** (cyan): tropical cyclones; cargo ships.
- **Indigo** (indigo): severe weather. **Purple** (purple): earthquakes. **Mint** (mint): sea ice. **Teal** (teal): AIS anomalies.
- **Gray** (gray): alternative routes, fishing vessels, unknown confidence.

### Neutral
- **Space** (space): page and globe surround. **Globe base** is a near-black (#0b0b0d) under the tiles.
- **Thick Material** (material-thick) and **Regular Material** (material-regular): the sidebar, sheet and floating card; the small map controls and legend pill.
- **Elevated grays** (elevated, elevated-2, elevated-3): the opaque fallback for material under reduced transparency or increased contrast, and select option menus.
- **Label inks** (ink, ink-2, ink-3, ink-4): primary text, secondary text, tertiary metadata and placeholders, disabled.
- **Fills** (fill, fill-2, fill-3): gray buttons and capsules, inputs and the segmented track, grouped list backgrounds and row hover.
- **Separator** (separator) and **Hairline** (hairline): inset row dividers and faint edges.
- **Original route gray** (route-original): the light dashed original route. **Segment gray** (segment-selected): the selected segment.

### Named Rules
**The Colour Does a Job Rule.** Every hue on screen answers a question: what to press, how risky, what kind of hazard, whether a source is live. Decorative colour does not exist here.

**The Route Role Rule.** Routes are coloured by role, never by id: selected is blue over a dark casing (#0a3d7a), the original is a light dashed line, every other alternative is muted gray. This keeps yellow, teal and purple free for risk and hazards.

**The Honest State Rule.** Data provenance is always visible and uses one vocabulary: **live** (green), **snapshot** (yellow, with its age), **down** (red), **scenario** for demo data, and **simulated** for user-placed strikes (pink on the globe). The demo capsule is a neutral fill with a flask icon, never yellow, so a scenario never reads as a warning.

**The Cleared Palette Rule.** The default Tailwind palette, type scale and radii are cleared in the theme. Draw only from these tokens; no slate-400, no arbitrary hex in components (Cesium, which needs literals, reads the mirrored values in components/colors.ts).

## Typography

**Display Font:** SF Pro Display via -apple-system (with Inter, Segoe UI, system-ui)
**Body Font:** SF Pro Text via -apple-system (with Inter, Segoe UI, system-ui)
**Label/Mono Font:** SF Mono (with ui-monospace, Menlo, Consolas), for coordinates and code only

**Character:** Apple's own system voice: neutral, optically sized, with tracking that tightens as size grows, so the larger lines feel set rather than scaled.

### Hierarchy
- **Large** (600, 28px, 34px): the one-sentence decision at the top of a plan ("Reroute now"), coloured by its decision.
- **Headline** (600, 17px, 22px): the Vantage wordmark and the mobile peek decision.
- **Body** (400, 14px, 21px): explanatory paragraphs; the primary button label (at 590).
- **Callout** (400, 13px, 18px): row titles, inputs, buttons, disclosure headers (600).
- **Caption** (400, 12px, 16px): metadata lines, status line, legend, segmented labels (510).
- **Micro** (600, 11px, 14px): capsules and map credits.

### Named Rules
**The Tabular Numbers Rule.** Figures (risk scores, days, costs, counts, confidence) use tabular numerals in the sans face, never a monospace face. Mono is reserved for coordinates and code.

**The Weight Ladder Rule.** Weights are 400, 510, 590 and 600 (Apple's regular, medium, semibold steps). Hierarchy comes from size, weight and label opacity together, not from uppercase or letter-spaced labels.

## Layout

The globe fills the viewport (h-dvh). On desktop (1024px and up) the sidebar floats 12px from the top, bottom and left edges at 380px wide with 16px internal padding; its header (wordmark, status line, Voyage / Threats / Sources segmented tabs) stays fixed and the panel below scrolls. Top-right holds a small floating cluster: the map-style segmented control and the Simulate strike / Demo toggles. A legend pill appears bottom-centre of the uncovered map only once routes exist.

The globe canvas is offset so the earth centres in the area the UI leaves uncovered: the canvas runs past the right edge by the sidebar's right edge (392px), or past the top by the sheet peek on mobile. Labels and map credits are laid out against that uncovered area, not the window.

Below 1024px the sidebar becomes a bottom sheet with three detents (peek 128px, half, full with a 64px gap above), dragged 1:1 with rubber-banding past the ends. Inside panels, sections stack at 16px; grouped rows pad 12px horizontally and 10px vertically.

## Elevation & Depth

Depth comes from material, not from cards. Floating surfaces are translucent glass (blur 40px, saturate 180% for thick material; blur 24px for controls) with an inset 0.5px light top edge, like light catching the glass, and a soft, deep, layered shadow. Inside the material everything is flat: grouped lists sit on a fill, rows are divided by inset hairlines. Under reduced transparency the material becomes opaque elevated gray; under increased contrast it gains a 1px light outline.

### Shadow Vocabulary
- **Panel** (`box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.6), 0 16px 48px rgb(0 0 0 / 0.5), 0 2px 8px rgb(0 0 0 / 0.3)`): sidebar, sheet, floating ship card.
- **Control** (`box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.5), 0 6px 20px rgb(0 0 0 / 0.4)`): map controls, legend pill, strike hint.
- **Selected segment** (`box-shadow: 0 1px 3px rgb(0 0 0 / 0.35), inset 0 0.5px 0 rgb(255 255 255 / 0.14)`): the raised thumb of a segmented control.
- **Focus ring** (`box-shadow: 0 0 0 3px rgb(10 132 255 / 0.55)`): every keyboard focus; rows inside a group use an inset 2px accent ring instead.

### Named Rules
**The Glass Only Floats Rule.** Material is for things that float over the earth (sidebar, sheet, controls, legend, ship card). Nothing inside the material gets its own shadow or glass; nesting is shown with fills and hairlines.

## Shapes

Continuous-feeling rounded corners throughout, scaled to the element: 22px for the sidebar and the top of the sheet, 16px for the floating ship card, 12px for grouped lists and the primary button, 8px for inputs and secondary buttons, 9px / 7px for the segmented track and its thumb, full pills for capsules, switches, the legend, hints and the sheet grabber. Map labels are canvas-drawn pills with a 6px radius on dark material (rgba(28,28,30,0.78)), a 0.5px faint edge, and a 1px brighter edge when selected; a coloured dot leads a hazard label. Hazard zones are filled circles with a thin outline in their category colour.

## Components

### Buttons
Quiet and tactile; feedback on press, not release.
- **Shape:** gently rounded (8px); the primary is softer and larger (12px, 40px tall).
- **Primary:** System Blue fill, white 14px semibold (590) label, full width in the voyage form. One per view.
- **Gray:** fill background, ink label, 32px tall, for secondary actions.
- **Plain:** transparent with Link Blue text, 8px side padding; icon-only plain buttons (refresh) use ink-2.
- **States:** scale to 0.97 on press (120ms ease-out); hover lightens the fill; disabled at 40% opacity.

### Chips (Capsules)
- **Style:** 18px tall pills, 11px semibold, 8px side padding.
- **Tones:** neutral (fill, ink-2) for Backup and similar tags; accent (blue at 25%, ink) for Recommended; demo (fill, ink) with a leading flask line icon for Demo scenario.

### Cards / Containers
- **Corner Style:** 12px grouped inset lists inside the material; 22px for floating material panels.
- **Background:** fill-3 for groups; thick material for floating panels.
- **Shadow Strategy:** none inside the material (see Elevation & Depth).
- **Border:** none; rows separated by an inset 0.5px separator line.
- **Internal Padding:** 12px by 10px per row.

### Inputs / Fields
- **Style:** 32px tall, fill-2 background, 8px radius, 13px callout text with tabular numerals, no stroke. Selects carry a drawn up/down chevron.
- **Focus:** the blue focus ring; hover deepens the fill.

### Navigation
- **Segmented control:** a fill-2 track with 2px padding; 28px items in 12px caption at 510 weight, ink-2 at rest, ink on hover; the selected item rises as a gray thumb with white text. Used for the panel tabs (with roving focus and arrow keys) and the map style.

### Switch
iOS on/off switch (46 by 28, or 36 by 22 small): fill track off, System Green on, white knob that travels on a critically damped spring.

### Disclosure
A row header (callout semibold, optional caption trailing count in ink-3) with a chevron that rotates 90 degrees; the content opens on its height with a 0.35 s spring. The plan's reasoning lives one disclosure deep.

### Bottom Sheet
Three detents (peek, half, full). Drag is 1:1 with rubber-band resistance; release projects momentum to choose the detent and a spring carries the velocity in, with a 0.15 bounce only after a fast flick. The grabber is a keyboard-operable button.

### Globe (signature)
The earth is the canvas: Esri Dark Gray by default (OpenStreetMap and Esri satellite as alternatives), black surround. Label pills are placed every frame in priority order (selected hazard, pins, hazards by score, chokepoints), culled behind the horizon, kept inside the uncovered area and never overlapping; pins slide at most half their width to stay readable at the edges. After a plan, only hazards on the selected route are labelled. High-risk zones breathe slowly (an 8 s cycle, a few percent of alpha). The idle spin starts 12 s after the last input, turns eastward at 360 degrees per 4 minutes, ramps up on a critically damped curve (about 2.4 s to full speed), stops instantly on any pointer, wheel, touch or key input, and is off under reduced motion. Map credits stay, quietly, bottom-right of the visible map in micro ink-3.

## Do's and Don'ts

### Do:
- **Do** let the globe stay full-bleed and put all chrome in thick dark material floating over it.
- **Do** use System Blue only for the action and the selected route, and the red / orange / yellow / green bands only for risk, decisions, confidence and source state.
- **Do** colour routes by role: blue selected over a #0a3d7a casing, light dashed original, gray alternatives.
- **Do** show provenance with the honest-state vocabulary (live, snapshot, down, scenario, simulated) wherever data appears.
- **Do** render the demo capsule as a neutral fill with a flask icon.
- **Do** use tabular numerals for every figure, and line icons at a 1.75 stroke.
- **Do** move panels on critically damped springs (0.3 to 0.35 s) and CSS transitions on the iOS sheet curve cubic-bezier(0.32, 0.72, 0, 1) or the soft ease-out cubic-bezier(0.22, 1, 0.36, 1); honour reduced motion, reduced transparency and increased contrast.

### Don't:
- **Don't** make a scenario or demo state yellow; yellow means elevated risk or a snapshot source.
- **Don't** colour routes by id or use yellow, teal or purple for a route.
- **Don't** use the default Tailwind palette or arbitrary hex in components.
- **Don't** use monospace for numbers, neon accents, or emoji and glyph icons.
- **Don't** add uppercase, letter-spaced kicker labels above headings; hierarchy comes from size, weight and label opacity.
- **Don't** nest glass in glass or put shadows on rows and groups inside the material.
- **Don't** let the idle spin fight the user: any input stops it, and it never runs during a camera flight, strike picking or reduced motion.
