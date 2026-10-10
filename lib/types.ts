import type { LonLat } from "./geo";

export type HazardCategory =
  | "armed-conflict"
  | "piracy"
  | "military-tension"
  | "tropical-cyclone"
  | "severe-weather"
  | "earthquake"
  | "volcano"
  | "chokepoint-disruption"
  | "congestion"
  | "sea-ice"
  | "ais-anomaly"
  | "simulated-strike";

export const CATEGORY_LABEL: Record<HazardCategory, string> = {
  "armed-conflict": "Armed conflict / strikes",
  piracy: "Piracy / seizure",
  "military-tension": "Military tension",
  "tropical-cyclone": "Tropical cyclone",
  "severe-weather": "Heavy seas",
  earthquake: "Earthquake",
  volcano: "Volcano",
  "chokepoint-disruption": "Traffic disruption",
  congestion: "Congestion",
  "sea-ice": "Sea ice",
  "ais-anomaly": "AIS anomaly",
  "simulated-strike": "Simulated missile strike",
};

export type Evidence = { source: string; text: string; url?: string; time?: string };

/** What the trained model (lib/model.ts) says about a chokepoint, with its drivers. */
export type ChokepointModel = {
  ratio7: number | null;
  probability: number | null;
  horizonDays: number;
  observedDrop: boolean;
  alert: boolean;
  alertKind: "none" | "observed" | "predicted";
  forecast: { q10: number; q50: number; q90: number } | null;
  newsSurge: number | null;
  drivers: { feature: string; value: number; contribution: number }[];
};

export type Hazard = {
  id: string;
  title: string;
  category: HazardCategory;
  center: LonLat;
  radiusKm: number;
  /** 0-100 combined risk score used by routing */
  score: number;
  /** 0-100 score from raw live signals only */
  signalScore: number;
  /** 0-100 score from Gemini, when available */
  aiScore?: number;
  confidence?: "low" | "medium" | "high";
  rationale: string;
  evidence: Evidence[];
  sources: string[];
  updated?: string;
  /** trained-model view of the chokepoint(s) inside this hazard */
  model?: ChokepointModel & { chokepoint: string };
  /** 0-100 confidence that the hazard is real and correctly scored, with a one-line reason */
  confidenceScore?: number;
  confidenceReason?: string;
};

export type Chokepoint = {
  id: string;
  name: string;
  center: LonLat;
  avg7?: number;
  baseline?: number;
  changePct?: number;
  asOf?: string;
  model?: ChokepointModel;
};

/** `fallback`: the live feed failed and a bundled last-good snapshot (taken at `snapshotAt`) is being used. */
export type SourceStatus = { name: string; ok: boolean; count: number; note?: string; url: string; fallback?: boolean; snapshotAt?: string };

export type Dismissed = { id: string; title: string; reason: string };

/** Which raw signals were screened, and which were dismissed as false alarms (and why). */
export type Filtering = { screened: number; flagged: number; dismissed: Dismissed[] };

export type SignalsResponse = {
  generatedAt: string;
  ai: { enabled: boolean; model?: string; note?: string };
  sources: SourceStatus[];
  hazards: Hazard[];
  chokepoints: Chokepoint[];
  filtering?: Filtering;
  model?: { version: number; trainedThrough: string; horizonDays: number; asOf?: string; ok: boolean; note?: string };
};

export type Port = { id: string; name: string; country: string; center: LonLat; staging?: boolean };

export type ShipmentInput = {
  originId: string;
  destinationId: string;
  cargo: string;
  cargoValueUsd: number;
  speedKnots: number;
  dailyCostUsd: number;
  hullValueUsd: number;
  critical: boolean;
  departure?: string;
  extraHazards?: Hazard[];
};

export type RouteExposure = { hazardId: string; title: string; category: HazardCategory; score: number; distanceKm: number; atKm: number; etaDays: number; exposure: number; unavoidable?: boolean };

export type RouteMetrics = {
  km: number;
  days: number;
  riskScore: number;
  voyageCostUsd: number;
  warRiskPremiumUsd: number;
  expectedDisruptionUsd: number;
  totalExpectedUsd: number;
  chokepoints: string[];
  exposures: RouteExposure[];
  maxWaveM?: number;
};

export type PlannedRoute = {
  id: "original" | "ai" | "safest" | "balanced" | "checkpoint";
  label: string;
  path: LonLat[];
  metrics: RouteMetrics;
  note?: string;
};

export type Decision = "PROCEED" | "PROCEED_TO_CHECKPOINT" | "REROUTE";

