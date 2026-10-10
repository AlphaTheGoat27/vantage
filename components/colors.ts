import type { PlannedRoute } from "@/lib/types";

// Apple dark system colours (mirrors the tokens in app/globals.css). Cesium needs literal values.
export const SYS = {
  red: "#ff453a",
  orange: "#ff9f0a",
  yellow: "#ffd60a",
  green: "#30d158",
  mint: "#63e6e2",
  teal: "#40c8e0",
  cyan: "#64d2ff",
  blue: "#0a84ff",
  indigo: "#5e5ce6",
  purple: "#bf5af2",
  pink: "#ff375f",
  gray: "#8e8e93",
  ink: "#f5f5f7",
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
 * Routes are coloured by role, not by id (Apple Maps): the selected route is blue, the original is a light
 * dashed line, every other alternative is muted gray. That keeps yellow / teal / purple free for risk and hazards.
 */
export const ROUTE_ROLE = { selected: SYS.blue, original: "#d1d1d6", alternative: "#8e8e93" } as const;
export const routeColor = (id: PlannedRoute["id"], selectedId: PlannedRoute["id"] | null | undefined) =>
  id === selectedId ? ROUTE_ROLE.selected : id === "original" ? ROUTE_ROLE.original : ROUTE_ROLE.alternative;

export const SHIP_COLORS: Record<string, string> = {
  cargo: SYS.cyan,
  tanker: SYS.orange,
  passenger: SYS.green,
  fishing: SYS.gray,
  other: "#d1d1d6",
  unknown: "#636366",
};

/** Risk band colour: red ≥70, orange ≥45, yellow ≥25, else green. */
export const riskColor = (s: number) => (s >= 70 ? SYS.red : s >= 45 ? SYS.orange : s >= 25 ? SYS.yellow : SYS.green);
/** Confidence colour: green ≥70, yellow ≥45, else orange; gray when unknown. */
export const confColor = (c?: number) => (c === undefined ? SYS.gray : c >= 70 ? SYS.green : c >= 45 ? SYS.yellow : SYS.orange);
export const riskLabel = (s: number) => (s >= 70 ? "Severe" : s >= 45 ? "High" : s >= 25 ? "Elevated" : "Low");
