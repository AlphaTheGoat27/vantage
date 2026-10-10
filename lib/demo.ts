// Labeled demo scenario ("?demo=1"): a hand-authored threat picture that stands in for the live feeds when they are quiet or
// rate-limited during a presentation. It is NEVER presented as live data: every hazard, evidence line, source row and model
// output below says it comes from the scenario, and SignalsResponse.demo / PlanResponse.demo carry the badge text.
// The planner itself (sea-lane routing, cost model, Open-Meteo waves, Gemini replanner and explainer) still runs for real.
// Nothing here feeds the trained model, its backtest (lib/data/backtest-summary.json, ml/) or any accuracy claim.
import type { LonLat } from "./geo";
import { geminiEnabled } from "./gemini";
import { MODEL_INFO } from "./model";
import type { Chokepoint, ChokepointModel, DemoInfo, Dismissed, Evidence, Hazard, HazardCategory, SignalsResponse, SourceStatus } from "./types";

export const DEMO_INFO: DemoInfo = {
  scenario: "Red Sea and Gulf escalation",
  note: "Hand-authored demo scenario, not live data: hazards, chokepoint traffic and model outputs are invented to illustrate the workflow; routing, costs, wave forecasts and Gemini reasoning still run for real.",
};

const SRC = "Demo scenario";

/** True when a request asks for the labeled demo scenario (`?demo=1` or `?demo=true`). */
export function isDemoRequest(req: Request): boolean {
  const v = new URL(req.url).searchParams.get("demo");
  return v === "1" || v === "true";
}

// ---------------------------------------------------------------- chokepoints (real PortWatch ids, names and centres)
type ChokeSpec = { id: string; name: string; center: LonLat; baseline: number; changePct: number; model?: ChokepointModel };

const quiet = (ratio7: number, probability: number, forecast: [number, number, number], drivers: [string, number, number][]): ChokepointModel => ({
  ratio7, probability, horizonDays: MODEL_INFO.horizonDays, observedDrop: false, alert: false, alertKind: "none",
  forecast: { q10: forecast[0], q50: forecast[1], q90: forecast[2] }, newsSurge: null,
  drivers: drivers.map(([feature, value, contribution]) => ({ feature, value, contribution })),
});

