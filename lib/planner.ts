import { geminiEnabled, geminiJson } from "./gemini";
import { cumulativeKm, daysAtSpeed, haversineKm, pathLengthKm, pointPathKm, samplePath, type LonLat } from "./geo";
import { PORTS, WAYPOINTS, portById } from "./places";
import type { Port } from "./types";
import { MODEL_INFO } from "./model";
import { seaRoute, seaRouteVia, type EdgePenalty } from "./seagraph";
import { waveForecast } from "./sources";
import {
  CATEGORY_LABEL,
  PRIORITY_FORMULA,
  type Checkpoint,
  type Chokepoint,
  type Decision,
  type DetectItem,
  type Hazard,
  type HazardCategory,
  type PipelineEvent,
  type PipelineStep,
  type PlanResponse,
  type PlannedRoute,
  type PredictItem,
  type PriorityRow,
  type Problem,
  type RouteExposure,
  type RouteJustification,
  type RouteMetrics,
  type ShipmentInput,
  type SourceStatus,
} from "./types";

const SECURITY: HazardCategory[] = ["armed-conflict", "military-tension", "piracy", "simulated-strike"];
const TRANSIENT: HazardCategory[] = ["tropical-cyclone", "severe-weather", "earthquake", "volcano"];
const BLOCK_SCORE = 45;