export type Problem = { hazardId: string; title: string; category: HazardCategory; priority: number; impact: string; reasoning: string; priorityScore?: number };

/** One row of the prioritisation table: urgency x business impact x (risk x confidence). */
export type PriorityRow = {
  hazardId: string;
  title: string;
  category: HazardCategory;
  rank: number;
  etaDays: number;
  /** 1/(1+eta/5): hazards reached sooner are more urgent */
  urgency: number;
  riskScore: number;
  confidence: number;
  /** (risk/100) x (confidence/100) */
  riskTimesConfidence: number;
  /** expected cost this hazard adds to the original route (disruption + war-risk premium), USD */
  impactUsd: number;
  impactNorm: number;
  priority: number;
  unavoidable: boolean;
};

export const PRIORITY_FORMULA = "priority = 100 x ( 0.40 x impact + 0.35 x risk x confidence + 0.25 x urgency ),  urgency = 1 / (1 + days_until_reached / 5)";

export type RouteVerdict = { id: PlannedRoute["id"]; label: string; days: number; km: number; riskScore: number; totalExpectedUsd: number; deltaVsOriginalUsd: number; verdict: string };

/** Why the replanned route is (or is not) better, in computed numbers. */
export type RouteJustification = {
  backupId: PlannedRoute["id"];
  avoids: { hazardId: string; title: string; category: HazardCategory; exposureBefore: number; exposureAfter: number }[];
  extraDays: number;
  extraKm: number;
  extraVoyageCostUsd: number;
  riskBefore: number;
  riskAfter: number;
  expectedCostBeforeUsd: number;
  expectedCostAfterUsd: number;
  /** positive = the backup is cheaper in expected terms */
  netSavingUsd: number;
  alternatives: RouteVerdict[];
  checkpointVerdict?: string;
};

export type PipelineStepId = "detect" | "predict" | "categorize" | "prioritize" | "decide" | "explain";

export type DetectItem = { hazardId: string; title: string; category: HazardCategory; score: number; confidenceScore?: number; confidenceReason?: string; observations: string[]; sources: string[]; etaDays: number; distanceKm: number; unavoidable?: boolean };
export type PredictItem = { chokepoint: string; probability: number | null; ratio7: number | null; observedDrop: boolean; alertKind: "none" | "observed" | "predicted"; forecast: { q10: number; q50: number; q90: number } | null; newsSurge: number | null; drivers: { feature: string; value: number; contribution: number }[] };

export type PipelineEvent =
  | { type: "progress"; step: PipelineStepId; message: string }
  | { type: "step"; step: "detect"; summary: string; items: DetectItem[]; sourcesLive: number; sourcesFallback: number; sourcesDown: number }
  | { type: "step"; step: "predict"; summary: string; items: PredictItem[]; horizonDays: number; trainedThrough: string }
  | { type: "step"; step: "categorize"; summary: string; groups: { category: HazardCategory; label: string; hazards: { hazardId: string; title: string; evidence: string[] }[] }[] }
  | { type: "step"; step: "prioritize"; summary: string; formula: string; rows: PriorityRow[] }
  | { type: "step"; step: "decide"; summary: string; decision: Decision; recommendedRouteId: PlannedRoute["id"]; justification: RouteJustification; rationale?: string; validation?: string }
  | { type: "step"; step: "explain"; summary: string; explanation: PlanResponse["explanation"] };
export type PipelineStep = Extract<PipelineEvent, { type: "step" }>;

export type Checkpoint = {
  port: Port;
  sharedKm: number;
  etaDays: number;
  /** extra days if the ship still has to divert after reassessing, versus rerouting today */
  divertPenaltyDays: number;
  divertPenaltyUsd: number;
  reassessNote: string;
};

export type PlanResponse = {
  generatedAt: string;
  shipment: ShipmentInput & { origin: Port; destination: Port };
  ai: { used: boolean; model?: string; note?: string };
  decision: Decision;
  recommendedRouteId: PlannedRoute["id"];
  backupRouteId: PlannedRoute["id"];
  routes: PlannedRoute[];
  problems: Problem[];
  checkpoint?: Checkpoint;
  explanation: {
    headline: string;
    whyOriginal: string;
    whyBackup: string;
    howBackupAverts: string;
    tradeoffs: string;
    actions: string[];
  };
  llmTrace?: { avoidHazardIds: string[]; via: string[]; rationale: string; valid: boolean; validation: string };
  hazards: Hazard[];
  priorities: PriorityRow[];
  justification: RouteJustification;
  /** the Detect > Predict > Categorize > Prioritize > Decide > Explain trace, in order */
  pipeline: PipelineStep[];
};