const CHOKEPOINTS: ChokeSpec[] = [
  {
    id: "chokepoint4", name: "Bab el-Mandeb Strait", center: [43.3495, 12.7886], baseline: 29.3, changePct: -62,
    model: {
      ratio7: 0.38, probability: null, horizonDays: MODEL_INFO.horizonDays, observedDrop: true, alert: true, alertKind: "observed",
      forecast: { q10: 0.27, q50: 0.36, q90: 0.52 }, newsSurge: 3.6,
      drivers: [
        { feature: "r7", value: 0.38, contribution: 2.41 },
        { feature: "news_surge", value: 3.6, contribution: 1.12 },
        { feature: "slope14", value: -0.041, contribution: 0.86 },
        { feature: "cape_r7", value: 1.35, contribution: 0.54 },
        { feature: "tanker_share_chg", value: -0.08, contribution: 0.21 },
      ],
    },
  },
  {
    id: "chokepoint1", name: "Suez Canal", center: [32.4369, 30.5933], baseline: 41.3, changePct: -48,
    model: {
      ratio7: 0.52, probability: null, horizonDays: MODEL_INFO.horizonDays, observedDrop: true, alert: true, alertKind: "observed",
      forecast: { q10: 0.41, q50: 0.5, q90: 0.66 }, newsSurge: 2.1,
      drivers: [
        { feature: "r7", value: 0.52, contribution: 1.94 },
        { feature: "peer_r7", value: 0.38, contribution: 0.92 },
        { feature: "slope7", value: -0.035, contribution: 0.61 },
        { feature: "news_surge", value: 2.1, contribution: 0.48 },
      ],
    },
  },
  {
    id: "chokepoint6", name: "Strait of Hormuz", center: [56.8598, 26.2969], baseline: 41.5, changePct: -13,
    model: {
      ratio7: 0.87, probability: 0.21, horizonDays: MODEL_INFO.horizonDays, observedDrop: false, alert: true, alertKind: "predicted",
      forecast: { q10: 0.58, q50: 0.76, q90: 0.93 }, newsSurge: 2.8,
      drivers: [
        { feature: "news_surge", value: 2.8, contribution: 1.31 },
        { feature: "slope14", value: -0.012, contribution: 0.57 },
        { feature: "tanker_share_chg", value: -0.05, contribution: 0.33 },
        { feature: "r7", value: 0.87, contribution: 0.18 },
        { feature: "vol28", value: 0.11, contribution: 0.12 },
      ],
    },
  },
  {
    id: "chokepoint7", name: "Cape of Good Hope", center: [20.8827, -34.9273], baseline: 89.8, changePct: 35,
    model: quiet(1.35, 0.01, [1.18, 1.31, 1.44], [["r7", 1.35, -0.92], ["slope14", 0.024, -0.31]]),
  },
  {
    id: "chokepoint2", name: "Panama Canal", center: [-79.7672, 9.1205], baseline: 29.9, changePct: -14,
    model: quiet(0.86, 0.05, [0.78, 0.86, 0.95], [["r7", 0.86, 0.22], ["drawdown60", -0.17, 0.15], ["news_surge", 1.3, 0.09]]),
  },
  { id: "chokepoint5", name: "Malacca Strait", center: [102.6651, 1.517], baseline: 218.9, changePct: 4, model: quiet(1.04, 0.01, [0.96, 1.03, 1.1], [["r7", 1.04, -0.41]]) },
  { id: "chokepoint8", name: "Gibraltar Strait", center: [-5.7549, 35.9423], baseline: 129.8, changePct: -7, model: quiet(0.93, 0.02, [0.86, 0.94, 1.02], [["r7", 0.93, 0.08], ["peer_r7", 0.52, 0.06]]) },
  { id: "chokepoint9", name: "Dover Strait", center: [1.5058, 51.0302], baseline: 159.5, changePct: -3, model: quiet(0.97, 0.01, [0.91, 0.98, 1.05], [["r7", 0.97, -0.05]]) },
  { id: "chokepoint11", name: "Taiwan Strait", center: [119.8314, 24.7235], baseline: 232.5, changePct: -9, model: quiet(0.91, 0.04, [0.84, 0.92, 0.99], [["news_surge", 1.6, 0.27], ["r7", 0.91, 0.11]]) },
  { id: "chokepoint13", name: "Tsugaru Strait", center: [140.3533, 41.328], baseline: 53.8, changePct: -2, model: quiet(0.98, 0.01, [0.9, 0.98, 1.06], [["r7", 0.98, -0.07]]) },
  { id: "chokepoint3", name: "Bosporus Strait", center: [29.0915, 41.1693], baseline: 61.0, changePct: -4 },
  { id: "chokepoint10", name: "Oresund Strait", center: [12.8508, 55.5078], baseline: 39.6, changePct: -2 },
  { id: "chokepoint12", name: "Korea Strait", center: [129.2092, 34.1308], baseline: 215.9, changePct: 1 },
  { id: "chokepoint14", name: "Luzon Strait", center: [121.3523, 20.4889], baseline: 92.4, changePct: 3 },
  { id: "chokepoint15", name: "Lombok Strait", center: [115.8014, -8.4191], baseline: 36.1, changePct: 9 },
  { id: "chokepoint16", name: "Ombai Strait", center: [125.091, -8.3985], baseline: 9.6, changePct: 2 },
  { id: "chokepoint17", name: "Bohai Strait", center: [120.9, 38.373], baseline: 155.4, changePct: -2 },
  { id: "chokepoint18", name: "Torres Strait", center: [142.2479, -9.8634], baseline: 8.2, changePct: 0 },
  { id: "chokepoint19", name: "Sunda Strait", center: [105.7748, -5.9667], baseline: 32.3, changePct: 12 },
  { id: "chokepoint20", name: "Makassar Strait", center: [119.257, 0.352], baseline: 52.7, changePct: 2 },
  { id: "chokepoint21", name: "Magellan Strait", center: [-69.5953, -52.6397], baseline: 5.6, changePct: 6 },
  { id: "chokepoint22", name: "Yucatan Channel", center: [-85.6466, 21.8152], baseline: 53.1, changePct: -5 },
  { id: "chokepoint23", name: "Windward Passage", center: [-73.6979, 19.9858], baseline: 15.8, changePct: -3 },
  { id: "chokepoint24", name: "Mona Passage", center: [-67.7114, 18.4489], baseline: 11.7, changePct: -2 },
  { id: "chokepoint25", name: "Balabac Strait", center: [117.1153, 7.4136], baseline: 11.0, changePct: 4 },
  { id: "chokepoint26", name: "Bering Strait", center: [-165.5503, 65.9659], baseline: 2.9, changePct: 0 },
  { id: "chokepoint27", name: "Mindoro Strait", center: [120.4031, 12.4677], baseline: 51.7, changePct: 1 },
  { id: "chokepoint28", name: "Kerch Strait", center: [36.5439, 45.2675], baseline: 1.2, changePct: 0 },
];

