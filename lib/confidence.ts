/**
 * Confidence (0-100%) that a hazard is real and correctly scored. Shown next to every risk score.
 *
 *   confidence = 100 * ( 0.30 * agreement + 0.25 * freshness + 0.30 * certainty + 0.15 * completeness )
 *
 *  agreement    independent source families that support the hazard (traffic, news, official alerts, AIS) / 3, capped at 1
 *  freshness    1 for evidence <= 6 h old, decaying linearly to 0.2 at 14 days
 *  certainty    mean of the signals we have: Gemini's stated confidence, and the trained model
 *               (observed drop = 1.0, otherwise its calibrated probability scaled against the alert threshold)
 *  completeness share of the inputs this hazard relies on that were actually available (not failed / not a fallback)
 */
import type { Hazard } from "./types";

export type ConfidenceContext = {
  now: number;
  /** hazard source tokens ("News", "IMF PortWatch", "GDACS", ...) whose feed failed or is only a bundled snapshot */
  degraded: Set<string>;
};

const family = (source: string): "traffic" | "news" | "official" | "ais" | "ai" | "model" | "other" => {
  if (/portwatch/i.test(source)) return "traffic";
  if (/ais/i.test(source) && !/news/i.test(source)) return "ais";
  if (/gdacs|eonet|nasa|open-meteo/i.test(source)) return "official";
  if (/gemini/i.test(source)) return "ai";
  if (/model/i.test(source)) return "model";
  return "news"; // headline publishers (Reuters, AP, ...) and "News"
};

const AI_CONF = { low: 0.35, medium: 0.65, high: 0.9 } as const;

export function scoreConfidence(h: Hazard, ctx: ConfidenceContext): { score: number; reason: string } {
  const fams = new Set<string>();
  for (const e of h.evidence) {
    const f = family(e.source);
    if (f !== "ai" && f !== "model" && f !== "other") fams.add(f);
  }
  for (const s of h.sources) {
    const f = family(s);
    if (f === "traffic" || f === "official" || f === "ais") fams.add(f);
    else if (f === "news" && /news/i.test(s)) fams.add("news");
  }
  const agreement = Math.min(1, fams.size / 3);

  const times = [h.updated, ...h.evidence.map((e) => e.time)].map((t) => (t ? Date.parse(t) : NaN)).filter((t) => !Number.isNaN(t));
  const newest = times.length ? Math.max(...times) : NaN;
  const ageH = Number.isNaN(newest) ? NaN : Math.max(0, (ctx.now - newest) / 3600_000);
  const freshness = Number.isNaN(ageH) ? 0.4 : ageH <= 6 ? 1 : Math.max(0.2, 1 - (0.8 * (ageH - 6)) / (14 * 24 - 6));

  const parts: number[] = [];
  if (h.confidence) parts.push(AI_CONF[h.confidence]);
  if (h.model) {
    const m = h.model;
    if (m.observedDrop) parts.push(1);
    else if (m.probability !== null) parts.push(Math.min(1, m.probability / 0.3));
  }
  if (!parts.length) parts.push(Math.min(0.6, h.signalScore / 100));
  const certainty = parts.reduce((a, b) => a + b, 0) / parts.length;

  const relied = [...new Set(h.sources)];
  const bad = relied.filter((s) => ctx.degraded.has(s));
  const completeness = relied.length ? 1 - bad.length / relied.length : 0.5;

  const score = Math.round(100 * (0.3 * agreement + 0.25 * freshness + 0.3 * certainty + 0.15 * completeness));
  const level = score >= 70 ? "High" : score >= 45 ? "Medium" : "Low";
  const age = Number.isNaN(ageH) ? "age unknown" : ageH < 1 ? "under 1 h old" : ageH < 48 ? `${Math.round(ageH)} h old` : `${Math.round(ageH / 24)} days old`;
  const names = [...fams].map((f) => ({ traffic: "ship traffic", news: "news", official: "official alerts", ais: "AIS" })[f as "traffic"] ?? f);
  const missing = bad.length ? `, ${bad.join(" + ")} on fallback or failed` : "";
  return {
    score,
    reason: `${level}: ${fams.size} independent source${fams.size === 1 ? "" : "s"} ${fams.size === 1 ? "reports" : "agree"}${names.length ? ` (${names.join(", ")})` : ""}, newest data ${age}${missing}`,
  };
}
