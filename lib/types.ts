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
  "simulated-strike": "Simulated missile strike",
};

export type Evidence = { source: string; text: string; url?: string; time?: string };

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
};

export type Chokepoint = {
  id: string;
  name: string;
  center: LonLat;
  avg7?: number;
  baseline?: number;
  changePct?: number;
  asOf?: string;
};

export type SourceStatus = { name: string; ok: boolean; count: number; note?: string; url: string };

export type SignalsResponse = {
  generatedAt: string;
  ai: { enabled: boolean; model?: string; note?: string };
  sources: SourceStatus[];
  hazards: Hazard[];
  chokepoints: Chokepoint[];
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

export type Problem = { hazardId: string; title: string; category: HazardCategory; priority: number; impact: string; reasoning: string };

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
};
