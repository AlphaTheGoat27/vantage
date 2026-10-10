import { cached } from "./cache";
import { geminiEnabled, geminiJson } from "./gemini";
import { haversineKm } from "./geo";
import { aisConfigured, aisSnapshot, type AisRegion } from "./ais";
import { scoreConfidence } from "./confidence";
import { MODEL_INFO, predictAll, type Prediction } from "./model";
import { eonetHazards, gdacsHazards, newsSignals, newsWeekly, portwatchChokepoints, portwatchHistory, type ZoneNews } from "./sources";
import type { Chokepoint, ChokepointModel, Dismissed, Hazard, HazardCategory, SignalsResponse, SourceStatus } from "./types";

const combine = (...s: number[]) => Math.round(100 * (1 - s.reduce((p, x) => p * (1 - Math.min(99, x) / 100), 1)));

function trafficSignal(c: Chokepoint): number {
  if (c.changePct === undefined || c.baseline === undefined || c.baseline < 3) return 0;
  return c.changePct < -15 ? Math.min(90, Math.round(-c.changePct * 1.3)) : 0;
}

/** 0-90 score from the trained model: only a persistent *predicted* alert counts (observed drops are already in trafficSignal). */
function modelScore(m?: ChokepointModel): number {
  if (!m || m.alertKind !== "predicted" || m.probability === null) return 0;
  return Math.min(90, Math.round((100 * m.probability) / 0.5));
}

function aisHazard(r: AisRegion, score: number, evidence: Hazard["evidence"], time?: string): Hazard {
  return {
    id: `ais-${r.id}`, title: `${r.name}: AIS anomaly`, category: "ais-anomaly", center: r.center, radiusKm: r.radiusKm, score, signalScore: score,
    rationale: `Live AIS shows ${r.anomalies.map((a) => a.detail).join("; ")}.`, evidence, sources: ["AISStream.io"], updated: time,
  };
}

const toModel = (p: Prediction): ChokepointModel => ({
  ratio7: p.ratio7, probability: p.probability, horizonDays: MODEL_INFO.horizonDays, observedDrop: p.observedDrop, alert: p.alert,
  alertKind: p.alertKind, forecast: p.forecast, newsSurge: p.newsSurge,
  drivers: p.contributions.map((c) => ({ feature: c.feature, value: c.value, contribution: c.contribution })),
});

type ZoneAssessment = {
  id: string;
  category: HazardCategory;
  severity: number;
  confidence: "low" | "medium" | "high";
  threatToShipping: boolean;
  rationale: string;
};

const ZONE_SCHEMA = {
  type: "OBJECT",
  properties: {
    zones: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          category: { type: "STRING", enum: ["armed-conflict", "piracy", "military-tension", "chokepoint-disruption", "congestion", "severe-weather"] },
          severity: { type: "INTEGER", description: "0-100 risk to a merchant ship transiting in the next 14 days" },
          confidence: { type: "STRING", enum: ["low", "medium", "high"] },
          threatToShipping: { type: "BOOLEAN", description: "false when headlines are commentary, land-only fighting or unrelated to ships" },
          rationale: { type: "STRING", description: "max 2 sentences, cite the concrete evidence (dates, events, numbers)" },
        },
        required: ["id", "category", "severity", "confidence", "threatToShipping", "rationale"],
      },
    },
  },
  required: ["zones"],
};