// ---------------------------------------------------------------- hazards
type HazardSpec = {
  id: string;
  title: string;
  category: HazardCategory;
  center: LonLat;
  radiusKm: number;
  score: number;
  signalScore: number;
  confidenceScore: number;
  confidenceReason: string;
  rationale: string;
  /** [hours before now, text] */
  evidence: [number, string][];
  /** chokepoint whose (scenario) model view is attached */
  chokepoint?: string;
};

const HAZARDS: HazardSpec[] = [
  {
    id: "demo-red-sea",
    title: "Southern Red Sea & Bab el-Mandeb: missile strikes on merchant ships",
    category: "armed-conflict",
    center: [42.3, 14.8],
    radiusKm: 520,
    score: 58,
    signalScore: 62,
    confidenceScore: 86,
    confidenceReason: "Scenario-assigned high: attack reports, a 62% traffic collapse and an insurer listing all point the same way",
    rationale:
      "In this scenario a product tanker and a bulk carrier that had loaded in Gulf ports were hit by anti-ship missiles 5 and 6 days ago, and Bab el-Mandeb transits have fallen 62% below baseline. The armed group says tankers and ships trading with Gulf ports are its targets. Two days ago it declared a 72-hour pause pending ceasefire talks: no attack since, but strikes are expected to resume if the talks fail, so the picture should be much clearer in about 3 days.",
    evidence: [
      [130, "Scenario: a product tanker that loaded in the Gulf reports a missile impact near the Hanish Islands; fire contained, ship diverted to Djibouti"],
      [150, "Scenario: a bulk carrier coming from a Gulf port is hit 45 nm west of Hodeidah; the armed group names tankers and Gulf-linked ships as targets"],
      [20, "Scenario: Bab el-Mandeb transits 11.1/day over 7 days against a 29.3/day baseline (-62%)"],
      [44, "Scenario: the armed group declares a 72-hour pause in attacks pending ceasefire talks; no attack reported since"],
      [26, "Scenario: war-risk underwriters keep the whole southern Red Sea listed; quotes about 0.7% of hull value, higher for tankers"],
    ],
    chokepoint: "Bab el-Mandeb Strait",
  },
  {
    id: "demo-gulf-of-aden",
    title: "Gulf of Aden: skiff approaches and a boarding attempt",
    category: "piracy",
    center: [49.5, 12.3],
    radiusKm: 430,
    score: 26,
    signalScore: 30,
    confidenceScore: 64,
    confidenceReason: "Scenario-assigned medium: two incident reports from the same reporting centre, no independent confirmation yet",
    rationale:
      "In this scenario a skiff with a ladder approached a container ship 90 nm south of Mukalla and a fishing dhow was seized off Puntland, suggesting a pirate group is active again while naval assets are busy in the Red Sea.",
    evidence: [
      [14, "Scenario: container ship reports a skiff with ladder and armed persons 90 nm south of Mukalla; armed guards fire warning shots, skiff withdraws"],
      [52, "Scenario: fishing dhow seized off Puntland, possibly as a mother ship"],
      [40, "Scenario: naval coalition advisory asks transiting ships to register and keep 18 kn through the corridor"],
    ],
  },
  {
    id: "demo-cyclone-bengal",
    title: "Cyclone Marlin (scenario), Bay of Bengal",
    category: "tropical-cyclone",
    center: [88.5, 16.0],
    radiusKm: 350,
    score: 74,
    signalScore: 74,
    confidenceScore: 80,
    confidenceReason: "Scenario-assigned high for the storm's strength and position; landfall timing carries about a 12 h uncertainty",
    rationale:
      "In this scenario a 90 kt post-monsoon cyclone is moving north at 9 kn toward the Odisha coast, with 6 to 7 m seas near the centre. It is moving away from the Malacca to Sri Lanka lane, so it matters for ships bound to Chittagong or Kolkata, not for through traffic.",
    evidence: [
      [3, "Scenario: Cyclone Marlin 90 kt, central pressure 958 hPa, moving north at 9 kn"],
      [3, "Scenario: landfall on the Odisha coast expected in 36 to 48 hours, weakening to a depression within 72 hours"],
      [6, "Scenario: significant waves 6 to 7 m within 120 nm of the centre; Chittagong anchorage closed to arrivals"],
    ],
  },
  {
    id: "demo-suez",
    title: "Suez Canal: transits down 48% as carriers divert",
    category: "chokepoint-disruption",
    center: [32.45, 30.4],
    radiusKm: 160,
    score: 20,
    signalScore: 24,
    confidenceScore: 74,
    confidenceReason: "Scenario-assigned medium-high: the traffic drop is measured, but the canal itself is open and safe",
    rationale:
      "In this scenario Suez transits fell to about half of normal because carriers avoid the southern Red Sea; the canal is open, but services are irregular and convoy slots are being rescheduled, which raises the chance of delays at the northern end of the route.",
    evidence: [
      [22, "Scenario: Suez Canal transits 21.5/day over 7 days against a 41.3/day baseline (-48%)"],
      [30, "Scenario: canal authority offers transit fee rebates to win back diverted container services"],
    ],
    chokepoint: "Suez Canal",
  },
  {
    id: "demo-hormuz",
    title: "Strait of Hormuz: naval standoff and boarding threats",
    category: "military-tension",
    center: [56.6, 25.9],
    radiusKm: 420,
    score: 48,
    signalScore: 45,
    confidenceScore: 66,
    confidenceReason: "Scenario-assigned medium: rhetoric and a surge in reports, but no ship has been stopped yet; the model only predicts a disruption",
    rationale:
      "In this scenario patrol boats shadowed two tankers through the strait and a regional navy announced inspections of 'suspicious' cargo. No ship has been seized yet; the trained model flags a 21% chance of a sustained traffic collapse within 14 days.",
    evidence: [
      [9, "Scenario: patrol boats shadow two outbound VLCCs for 3 hours inside the traffic separation scheme"],
      [27, "Scenario: regional navy announces inspections of cargo it calls suspicious; no boarding reported so far"],
      [18, "Scenario: Hormuz transits 36.1/day over 7 days against a 41.5/day baseline (-13%)"],
    ],
    chokepoint: "Strait of Hormuz",
  },
  {
    id: "demo-east-med-ais",
    title: "Eastern Mediterranean: GNSS spoofing off Port Said and the Levant",
    category: "ais-anomaly",
    center: [33.4, 32.4],
    radiusKm: 260,
    score: 20,
    signalScore: 22,
    confidenceScore: 58,
    confidenceReason: "Scenario-assigned medium: AIS position jumps on many ships, but spoofing is a navigation hazard rather than a direct attack",
    rationale:
      "In this scenario 23 ships within 150 nm of Port Said broadcast impossible position jumps over 24 hours, a pattern consistent with GNSS spoofing. It raises collision and grounding risk in a busy approach and hides other ships' positions.",
    evidence: [
      [7, "Scenario: 23 ships show AIS position jumps of more than 20 nm in 24 hours, several plotted over land"],
      [16, "Scenario: harbour pilots ask masters to cross-check GPS against radar and visual fixes"],
    ],
  },
  {
    id: "demo-taiwan",
    title: "Taiwan Strait: coast-guard inspection drills",
    category: "military-tension",
    center: [119.8, 24.3],
    radiusKm: 220,
    score: 26,
    signalScore: 30,
    confidenceScore: 61,
    confidenceReason: "Scenario-assigned medium: drills are announced and limited in time; traffic is only 9% below normal",
    rationale:
      "In this scenario coast-guard vessels are running inspection drills along the median line for three days. Merchant traffic continues with short delays; the main risk is being held for an inspection.",
    evidence: [
      [12, "Scenario: three-day inspection drill announced along the strait's median line"],
      [10, "Scenario: Taiwan Strait transits 9% below baseline; no ship detained so far"],
    ],
  },
  {
    id: "demo-typhoon",
    title: "Typhoon Kestrel (scenario), NW Pacific",
    category: "tropical-cyclone",
    center: [148.6, 35.4],
    radiusKm: 480,
    score: 70,
    signalScore: 70,
    confidenceScore: 78,
    confidenceReason: "Scenario-assigned high for the storm itself; its track is the uncertain part",
    rationale:
      "In this scenario a 95 kt typhoon is tracking north-west at 10 kn toward eastern Honshu and weakening over cooler water. Its forecast cone crosses the 40N great-circle lane near 147E around day 3 to 4, after a ship leaving Japan today has already passed; only the outer swell reaches the lane.",
    evidence: [
      [4, "Scenario: Typhoon Kestrel 95 kt, central pressure 950 hPa, moving north-west at 10 kn"],
      [4, "Scenario: forecast cone crosses 40N near 147E in 72 to 96 hours, weakening to a severe tropical storm"],
      [6, "Scenario: swell of 5 to 6 m expected up to 300 nm north of the centre"],
    ],
  },
  {
    id: "demo-agulhas",
    title: "Agulhas Current: heavy seas off South Africa",
    category: "severe-weather",
    center: [24.5, -36.6],
    radiusKm: 380,
    score: 36,
    signalScore: 36,
    confidenceScore: 70,
    confidenceReason: "Scenario-assigned medium-high: a typical spring gale against the current; timing beyond 5 days is uncertain",
    rationale:
      "In this scenario a south-westerly gale blowing against the Agulhas Current builds 6 to 7 m waves along the Cape route; ships usually slow down or keep further offshore, which costs time but rarely damages cargo.",
    evidence: [
      [8, "Scenario: south-westerly gale force 8 to 9 against the Agulhas Current, significant waves 6 to 7 m"],
      [8, "Scenario: Cape of Good Hope transits 121/day over 7 days against an 89.8/day baseline (+35%) as ships divert from Suez"],
    ],
    chokepoint: "Cape of Good Hope",
  },
  {
    id: "demo-panama",
    title: "Panama Canal: draft limits and a 5-day queue",
    category: "congestion",
    center: [-79.7, 9.1],
    radiusKm: 180,
    score: 30,
    signalScore: 30,
    confidenceScore: 72,
    confidenceReason: "Scenario-assigned medium-high: the queue and draft limit are published; it is a delay, not a safety threat",
    rationale:
      "In this scenario low lake levels cut the maximum draft by 1.2 m and daily slots from 36 to 31, so ships without a booked slot wait about 5 days. It costs time, not cargo safety.",
    evidence: [
      [11, "Scenario: canal authority cuts maximum draft by 1.2 m and daily booking slots from 36 to 31"],
      [11, "Scenario: 128 ships waiting, unbooked ships wait about 5 days"],
      [24, "Scenario: Panama Canal transits 25.7/day over 7 days against a 29.9/day baseline (-14%)"],
    ],
    chokepoint: "Panama Canal",
  },
];

