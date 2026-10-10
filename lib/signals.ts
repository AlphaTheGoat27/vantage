import { cached } from "./cache";
import { geminiEnabled, geminiJson } from "./gemini";
import { haversineKm } from "./geo";
import { eonetHazards, gdacsHazards, newsSignals, portwatchChokepoints, type ZoneNews } from "./sources";
import type { Chokepoint, Hazard, HazardCategory, SignalsResponse } from "./types";

const combine = (...s: number[]) => Math.round(100 * (1 - s.reduce((p, x) => p * (1 - Math.min(99, x) / 100), 1)));

function trafficSignal(c: Chokepoint): number {
  if (c.changePct === undefined || c.baseline === undefined || c.baseline < 3) return 0;
  return c.changePct < -15 ? Math.min(90, Math.round(-c.changePct * 1.3)) : 0;
}

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
  const [pw, gdacs, eonet, news] = await Promise.all([portwatchChokepoints(), gdacsHazards(), eonetHazards(), newsSignals()]);
  const chokepoints = pw.data;

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
    });
  }

  // chokepoints outside watch zones whose traffic collapsed
  for (const c of chokepoints) {
    const t = trafficSignal(c);
    if (t < 25 || hazards.some((h) => haversineKm(h.center, c.center) < h.radiusKm)) continue;
    hazards.push({
      id: `pw-${c.id}`, title: `${c.name} traffic drop`, category: "chokepoint-disruption", center: c.center, radiusKm: 120, score: t, signalScore: t,
      rationale: `Transits fell ${Math.abs(c.changePct!).toFixed(0)}% below the 90-day baseline, a sign ships are avoiding or being held at this chokepoint.`,
      evidence: [{ source: "IMF PortWatch", text: `${c.avg7?.toFixed(1)} transits/day vs ${c.baseline?.toFixed(1)} baseline`, time: c.asOf }],
      sources: ["IMF PortWatch"], updated: c.asOf,
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
  hazards.sort((a, b) => b.score - a.score);

  return {
    generatedAt: new Date().toISOString(),
    ai: { enabled: geminiEnabled(), model: ai.model, note: ai.note },
    sources: [pw.status, ...news.statuses, gdacs.status, eonet.status],
    hazards,
    chokepoints,
  };
}