const fmtUsd = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}k`);

function contains(h: Hazard, p: LonLat) {
  return haversineKm(h.center, p) < h.radiusKm;
}

/** Edge cost multiplier: hard blocks for avoided hazards, soft penalty (λ) for the rest. */
function penaltyFor(hazards: Hazard[], block: Set<string>, lambda: number, endpoints: LonLat[]): EdgePenalty {
  // never block a zone the voyage must start or end in; penalise it instead
  const blocked = hazards.filter((h) => block.has(h.id) && !endpoints.some((e) => contains(h, e)));
  const soft = hazards.filter((h) => h.score >= 15);
  return (a, b) => {
    const m: LonLat = Math.abs(a[0] - b[0]) > 180 ? a : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const h of blocked) if (haversineKm(m, h.center) < h.radiusKm) return Infinity;
    let mult = 1;
    for (const h of soft) {
      const d = haversineKm(m, h.center);
      if (d < h.radiusKm) mult += lambda * (h.score / 100) * (1 - (0.6 * d) / h.radiusKm);
    }
    return mult;
  };
}

async function measure(path: LonLat[], hazards: Hazard[], s: ShipmentInput, chokepoints: Chokepoint[], ends: LonLat[]): Promise<{ metrics: RouteMetrics; waveHazards: Hazard[] }> {
  const km = pathLengthKm(path);
  const days = daysAtSpeed(km, s.speedKnots);
  const cum = cumulativeKm(path);

  // live wave forecast at the day the ship reaches each point (Open-Meteo, 10-day horizon)
  const n = Math.min(14, Math.max(6, Math.round(km / 1500)));
  const samples = samplePath(path, n);
  const waves = await waveForecast(samples);
  const waveHazards: Hazard[] = [];
  let maxWaveM = 0;
  samples.forEach((p, i) => {
    const eta = Math.floor(((i + 0.5) / n) * days);
    const series = waves.maxByPointDay[i];
    if (!series || eta >= series.length) return;
    const w = series[eta];
    maxWaveM = Math.max(maxWaveM, w);
    if (w >= 4) {
      const score = Math.min(90, Math.round(20 + (w - 4) * 15));
      waveHazards.push({
        id: `waves-${p[0].toFixed(1)}-${p[1].toFixed(1)}`, title: `Heavy seas ${w.toFixed(1)} m (day ${eta})`, category: "severe-weather",
        center: p, radiusKm: 300, score, signalScore: score,
        rationale: `Open-Meteo forecasts ${w.toFixed(1)} m maximum waves here on the day this ship would arrive (day ${eta} of the voyage).`,
        evidence: [{ source: "Open-Meteo Marine", text: `wave_height_max ${w.toFixed(1)} m on day ${eta}` }], sources: ["Open-Meteo"],
      });
    }
  });

  const exposures: RouteExposure[] = [];
  for (const h of [...hazards, ...waveHazards]) {
    const { km: d, seg } = pointPathKm(h.center, path);
    const r = h.radiusKm;
    let f = d <= 0.5 * r ? 1 : d >= 1.25 * r ? 0 : (1.25 * r - d) / (0.75 * r);
    if (f <= 0) continue;
    const atKm = cum[seg];
    const etaDays = daysAtSpeed(atKm, s.speedKnots);
    // storms and quakes move or fade: discount what lies far ahead in the forecast
    if (TRANSIENT.includes(h.category) && !h.id.startsWith("waves-")) f *= etaDays > 10 ? 0.25 : etaDays > 5 ? 0.6 : 1;
    const unavoidable = ends.some((e) => contains(h, e));
    exposures.push({ hazardId: h.id, title: h.title, category: h.category, score: h.score, distanceKm: Math.round(d), atKm: Math.round(atKm), etaDays: +etaDays.toFixed(1), exposure: +((h.score / 100) * f).toFixed(3), unavoidable });
  }
  exposures.sort((a, b) => b.exposure - a.exposure);
  // hazards around the origin or destination port hit every route equally, so they are reported but not scored
  const riskScore = Math.round(100 * (1 - exposures.filter((e) => !e.unavoidable).reduce((p, e) => p * (1 - 0.95 * e.exposure), 1)));

  const conflict = Math.max(0, ...exposures.filter((e) => SECURITY.includes(e.category)).map((e) => e.exposure));
  const warRiskPremiumUsd = conflict >= 0.25 ? 0.01 * conflict * (s.hullValueUsd + s.cargoValueUsd) : 0;
  const voyageCostUsd = days * s.dailyCostUsd;
  const incidentCost = s.cargoValueUsd * (s.critical ? 0.25 : 0.15) + 10 * s.dailyCostUsd;
  // chance that a disruption (attack, seizure, storm damage, port closure) actually hits this voyage
  const pDisruption = 0.25 * (riskScore / 100) ** 2;
  const expectedDisruptionUsd = pDisruption * incidentCost;

  const chokes = chokepoints.filter((c) => pointPathKm(c.center, path).km < 80).map((c) => c.name);
  return {
    metrics: {
      km: Math.round(km), days: +days.toFixed(1), riskScore,
      voyageCostUsd: Math.round(voyageCostUsd), warRiskPremiumUsd: Math.round(warRiskPremiumUsd), expectedDisruptionUsd: Math.round(expectedDisruptionUsd),
      totalExpectedUsd: Math.round(voyageCostUsd + warRiskPremiumUsd + expectedDisruptionUsd),
      chokepoints: chokes, exposures, maxWaveM: +maxWaveM.toFixed(1),
    },
    waveHazards,
  };
}

/**
 * Staging port on the original route just before the first avoidable hazard: sail the short way there,
 * refresh the live picture, then continue or divert. Returns the port and the along-route distance.
 */
function findStagingPort(orig: LonLat[], firstRiskEntryKm: number, s: ShipmentInput): { port: Port; at: number } | undefined {
  const cum = cumulativeKm(orig);
  const total = cum[cum.length - 1];
  let best: { port: Port; at: number } | undefined;
  for (const p of PORTS) {
    if (!p.staging || p.id === s.originId || p.id === s.destinationId) continue;
    const { km: d, seg } = pointPathKm(p.center, orig);
    if (d > 450) continue;
    const at = cum[seg];
    if (at > firstRiskEntryKm - 150 || at < Math.min(800, total * 0.1)) continue;
    if (!best || at > best.at) best = { port: p, at };
  }
  return best;
}

/** Cut a path at a given along-route distance. */
function pathUntil(path: LonLat[], km: number): LonLat[] {
  const cum = cumulativeKm(path);
  const i = cum.findIndex((c) => c >= km);
  return i < 0 ? path : path.slice(0, Math.max(2, i + 1));
}

// ---------------- Gemini: replanner and explainer ----------------
type ReplanOut = {
  problems: { hazardId: string; priority: number; impact: string; reasoning: string }[];
  decision: Decision;
  avoidHazardIds: string[];
  via: string[];
  rationale: string;
};

const REPLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    problems: {
      type: "ARRAY",
      description: "hazards on the original route, ranked by priority (1 = most urgent)",
      items: {
        type: "OBJECT",
        properties: {
          hazardId: { type: "STRING" },
          priority: { type: "INTEGER" },
          impact: { type: "STRING", description: "what could happen to this shipment, with numbers" },
          reasoning: { type: "STRING", description: "why this risk is real or overstated, citing evidence" },
        },
        required: ["hazardId", "priority", "impact", "reasoning"],
      },
    },
    decision: { type: "STRING", enum: ["PROCEED", "PROCEED_TO_CHECKPOINT", "REROUTE"] },
    avoidHazardIds: { type: "ARRAY", items: { type: "STRING" }, description: "hazard ids the backup route must stay out of" },
    via: { type: "ARRAY", items: { type: "STRING", enum: Object.keys(WAYPOINTS) }, description: "ordered named waypoints for the backup route, may be empty" },
    rationale: { type: "STRING" },
  },
  required: ["problems", "decision", "avoidHazardIds", "via", "rationale"],
};

const EXPLAIN_SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING", description: "one sentence decision a shipping ops manager can act on" },
    whyOriginal: { type: "STRING", description: "why the original route is risky or safe, cite hazards, scores and live evidence" },
    whyBackup: { type: "STRING", description: "why a backup route is or is not needed" },
    howBackupAverts: { type: "STRING", description: "how the backup avoids each risk, with distance and risk numbers" },
    tradeoffs: { type: "STRING", description: "extra days, km and cost versus risk and expected-cost reduction" },
    actions: { type: "ARRAY", items: { type: "STRING" }, description: "3-5 concrete next steps" },
  },
  required: ["headline", "whyOriginal", "whyBackup", "howBackupAverts", "tradeoffs", "actions"],
};

const routeBrief = (r: PlannedRoute) => ({
  id: r.id, label: r.label, km: r.metrics.km, days: r.metrics.days, riskScore: r.metrics.riskScore, chokepoints: r.metrics.chokepoints,
  voyageCost: fmtUsd(r.metrics.voyageCostUsd), warRiskPremium: fmtUsd(r.metrics.warRiskPremiumUsd), expectedDisruption: fmtUsd(r.metrics.expectedDisruptionUsd),
  totalExpected: fmtUsd(r.metrics.totalExpectedUsd), maxWaveM: r.metrics.maxWaveM,
  hazardsCrossed: r.metrics.exposures.slice(0, 6).map((e) => `${e.title} (${CATEGORY_LABEL[e.category]}, score ${e.score}, ${e.distanceKm} km from route, reached on day ${e.etaDays}${e.unavoidable ? ", unavoidable: origin/destination inside it" : ""})`),
});

// ---------------- prioritisation and route justification (computed, never invented by the LLM) ----------------
/** Same cost model as measure(): expected disruption + war-risk premium for a set of exposures. */
function expectedHazardCost(exps: RouteExposure[], s: ShipmentInput): number {
  const scored = exps.filter((e) => !e.unavoidable);
  const risk = 100 * (1 - scored.reduce((p, e) => p * (1 - 0.95 * e.exposure), 1));
  const conflict = Math.max(0, ...scored.filter((e) => SECURITY.includes(e.category)).map((e) => e.exposure));
  const premium = conflict >= 0.25 ? 0.01 * conflict * (s.hullValueUsd + s.cargoValueUsd) : 0;
  const incident = s.cargoValueUsd * (s.critical ? 0.25 : 0.15) + 10 * s.dailyCostUsd;
  return 0.25 * (risk / 100) ** 2 * incident + premium;
}

function rankProblems(onRoute: RouteExposure[], hazardById: Map<string, Hazard>, s: ShipmentInput): PriorityRow[] {
  const total = expectedHazardCost(onRoute, s);
  const rows = onRoute.map((e) => {
    const h = hazardById.get(e.hazardId)!;
    const impactUsd = e.unavoidable ? 0 : Math.max(0, total - expectedHazardCost(onRoute.filter((x) => x.hazardId !== e.hazardId), s));
    const confidence = h.confidenceScore ?? 60;
    return { e, h, impactUsd, confidence };
  });
  const maxImpact = Math.max(1, ...rows.map((r) => r.impactUsd));
  return rows
    .map(({ e, h, impactUsd, confidence }) => {
      const urgency = 1 / (1 + e.etaDays / 5);
      const riskTimesConfidence = (e.score / 100) * (confidence / 100);
      const impactNorm = impactUsd / maxImpact;
      const priority = 100 * (0.4 * impactNorm + 0.35 * riskTimesConfidence + 0.25 * urgency);
      return {
        hazardId: e.hazardId, title: h.title, category: e.category, rank: 0, etaDays: e.etaDays,
        urgency: +urgency.toFixed(3), riskScore: e.score, confidence, riskTimesConfidence: +riskTimesConfidence.toFixed(3),
        impactUsd: Math.round(impactUsd), impactNorm: +impactNorm.toFixed(3), priority: +priority.toFixed(1), unavoidable: Boolean(e.unavoidable),
      } satisfies PriorityRow;
    })
    .sort((a, b) => b.priority - a.priority)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function justify(original: PlannedRoute, backup: PlannedRoute, others: (PlannedRoute | null)[], checkpoint: Checkpoint | undefined, checkpointRoute: PlannedRoute | null, recommendedId: PlannedRoute["id"]): RouteJustification {
  const o = original.metrics, b = backup.metrics;
  const avoids = o.exposures
    .filter((e) => !e.unavoidable)
    .map((e) => ({ e, after: b.exposures.find((x) => x.hazardId === e.hazardId)?.exposure ?? 0 }))
    .filter(({ e, after }) => e.exposure >= 0.05 && after < e.exposure * 0.5)
    .map(({ e, after }) => ({ hazardId: e.hazardId, title: e.title, category: e.category, exposureBefore: e.exposure, exposureAfter: +after.toFixed(3) }));
  const alts = [original, ...others, checkpointRoute].filter((r): r is PlannedRoute => Boolean(r));
  const seen = new Set<string>();
  const alternatives = alts
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => {
      const d = r.metrics.totalExpectedUsd - o.totalExpectedUsd;
      const verdict =
        r.id === recommendedId ? "Recommended"
        : r.id === "original" ? "Shortest, but carries the live risk"
        : r.metrics.riskScore >= o.riskScore ? "No safer than the original"
        : d > 0 ? `Safer but costs ${fmtUsd(d)} more in expectation`
        : `Safer and ${fmtUsd(-d)} cheaper in expectation`;
      return { id: r.id, label: r.label, days: r.metrics.days, km: r.metrics.km, riskScore: r.metrics.riskScore, totalExpectedUsd: r.metrics.totalExpectedUsd, deltaVsOriginalUsd: d, verdict };
    });
  let checkpointVerdict: string | undefined;
  if (checkpoint && checkpointRoute) {
    const cp = checkpointRoute.metrics.totalExpectedUsd, bk = b.totalExpectedUsd, clear = o.voyageCostUsd;
    const denom = cp - clear;
    const pStar = denom > 0 ? (cp - bk) / denom : NaN;
    checkpointVerdict =
      cp <= bk
        ? `The checkpoint plan is never worse than rerouting now: even if the risk persists it costs ${fmtUsd(cp)} expected versus ${fmtUsd(bk)}.`
        : Number.isFinite(pStar) && pStar > 0 && pStar < 1
          ? `Checkpoint beats rerouting now only if there is at least a ${(pStar * 100).toFixed(0)}% chance the hazard clears before ${checkpoint.port.name} (day ${checkpoint.etaDays}); if it persists the late divert costs ${checkpoint.divertPenaltyDays > 0 ? `${checkpoint.divertPenaltyDays} extra days and ` : ""}${fmtUsd(checkpoint.divertPenaltyUsd)} more. Storms often clear in days; conflict zones rarely do.`
          : `Checkpoint is not worth it: waiting adds ${fmtUsd(checkpoint.divertPenaltyUsd)} expected cost without a realistic upside.`;
  }
  return {
    backupId: backup.id, avoids, extraDays: +(b.days - o.days).toFixed(1), extraKm: b.km - o.km, extraVoyageCostUsd: b.voyageCostUsd - o.voyageCostUsd,
    riskBefore: o.riskScore, riskAfter: b.riskScore, expectedCostBeforeUsd: o.totalExpectedUsd, expectedCostAfterUsd: b.totalExpectedUsd,
    netSavingUsd: o.totalExpectedUsd - b.totalExpectedUsd, alternatives, checkpointVerdict,
  };
}

// ---------------- main ----------------
export async function planShipment(
  s: ShipmentInput,
  baseHazards: Hazard[],
  chokepoints: Chokepoint[],
  opts: { emit?: (e: PipelineEvent) => void; sources?: SourceStatus[] } = {},
): Promise<PlanResponse> {
  const pipeline: PipelineStep[] = [];
  const step = (e: PipelineStep) => {
    pipeline.push(e);
    opts.emit?.(e);
  };
  const progress = (st: PipelineStep["step"], message: string) => opts.emit?.({ type: "progress", step: st, message });
  const origin = portById(s.originId), destination = portById(s.destinationId);
  if (!origin || !destination) throw new Error("unknown origin or destination port");
  if (origin.id === destination.id) throw new Error("origin and destination are the same port");
  const hazards = [...baseHazards, ...(s.extraHazards ?? [])];
  const ends = [origin.center, destination.center];

  const origPath = seaRoute(origin.center, destination.center);
  if (!origPath) throw new Error("no sea route between these ports");
  const orig = await measure(origPath, hazards, s, chokepoints, ends);
  const allHazards = [...hazards, ...orig.waveHazards];
  const hazardById = new Map(allHazards.map((h) => [h.id, h]));

  const onRoute = orig.metrics.exposures.filter((e) => e.exposure >= 0.05);
  const avoidable = onRoute.filter((e) => !e.unavoidable);
  const blockAll = new Set(avoidable.filter((e) => e.score >= BLOCK_SCORE).map((e) => e.hazardId));

  // ---- pipeline stages 1-4 depend only on the original route, so they stream out before any LLM call
  const src = opts.sources ?? [];
  step({
    type: "step", step: "detect",
    summary: onRoute.length ? `${onRoute.length} hazard(s) detected near the ${origin.name} to ${destination.name} route, from ${src.filter((x) => x.ok && !x.fallback).length} live sources` : "No live hazard found near the route",
    items: onRoute.map((e): DetectItem => {
      const h = hazardById.get(e.hazardId)!;
      return {
        hazardId: e.hazardId, title: h.title, category: h.category, score: h.score, confidenceScore: h.confidenceScore, confidenceReason: h.confidenceReason,
        observations: h.evidence.slice(0, 3).map((x) => `${x.source}: ${x.text}`), sources: h.sources, etaDays: e.etaDays, distanceKm: e.distanceKm, unavoidable: e.unavoidable,
      };
    }),
    sourcesLive: src.filter((x) => x.ok && !x.fallback).length, sourcesFallback: src.filter((x) => x.ok && x.fallback).length, sourcesDown: src.filter((x) => !x.ok).length,
  });
  const modelNames = new Set<string>(orig.metrics.chokepoints);
  for (const e of onRoute) {
    const m = hazardById.get(e.hazardId)?.model;
    if (m) modelNames.add(m.chokepoint);
  }
  const predictItems = chokepoints
    .filter((c) => modelNames.has(c.name) && c.model)
    .map((c): PredictItem => ({ chokepoint: c.name, probability: c.model!.probability, ratio7: c.model!.ratio7, observedDrop: c.model!.observedDrop, alertKind: c.model!.alertKind, forecast: c.model!.forecast, newsSurge: c.model!.newsSurge, drivers: c.model!.drivers }));
  const alerting = predictItems.filter((p) => p.alertKind !== "none");
  step({
    type: "step", step: "predict",
    summary: predictItems.length
      ? alerting.length
        ? `${alerting.map((p) => (p.alertKind === "observed" ? `${p.chokepoint}: already disrupted (traffic at ${Math.round((p.ratio7 ?? 0) * 100)}% of normal)` : `${p.chokepoint}: ${((p.probability ?? 0) * 100).toFixed(0)}% chance of a sustained traffic collapse within 14 days`)).join("; ")}`
        : `Trained model sees no imminent disruption at the ${predictItems.length} chokepoint(s) on this route`
      : "No chokepoint on this route is covered by the trained model",
    items: predictItems, horizonDays: 14, trainedThrough: MODEL_INFO.trainedThrough,
  });
  const groups = new Map<HazardCategory, { hazardId: string; title: string; evidence: string[] }[]>();
  for (const e of onRoute) {
    const h = hazardById.get(e.hazardId)!;
    groups.set(h.category, [...(groups.get(h.category) ?? []), { hazardId: h.id, title: h.title, evidence: h.evidence.slice(0, 2).map((x) => `${x.source}: ${x.text}`) }]);
  }
  step({
    type: "step", step: "categorize",
    summary: groups.size ? [...groups].map(([c, l]) => `${l.length} x ${CATEGORY_LABEL[c]}`).join(", ") : "Nothing to categorize",
    groups: [...groups].map(([category, hazards]) => ({ category, label: CATEGORY_LABEL[category], hazards })),
  });
  const priorities = rankProblems(onRoute, hazardById, s);
  step({
    type: "step", step: "prioritize",
    summary: priorities.length ? `#1 ${priorities[0].title} (priority ${priorities[0].priority}): reached on day ${priorities[0].etaDays}, adds ${fmtUsd(priorities[0].impactUsd)} expected cost` : "No hazards to rank",
    formula: PRIORITY_FORMULA, rows: priorities,
  });
  progress("decide", geminiEnabled() ? "Gemini is choosing proceed / checkpoint / reroute and designing the backup route" : "Choosing proceed / checkpoint / reroute");

  const build = async (id: PlannedRoute["id"], label: string, path: LonLat[] | null, note?: string): Promise<PlannedRoute | null> => {
    if (!path) return null;
    const m = await measure(path, allHazards, s, chokepoints, ends);
    return { id, label, path, metrics: m.metrics, note };
  };

  const original: PlannedRoute = { id: "original", label: "Original (shortest)", path: origPath, metrics: orig.metrics };
  const [safest, balanced] = await Promise.all([
    build("safest", "Safest", seaRoute(origin.center, destination.center, penaltyFor(allHazards, blockAll, 6, ends))),
    build("balanced", "Balanced", seaRoute(origin.center, destination.center, penaltyFor(allHazards, new Set(), 2.5, ends))),
  ]);

  // ---- checkpoint plan: short way to a staging port before the first avoidable hazard, then divert if still needed
  const byAlong = [...avoidable].sort((a, b) => a.atKm - b.atKm);
  const firstRisk = byAlong.find((e) => e.exposure >= 0.5) ?? byAlong.find((e) => e.exposure >= 0.25);
  let checkpoint: Checkpoint | undefined;
  let checkpointRoute: PlannedRoute | null = null;
  if (firstRisk && safest) {
    const entryKm = firstRisk.atKm - hazardById.get(firstRisk.hazardId)!.radiusKm;
    const stage = findStagingPort(origPath, entryKm, s);
    if (stage) {
      const divert = seaRoute(stage.port.center, destination.center, penaltyFor(allHazards, blockAll, 6, ends));
      if (divert) {
        const path = [...pathUntil(origPath, stage.at), stage.port.center, ...divert.slice(1)];
        checkpointRoute = await build("checkpoint", `Via ${stage.port.name}, then divert`, path, `Worst case if the risk is still there at ${stage.port.name}`);
        if (checkpointRoute) {
          const eta = daysAtSpeed(stage.at, s.speedKnots);
          const dDays = +(checkpointRoute.metrics.days - safest.metrics.days).toFixed(1);
          checkpoint = {
            port: stage.port, sharedKm: Math.round(stage.at), etaDays: +eta.toFixed(1), divertPenaltyDays: dDays,
            divertPenaltyUsd: Math.round(checkpointRoute.metrics.totalExpectedUsd - safest.metrics.totalExpectedUsd),
            reassessNote: `Sail the short route to ${stage.port.name} (${Math.round(stage.at).toLocaleString()} km, about ${eta.toFixed(1)} days) before reaching ${firstRisk.title}. Re-run the risk check there: if it has eased, continue on the original route; if not, divert at a cost of ${dDays > 0 ? `${dDays} more days` : "no extra days"} versus rerouting today.`,
          };
        }
      }
    }
  }

  // ---- AI replanner: categorize, prioritize, choose what to avoid, then validate on the sea graph
  let ai: PlanResponse["ai"] = { used: false, note: geminiEnabled() ? undefined : "GEMINI_API_KEY not set: rule-based reasoning" };
  let aiRoute: PlannedRoute | null = null;
  let decision: Decision | undefined;
  let problems: Problem[] | undefined;
  let llmTrace: PlanResponse["llmTrace"];

  const ruleProblems = (): Problem[] =>
    onRoute.slice(0, 6).map((e, i) => {
      const h = hazardById.get(e.hazardId)!;
      return {
        hazardId: e.hazardId, title: e.title, category: e.category, priority: i + 1,
        impact: e.unavoidable
          ? `The ${e.title} zone contains the origin or destination port, so every route is exposed to it.`
          : `Reached about day ${e.etaDays}, ${e.distanceKm} km from the hazard centre; exposure ${(e.exposure * 100).toFixed(0)}%.`,
        reasoning: h.rationale,
      };
    });

  if (geminiEnabled() && onRoute.length) {
    try {
      const { data, model } = await geminiJson<ReplanOut>({
        system:
          "You are Vantage, a voyage risk planner for a container shipping company. Given live hazards on a planned sea route, you (1) categorize and rank each problem by priority for THIS shipment, (2) decide PROCEED, PROCEED_TO_CHECKPOINT (sail the shared part of the route to a staging port, then reassess with fresh data) or REROUTE now, and (3) design a feasible backup route by naming hazard ids to avoid and optional named waypoints. A sea-lane router will build and validate the path, so use only the given ids and waypoint names, and never place a waypoint inside a hazard you avoid. Hazards marked unavoidable contain the origin or destination port and cannot be avoided. Prefer the cheapest plan whose risk is acceptable for the cargo; critical cargo deserves a lower risk tolerance. Weather hazards days ahead are uncertain and may clear; conflict zones persist.",
        prompt: JSON.stringify(
          {
            shipment: { from: origin.name, to: destination.name, cargo: s.cargo, cargoValue: fmtUsd(s.cargoValueUsd), critical: s.critical, speedKnots: s.speedKnots, dailyVesselCost: fmtUsd(s.dailyCostUsd) },
            originalRoute: routeBrief(original),
            computedPriorityRanking: priorities.map((r) => ({ rank: r.rank, hazardId: r.hazardId, priority: r.priority, etaDays: r.etaDays, expectedCostAddedUsd: r.impactUsd, confidence: r.confidence })),
            hazardsOnRoute: onRoute.map((e) => {
              const h = hazardById.get(e.hazardId)!;
              return { id: e.hazardId, title: h.title, category: h.category, score: h.score, radiusKm: h.radiusKm, distanceFromRouteKm: e.distanceKm, reachedOnDay: e.etaDays, unavoidable: e.unavoidable, rationale: h.rationale, evidence: h.evidence.slice(0, 4).map((x) => `${x.time?.slice(0, 10) ?? ""} ${x.source}: ${x.text}`) };
            }),
            precomputedAlternatives: [safest, balanced, checkpointRoute].filter(Boolean).map((r) => routeBrief(r!)),
            checkpointOption: checkpoint ? { port: checkpoint.port.name, reachedOnDay: checkpoint.etaDays, extraDaysIfStillMustDivert: checkpoint.divertPenaltyDays } : null,
            allowedWaypoints: Object.keys(WAYPOINTS),
          },
          null,
          1,
        ),
        schema: REPLAN_SCHEMA,
      });
      ai = { used: true, model };
      decision = data.decision === "PROCEED_TO_CHECKPOINT" && !checkpoint ? "REROUTE" : data.decision;
      const rankOf = new Map(priorities.map((r) => [r.hazardId, r]));
      problems = data.problems
        .filter((p) => hazardById.has(p.hazardId))
        .sort((a, b) => (rankOf.get(a.hazardId)?.rank ?? 99) - (rankOf.get(b.hazardId)?.rank ?? 99))
        .map((p, i) => ({ ...p, priority: i + 1, priorityScore: rankOf.get(p.hazardId)?.priority, title: hazardById.get(p.hazardId)!.title, category: hazardById.get(p.hazardId)!.category }));
      const avoid = new Set(data.avoidHazardIds.filter((id) => hazardById.has(id)));
      const via = data.via.filter((v) => WAYPOINTS[v]);
      const path = seaRouteVia([origin.center, ...via.map((v) => WAYPOINTS[v]), destination.center], penaltyFor(allHazards, avoid, 2, ends));
      let valid = Boolean(path), validation = path ? "" : "no sea path satisfies those constraints";
      if (path) {
        const breaches = [...avoid].map((id) => hazardById.get(id)!).filter((h) => !ends.some((e) => contains(h, e)) && pointPathKm(h.center, path).km < h.radiusKm * 0.9);
        if (breaches.length) { valid = false; validation = `path still crosses ${breaches.map((b) => b.title).join(", ")}`; }
        else if (pathLengthKm(path) > 2.6 * original.metrics.km) { valid = false; validation = "detour is more than 2.6x the original distance"; }
        else validation = `valid: sailable on the sea-lane network and clear of ${avoid.size} avoided hazard(s)`;
      }
      llmTrace = { avoidHazardIds: [...avoid], via, rationale: data.rationale, valid, validation };
      if (valid && path && avoid.size + via.length > 0) aiRoute = await build("ai", "AI replanned", path, data.rationale);
    } catch (e) {
      ai = { used: false, note: `Gemini unavailable (${e instanceof Error ? e.message.slice(0, 140) : e}); rule-based reasoning` };
    }
  }

  const alternatives = [aiRoute, safest, balanced].filter((r): r is PlannedRoute => Boolean(r));
  const backup =
    aiRoute ??
    alternatives.filter((r) => r.metrics.riskScore < original.metrics.riskScore).sort((a, b) => a.metrics.totalExpectedUsd - b.metrics.totalExpectedUsd)[0] ??
    safest ??
    original;

  if (!decision) {
    const r = original.metrics.riskScore;
    const tolerance = s.critical ? 35 : 55;
    const gain = r - backup.metrics.riskScore;
    const pays = backup.metrics.totalExpectedUsd < original.metrics.totalExpectedUsd;
    const transient = firstRisk && ["tropical-cyclone", "severe-weather", "earthquake", "volcano"].includes(firstRisk.category);
    if (r < 20 || gain < 10 || !pays) decision = "PROCEED";
    else if (checkpoint && (transient || r < tolerance)) decision = "PROCEED_TO_CHECKPOINT";
    else decision = "REROUTE";
  }
  problems ??= ruleProblems();

  const recommended: PlannedRoute = decision === "PROCEED" ? original : decision === "PROCEED_TO_CHECKPOINT" ? original : backup;
  const justification = justify(original, backup, [aiRoute, safest, balanced], checkpoint, checkpointRoute, recommended.id);
  step({
    type: "step", step: "decide",
    summary:
      decision === "PROCEED" ? `Proceed on the original route (risk ${original.metrics.riskScore}/100)`
      : decision === "REROUTE" ? `Reroute via ${backup.label}: risk ${justification.riskBefore} to ${justification.riskAfter}, ${justification.extraDays >= 0 ? "+" : ""}${justification.extraDays} days, expected cost ${justification.netSavingUsd >= 0 ? "saves" : "adds"} ${fmtUsd(Math.abs(justification.netSavingUsd))}`
      : `Sail to ${checkpoint?.port.name}, reassess there (risk ${original.metrics.riskScore}/100 ahead)`,
    decision, recommendedRouteId: recommended.id, justification, rationale: llmTrace?.rationale, validation: llmTrace?.validation,
  });
  progress("explain", ai.used ? "Gemini is writing the plain-English explanation" : "Writing the explanation");

  // ---- explanation
  const o = original.metrics, b = backup.metrics;
  const avoided = o.exposures.filter((e) => !e.unavoidable && !b.exposures.some((x) => x.hazardId === e.hazardId && x.exposure > e.exposure * 0.5));
  let explanation: PlanResponse["explanation"] = {
    headline:
      decision === "PROCEED"
        ? `Proceed on the original route: avoidable risk is ${o.riskScore}/100 and a detour would not pay for itself.`
        : decision === "REROUTE"
          ? `Reroute now: the original route scores ${o.riskScore}/100 risk; the backup cuts it to ${b.riskScore}/100 for ${(b.days - o.days).toFixed(1)} extra days.`
          : `Sail to ${checkpoint?.port.name} on the shared leg, then reassess: risk ahead is ${o.riskScore}/100 but may change before you reach it.`,
    whyOriginal: problems.length
      ? `The original route crosses ${problems.map((p) => `${p.title} (${CATEGORY_LABEL[p.category]})`).join(", ")}. ${problems[0]?.reasoning ?? ""}`
      : "No live hazard sits on the original route.",
    whyBackup:
      decision === "PROCEED"
        ? "A backup is kept as a contingency only."
        : `Expected cost on the original route is ${fmtUsd(o.totalExpectedUsd)}, including ${fmtUsd(o.warRiskPremiumUsd)} war-risk premium and ${fmtUsd(o.expectedDisruptionUsd)} expected disruption.`,
    howBackupAverts: `The backup keeps clear of ${avoided.map((e) => e.title).join(", ") || "the worst hazards"}, cutting risk from ${o.riskScore} to ${b.riskScore}.`,
    tradeoffs: `${(b.km - o.km).toLocaleString()} km and ${(b.days - o.days).toFixed(1)} days more; expected total ${fmtUsd(b.totalExpectedUsd)} vs ${fmtUsd(o.totalExpectedUsd)}.`,
    actions: [
      decision === "REROUTE" ? `Instruct the master to follow the ${backup.label.toLowerCase()} route` : decision === "PROCEED" ? "Keep the original booking" : `Book to ${checkpoint?.port.name} with an option to divert`,
      checkpoint ? `Reassess at ${checkpoint.port.name} (day ${checkpoint.etaDays})` : "Re-run Vantage every 12 hours while underway",
      "Tell the consignee the revised ETA",
    ],
  };
  if (ai.used) {
    try {
      const { data } = await geminiJson<PlanResponse["explanation"]>({
        system:
          "You are Vantage, explaining a voyage risk decision to a shipping company's operations manager who is not a risk expert. Be concrete and quantitative, cite the live evidence (events, dates, traffic numbers), and keep each field to 2-3 sentences. Use only the numbers given. Risk scores are 0-100 indexes, not probabilities.",
        prompt: JSON.stringify(
          {
            shipment: { from: origin.name, to: destination.name, cargo: s.cargo, cargoValue: fmtUsd(s.cargoValueUsd), critical: s.critical },
            decision, recommendedRoute: recommended.id,
            problemsRanked: problems.map((p) => ({ priority: p.priority, title: p.title, category: CATEGORY_LABEL[p.category], impact: p.impact, reasoning: p.reasoning })),
            original: routeBrief(original), backup: routeBrief(backup),
            checkpoint: checkpoint ? { port: checkpoint.port.name, reachedOnDay: checkpoint.etaDays, extraDaysIfStillMustDivert: checkpoint.divertPenaltyDays, note: checkpoint.reassessNote } : null,
            replannerRationale: llmTrace?.rationale, routerValidation: llmTrace?.validation,
          },
          null,
          1,
        ),
        schema: EXPLAIN_SCHEMA,
        temperature: 0.3,
      });
      explanation = data;
    } catch {
      /* keep the rule-based explanation */
    }
  }

  step({ type: "step", step: "explain", summary: explanation.headline, explanation });

  const routes = [original, ...alternatives, checkpointRoute].filter((r): r is PlannedRoute => Boolean(r));
  const distinct = routes.filter(
    (r, i) => i === 0 || r.id === "ai" || r.id === backup.id || routes.slice(0, i).every((q) => Math.abs(q.metrics.km - r.metrics.km) > q.metrics.km * 0.01),
  );

  return {
    generatedAt: new Date().toISOString(),
    shipment: { ...s, origin, destination },
    ai, decision, recommendedRouteId: recommended.id, backupRouteId: backup.id, routes: distinct, problems, checkpoint, explanation, llmTrace,
    hazards: allHazards,
    priorities, justification, pipeline,
  };
}