async function assessZones(zones: { z: ZoneNews; chokepoints: Chokepoint[]; signal: number }[]): Promise<{ map: Map<string, ZoneAssessment>; model?: string; note?: string }> {
  if (!geminiEnabled() || zones.length === 0) return { map: new Map(), note: geminiEnabled() ? undefined : "GEMINI_API_KEY not set: scores use live signals only" };
  const today = new Date().toISOString().slice(0, 10);
  const payload = zones.map(({ z, chokepoints, signal }) => ({
    id: z.zone.id,
    name: z.zone.name,
    signalScore: signal,
    chokepointTraffic: chokepoints.map((c) => `${c.name}: ${c.avg7?.toFixed(1)} transits/day last 7d vs ${c.baseline?.toFixed(1)} baseline (${c.changePct?.toFixed(0)}%), as of ${c.asOf}`),
    headlines: z.headlines.slice(0, 10).map((h) => `${h.time.slice(0, 10)} | ${h.source} | ${h.title}`),
  }));
  const key = `zone-ai-${JSON.stringify(payload).length}-${payload.map((p) => p.headlines[0] ?? "").join("|").slice(0, 400)}`;
  try {
    const { data, model } = await cached(key, 30 * 60_000, () =>
      geminiJson<{ zones: ZoneAssessment[] }>({
        system:
          "You are a maritime security analyst for a container shipping line. You read live news headlines and chokepoint traffic data and rate the risk each sea zone poses to a merchant vessel transiting it in the next 14 days. Be calibrated and avoid false alarms: commentary, diplomacy, land-only fighting or old events lower severity; confirmed attacks on ships, seizures, closures or big traffic drops raise it. Use only the evidence given.",
        prompt: `Today is ${today}. Assess each zone and return one entry per zone id.\n\n${JSON.stringify(payload, null, 1)}`,
        schema: ZONE_SCHEMA,
      }),
    );
    return { map: new Map(data.zones.map((a) => [a.id, a])), model };
  } catch (e) {
    return { map: new Map(), note: `Gemini assessment failed (${e instanceof Error ? e.message.slice(0, 120) : e}); using live signals only` };
  }
}