const DISMISSED: Dismissed[] = [
  {
    id: "demo-dismissed-sea-of-japan",
    title: "Sea of Japan: naval exercise",
    reason: "Scenario: an annual exercise announced three months ago, with its notice-to-mariners box outside the commercial lanes; not a threat to merchant ships.",
  },
  {
    id: "demo-dismissed-rotterdam-strike",
    title: "Port of Rotterdam: terminal strike",
    reason: "Scenario: the 24-hour strike ended two days ago and the berth backlog is under a day, so it would be gone before any ship planned today arrives.",
  },
  {
    id: "demo-dismissed-batam",
    title: "Singapore Strait: theft at Batam anchorage",
    reason: "Scenario: petty theft of engine spares from an anchored barge; no threat to ships under way, so it is logged but not scored.",
  },
];

// ---------------------------------------------------------------- builders (fresh objects per call; times relative to now)
const hoursAgo = (now: number, h: number) => new Date(now - h * 3600_000).toISOString();

export function demoChokepoints(now = Date.now()): Chokepoint[] {
  const asOf = new Date(now - 6 * 86400_000).toISOString().slice(0, 10); // PortWatch-like publishing lag
  return CHOKEPOINTS.map((c) => {
    const avg7 = +(c.baseline * (1 + c.changePct / 100)).toFixed(1);
    return {
      id: c.id, name: c.name, center: [...c.center] as LonLat, avg7, baseline: c.baseline, changePct: c.changePct, asOf,
      model: c.model ? structuredClone(c.model) : undefined,
    };
  });
}

