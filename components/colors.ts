import type { PlannedRoute } from "@/lib/types";

export const HAZARD_COLORS: Record<string, string> = {
  "armed-conflict": "#ff3b3b",
  "simulated-strike": "#ff2d95",
  piracy: "#ff8a00",
  "military-tension": "#ffb020",
  "tropical-cyclone": "#4cc9f0",
  "severe-weather": "#7aa2ff",
  earthquake: "#c084fc",
  volcano: "#f97316",
  "chokepoint-disruption": "#facc15",
  congestion: "#facc15",
  "sea-ice": "#e0f2fe",
  "ais-anomaly": "#22d3ee",
};

export const ROUTE_COLORS: Record<PlannedRoute["id"], string> = {
  original: "#ff5a5a",
  ai: "#22e39b",
  safest: "#38bdf8",
  balanced: "#a78bfa",
  checkpoint: "#fbbf24",
};
