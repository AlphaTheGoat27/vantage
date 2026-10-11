import type { PlannedRoute } from "@/lib/types";

// Apple dark system colours (mirrors the tokens in app/globals.css). Cesium needs literal values.
export const SYS = {
  red: "#ff3b30",
  orange: "#ff9500",
  yellow: "#ffcc00",
  green: "#34c759",
  mint: "#00c7be",
  teal: "#30b0c7",
  cyan: "#32ade6",
  blue: "#007aff",
  indigo: "#5856d6",
  purple: "#af52de",
  pink: "#ff2d55",
  gray: "#8e8e93",
  ink: "#ffffff",
} as const;

export const HAZARD_COLORS: Record<string, string> = {
  "armed-conflict": SYS.red,
  "simulated-strike": SYS.pink,
  piracy: SYS.orange,
  "military-tension": SYS.yellow,
  "tropical-cyclone": SYS.cyan,
  "severe-weather": SYS.indigo,
  earthquake: SYS.purple,
  volcano: SYS.orange,
  "chokepoint-disruption": SYS.yellow,
  congestion: SYS.yellow,
  "sea-ice": SYS.mint,
  "ais-anomaly": SYS.teal,
};

/**
 * Routes are coloured by role (Apple Maps): selected route is electric blue, original is a crisp
 * light dashed line, alternatives are sleek translucent silver.
 */
export const ROUTE_ROLE = { selected: SYS.blue, original: "#f2f2f7", alternative: "rgba(255,255,255,0.45)" } as const;
export const routeColor = (id: PlannedRoute["id"], selectedId: PlannedRoute["id"] | null | undefined) =>
  id === selectedId ? ROUTE_ROLE.selected : id === "original" ? ROUTE_ROLE.original : ROUTE_ROLE.alternative;

export const SHIP_COLORS: Record<string, string> = {
  cargo: SYS.cyan,
  tanker: SYS.orange,
  passenger: SYS.green,
  fishing: SYS.gray,
  other: "#e5e5ea",
  unknown: "#636366",
};

/** Risk band colour: red ≥70, orange ≥45, yellow ≥25, else green. */
export const riskColor = (s: number) => (s >= 70 ? SYS.red : s >= 45 ? SYS.orange : s >= 25 ? SYS.yellow : SYS.green);
/** Confidence colour: green ≥70, yellow ≥45, else orange; gray when unknown. */
export const confColor = (c?: number) => (c === undefined ? SYS.gray : c >= 70 ? SYS.green : c >= 45 ? SYS.yellow : SYS.orange);
export const riskLabel = (s: number) => (s >= 70 ? "Severe" : s >= 45 ? "High" : s >= 25 ? "Elevated" : "Low");