export function demoHazards(now = Date.now(), chokepoints = demoChokepoints(now)): Hazard[] {
  const byName = new Map(chokepoints.map((c) => [c.name, c]));
  return HAZARDS.map((h): Hazard => {
    const evidence: Evidence[] = h.evidence.map(([ago, text]) => ({ source: SRC, text, time: hoursAgo(now, ago) }));
    const cp = h.chokepoint ? byName.get(h.chokepoint) : undefined;
    return {
      id: h.id, title: h.title, category: h.category, center: [...h.center] as LonLat, radiusKm: h.radiusKm,
      score: h.score, signalScore: h.signalScore, rationale: h.rationale, evidence, sources: [SRC],
      updated: hoursAgo(now, Math.min(...h.evidence.map((e) => e[0]))),
      model: cp?.model ? { chokepoint: cp.name, ...structuredClone(cp.model) } : undefined,
      confidenceScore: h.confidenceScore, confidenceReason: h.confidenceReason,
    };
  }).sort((a, b) => b.score - a.score);
}

function demoSources(hazards: Hazard[], chokepoints: Chokepoint[]): SourceStatus[] {
  const note = "Demo scenario: hand-authored values stand in for this feed; nothing was fetched";
  const n = (cat: HazardCategory[]) => hazards.filter((h) => cat.includes(h.category)).length;
  return [
    { name: "Demo scenario: chokepoint transits (in place of IMF PortWatch)", url: "https://portwatch.imf.org", ok: true, count: chokepoints.length, note },
    { name: "Demo scenario: security reports (in place of Google News)", url: "https://news.google.com", ok: true, count: n(["armed-conflict", "piracy", "military-tension", "chokepoint-disruption", "congestion"]), note },
    { name: "Demo scenario: storm and weather alerts (in place of GDACS / NASA EONET)", url: "https://www.gdacs.org", ok: true, count: n(["tropical-cyclone", "severe-weather"]), note },
    { name: "Demo scenario: AIS anomalies (in place of AISStream.io)", url: "https://aisstream.io", ok: true, count: n(["ais-anomaly"]), note },
  ];
}

/** Full SignalsResponse built from the scenario. Always carries `demo`. */
export function getDemoSignals(): SignalsResponse {
  const now = Date.now();
  const chokepoints = demoChokepoints(now);
  const hazards = demoHazards(now, chokepoints);
  return {
    generatedAt: new Date(now).toISOString(),
    ai: {
      enabled: geminiEnabled(),
      note: "Demo scenario: hazard scores are hand-authored, not scored by Gemini; Gemini still replans and explains each voyage",
    },
    sources: demoSources(hazards, chokepoints),
    hazards,
    chokepoints,
    filtering: { screened: chokepoints.length + 12 + 6, flagged: hazards.filter((h) => h.score >= 25).length, dismissed: DISMISSED.map((d) => ({ ...d })) },
    model: {
      version: MODEL_INFO.version, trainedThrough: MODEL_INFO.trainedThrough, horizonDays: MODEL_INFO.horizonDays,
      asOf: chokepoints.find((c) => c.asOf)?.asOf, ok: true,
      note: "Demo scenario: the chokepoint traffic and model outputs shown are supplied by the scenario (hand-authored), not computed from live transits; the trained model and its backtest are unchanged",
    },
    demo: { ...DEMO_INFO },
  };
}