export async function getSignals(): Promise<SignalsResponse> {
  const aisPromise = aisConfigured() ? aisSnapshot() : Promise.resolve(undefined);
  const [pw, gdacs, eonet, news] = await Promise.all([portwatchChokepoints(), gdacsHazards(), eonetHazards(), newsSignals()]);
  const chokepoints = pw.data;

  // trained model: needs ~200 days of per-chokepoint history and the weekly headline counts
  const asOf = chokepoints.find((c) => c.asOf)?.asOf;
  const [history, weekly] = await Promise.all([
    portwatchHistory().catch(() => []),
    asOf ? newsWeekly(asOf) : Promise.resolve(undefined),
  ]);
  let modelInfo: NonNullable<SignalsResponse["model"]> = { version: MODEL_INFO.version, trainedThrough: MODEL_INFO.trainedThrough, horizonDays: MODEL_INFO.horizonDays, asOf, ok: false };
  try {
    if (!history.length || !weekly) throw new Error("no chokepoint history");
    const preds = predictAll(history, weekly.data);
    const byName = new Map(preds.map((p) => [p.name, p]));
    for (const c of chokepoints) {
      const p = byName.get(c.name);
      if (p?.valid) c.model = toModel(p);
    }
    modelInfo = { ...modelInfo, ok: true };
  } catch (e) {
    modelInfo = { ...modelInfo, note: `trained model unavailable (${e instanceof Error ? e.message : e}); rule-based traffic score only` };
  }
  const dismissed: Dismissed[] = [];

  const zoneInputs = news.zones.map((z) => {
    const cps = chokepoints.filter((c) => haversineKm(c.center, z.zone.center) <= z.zone.radiusKm + 100);
    const traffic = Math.max(0, ...cps.map(trafficSignal));
    return { z, chokepoints: cps, signal: combine(z.signal, traffic) };
  });
  const relevant = zoneInputs.filter((x) => x.signal >= 10 || x.z.headlines.length > 0);
  const ai = await assessZones(relevant);

  const hazards: Hazard[] = [];
  for (const { z, chokepoints: cps, signal } of relevant) {
    const a = ai.map.get(z.zone.id);
    let score = signal;
    if (a) score = a.threatToShipping ? Math.round(0.4 * signal + 0.6 * a.severity) : Math.min(25, Math.round(0.3 * signal + 0.7 * a.severity));
    // trained model: the strongest chokepoint inside the zone (observed drop first, then highest probability)
    const withModel = cps.filter((c) => c.model);
    const lead = [...withModel].sort((x, y) => Number(y.model!.observedDrop) - Number(x.model!.observedDrop) || (y.model!.probability ?? 0) - (x.model!.probability ?? 0))[0];
    const mScore = Math.max(0, ...withModel.map((c) => modelScore(c.model)));
    if (mScore > score) score = mScore;
    if (a && !a.threatToShipping) dismissed.push({ id: `zone-${z.zone.id}`, title: z.zone.name, reason: `Gemini read ${z.headlines.length} headline(s) as commentary or non-maritime, not a threat to ships (raw signal ${signal}, capped at 25): ${a.rationale}` });
    hazards.push({
      id: `zone-${z.zone.id}`,
      title: z.zone.name,
      category: a?.category ?? z.zone.defaultCategory,
      center: z.zone.center,
      radiusKm: z.zone.radiusKm,
      score,
      signalScore: signal,
      aiScore: a?.severity,
      confidence: a?.confidence,
      rationale:
        a?.rationale ??
        `${z.headlines.length} relevant headlines in the last 7 days${cps.length ? `; ${cps.map((c) => `${c.name} traffic ${c.changePct?.toFixed(0)}% vs baseline`).join(", ")}` : ""}.`,
      evidence: [
        ...cps
          .filter((c) => c.changePct !== undefined)
          .map((c) => ({ source: "IMF PortWatch", text: `${c.name}: ${c.avg7?.toFixed(1)} transits/day (7d) vs ${c.baseline?.toFixed(1)} baseline, ${c.changePct! >= 0 ? "+" : ""}${c.changePct!.toFixed(0)}%`, time: c.asOf })),
        ...z.headlines.slice(0, 6).map((h) => ({ source: h.source, text: h.title, url: h.url, time: h.time })),
      ],
      sources: [...new Set(["News", ...(cps.length ? ["IMF PortWatch"] : []), ...(a ? ["Gemini"] : [])])],
      updated: z.headlines[0]?.time,
      model: lead?.model ? { chokepoint: lead.name, ...lead.model } : undefined,
    });
  }

  // chokepoints outside watch zones whose traffic collapsed
  for (const c of chokepoints) {
    const t = Math.max(trafficSignal(c), modelScore(c.model));
    if (t < 25 || hazards.some((h) => haversineKm(h.center, c.center) < h.radiusKm)) continue;
    hazards.push({
      id: `pw-${c.id}`, title: `${c.name} traffic drop`, category: "chokepoint-disruption", center: c.center, radiusKm: 120, score: t, signalScore: t,
      rationale: c.model?.alertKind === "predicted"
        ? `Trained model flags a ${(100 * (c.model.probability ?? 0)).toFixed(0)}% chance of a sustained traffic collapse within ${MODEL_INFO.horizonDays} days (traffic still at ${Math.round((c.model.ratio7 ?? 1) * 100)}% of normal).`
        : `Transits fell ${Math.abs(c.changePct ?? 0).toFixed(0)}% below the 90-day baseline, a sign ships are avoiding or being held at this chokepoint.`,
      evidence: [{ source: "IMF PortWatch", text: `${c.avg7?.toFixed(1)} transits/day vs ${c.baseline?.toFixed(1)} baseline`, time: c.asOf }],
      sources: ["IMF PortWatch"], updated: c.asOf, model: c.model ? { chokepoint: c.name, ...c.model } : undefined,
    });
  }

  const sameStorm = (e: Hazard, g: Hazard) =>
    g.category === e.category &&
    (haversineKm(g.center, e.center) < 800 || g.title.toLowerCase().split(/[\s-]+/).some((w) => w.length > 3 && e.title.toLowerCase().includes(w) && w !== "cyclone"));
  hazards.push(...gdacs.data, ...eonet.data.filter((e) => !gdacs.data.some((g) => sameStorm(e, g))));
  for (const h of hazards) {
    h.score = Math.round(h.score);
    h.signalScore = Math.round(h.signalScore);
  }
  // live AIS: anomalies in a zone raise that zone's hazard (a new, independent source family); otherwise they become their own hazard
  const ais = await aisPromise;
  const aisStatus: SourceStatus | undefined = ais?.configured
    ? { name: "AISStream.io live AIS", url: "https://aisstream.io", ok: ais.ok, count: ais.shipCount, note: ais.ok ? `${ais.shipCount} ships sampled over ${ais.seconds}s; ${ais.regions.reduce((n, r) => n + r.anomalies.length, 0)} anomalies` : ais.note }
    : undefined;
  for (const r of ais?.regions ?? []) {
    if (!r.anomalies.length) continue;
    const sev = Math.max(...r.anomalies.map((a) => a.severity));
    const aScore = Math.min(80, Math.round(25 + 0.6 * sev));
    const ev = r.anomalies.map((a) => ({ source: "AISStream.io", text: `${a.kind}: ${a.detail}`, time: ais!.sampledAt }));
    const zone = hazards.find((h) => h.id === `zone-${r.id}`);
    if (zone) {
      zone.score = combine(zone.score, Math.round(aScore * 0.6));
      zone.signalScore = combine(zone.signalScore, Math.round(aScore * 0.6));
      zone.evidence.unshift(...ev);
      if (!zone.sources.includes("AISStream.io")) zone.sources.push("AISStream.io");
      zone.updated = ais!.sampledAt;
    } else {
      hazards.push(aisHazard(r, aScore, ev, ais!.sampledAt));
    }
  }
  hazards.sort((a, b) => b.score - a.score);

  // false-alarm filtering report: what was screened, what was dismissed, and why
  for (const z of zoneInputs) {
    if (!relevant.includes(z)) dismissed.push({ id: `zone-${z.z.zone.id}`, title: z.z.zone.name, reason: "no relevant headlines and no traffic anomaly in the last 7 days" });
  }
  for (const c of chokepoints) {
    const m = c.model;
    if (!m || m.alert || c.changePct === undefined || c.changePct > -8 || trafficSignal(c) > 0) continue;
    dismissed.push({ id: `pw-${c.id}`, title: `${c.name} traffic dip`, reason: `7-day traffic is ${Math.abs(c.changePct).toFixed(0)}% below baseline, inside normal variation; model P(disruption)=${((m.probability ?? 0) * 100).toFixed(0)}% is below the alert threshold` });
  }
  const sources: SourceStatus[] = [pw.status, ...(weekly ? [weekly.status] : []), ...news.statuses, gdacs.status, eonet.status, ...(aisStatus ? [aisStatus] : [])];
  const flagged = hazards.filter((h) => h.score >= 25).length;
  // hazard-source tokens whose feed failed or is only a bundled snapshot (GDELT is an optional second source, so it does not count)
  const degraded = new Set<string>();
  const bad = (st?: SourceStatus) => Boolean(st && (!st.ok || st.fallback));
  if (bad(pw.status)) degraded.add("IMF PortWatch");
  if (bad(news.statuses[0])) degraded.add("News");
  if (bad(gdacs.status)) degraded.add("GDACS");
  if (bad(aisStatus)) degraded.add("AISStream.io");
  if (bad(eonet.status)) degraded.add("NASA EONET");
  if (geminiEnabled() && !ai.model) degraded.add("Gemini");
  const now = Date.now();
  for (const h of hazards) {
    const c = scoreConfidence(h, { now, degraded });
    h.confidenceScore = c.score;
    h.confidenceReason = c.reason;
  }

  return {
    generatedAt: new Date().toISOString(),
    ai: { enabled: geminiEnabled(), model: ai.model, note: ai.note },
    sources,
    hazards,
    chokepoints,
    filtering: { screened: chokepoints.length + zoneInputs.length + gdacs.data.length + eonet.data.length, flagged, dismissed },
    model: modelInfo,
  };
}
