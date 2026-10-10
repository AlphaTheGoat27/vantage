// Red Sea case study (Nov 2023 onward) for the slides: when would each Vantage layer have alerted, and what would rerouting early have saved?
//
// Replays the app's *deterministic* detection layers on historical data (no Gemini, no live feeds except the sea-lane router):
//   - news layer: Google News headlines for the Red Sea watch zone, 7 days ending each day, scored with the app's lexicon (lib/sources.ts headlineWeight)
//   - traffic layer: IMF PortWatch 7d-vs-90d drop scored exactly like lib/signals.ts trafficSignal()
//   - trained model: the walk-forward predictions from ml/backtest.py (read from ml/out/redsea_model.json)
// Then prices "stay on the Suez route" vs "go around the Cape" with the app's own cost model (lib/planner.ts) at several alert dates.
//
// Caveat printed in the output: Google News indexes today's view of old articles, so the news replay is indicative, not a tick-exact record.
// Run: npx tsx scripts/case-study-redsea.mts   (after: python ml/case_study_prep.py)
import { readFileSync, writeFileSync } from "node:fs";
import { headlineWeight } from "../lib/sources";
import { planShipment } from "../lib/planner";
import type { Hazard } from "../lib/types";

delete process.env.GEMINI_API_KEY; // deterministic, rule-based replanner for a reproducible case study

const ROOT = new URL("../", import.meta.url);
const QUERY = '("Red Sea" OR "Bab el-Mandeb" OR Houthi) (ship OR vessel OR tanker OR shipping OR containership OR freighter)';
const MUST = /red sea|bab el|mandeb|houthi|yemen|hodeidah/i;
const dayMs = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

async function headlines(endMs: number) {
  const q = encodeURIComponent(`${QUERY} after:${iso(endMs - 7 * dayMs)} before:${iso(endMs)}`);
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(String(res.status));
      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
      return items.map((it) => ({
        title: (/<title>([\s\S]*?)<\/title>/.exec(it)?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
        time: Date.parse(/<pubDate>([\s\S]*?)<\/pubDate>/.exec(it)?.[1] ?? ""),
      }));
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return [];
}

// ---- traffic layer from the PortWatch CSV (same maths as lib/signals.ts)
const rows = readFileSync(new URL("data/raw/portwatch_daily.csv", ROOT), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const series = (name: string) => rows.filter((r) => r[2] === name).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((r) => ({ d: r[0], n: Number(r[9]) }));
const bab = series("Bab el-Mandeb Strait");
function trafficAt(date: string) {
  const i = bab.findIndex((x) => x.d === date);
  if (i < 97) return { change: NaN, score: 0, r7: NaN };
  const avg = (a: { n: number }[]) => a.reduce((s, x) => s + x.n, 0) / a.length;
  const m7 = avg(bab.slice(i - 6, i + 1)), base = avg(bab.slice(i - 96, i - 6));
  const change = ((m7 - base) / base) * 100;
  return { change, r7: m7 / base, score: change < -15 ? Math.min(90, Math.round(-change * 1.3)) : 0 };
}
const combine = (...s: number[]) => Math.round(100 * (1 - s.reduce((p, x) => p * (1 - Math.min(99, x) / 100), 1)));

const days: { date: string; headlines: number; mass: number; news: number; traffic: number; combined: number; r7: number }[] = [];
for (let t = Date.parse("2023-11-05"); t <= Date.parse("2024-01-15"); t += dayMs) {
  const items = (await headlines(t)).filter((h) => MUST.test(h.title));
  const mass = items.reduce((s, h) => s + headlineWeight(h.title) * ((t - h.time) / 3600_000 < 72 ? 1 : 0.5), 0);
  const news = Math.round(100 * (1 - Math.exp(-mass / 7)));
  const tr = trafficAt(iso(t));
  days.push({ date: iso(t), headlines: items.length, mass: +mass.toFixed(1), news, traffic: tr.score, combined: combine(news, tr.score), r7: +tr.r7.toFixed(3) });
  process.stdout.write(`\r${iso(t)} headlines=${items.length} news=${news} traffic=${tr.score}   `);
}
console.log();

const firstAtOrAbove = (k: "news" | "combined", v: number) => days.find((d) => d[k] >= v)?.date;
const alertDates = { newsLayer45: firstAtOrAbove("news", 45), newsLayer70: firstAtOrAbove("news", 70), combined45: firstAtOrAbove("combined", 45) };

// ---- price the decision at several dates with the app's cost model
const redSea: Omit<Hazard, "score" | "signalScore"> = {
  id: "zone-red-sea", title: "Southern Red Sea & Bab el-Mandeb", category: "armed-conflict", center: [42.3, 14.8], radiusKm: 520,
  rationale: "Replayed Red Sea hazard", evidence: [{ source: "replay", text: "replay" }], sources: ["News"],
};
const ship = { originId: "SGSIN", destinationId: "NLRTM", cargo: "Containerised electronics", cargoValueUsd: 85e6, speedKnots: 16, dailyCostUsd: 60000, hullValueUsd: 120e6, critical: true };
const pricing: unknown[] = [];
const checkDates = [alertDates.newsLayer45, alertDates.newsLayer70, "2023-12-15", "2023-12-19", "2023-12-22", "2024-01-02"].filter((d, i, a): d is string => Boolean(d) && a.indexOf(d) === i).sort();
for (const date of checkDates) {
  const d = days.find((x) => x.date === date);
  if (!d) continue;
  const score = d.combined;
  const plan = await planShipment(ship, [{ ...redSea, score, signalScore: score }], []);
  const o = plan.routes.find((r) => r.id === "original")!.metrics;
  const b = plan.routes.find((r) => r.id === plan.backupRouteId)!.metrics;
  pricing.push({
    date, score, decision: plan.decision, originalDays: o.days, backupDays: b.days, originalRisk: o.riskScore, backupRisk: b.riskScore,
    originalExpectedUsd: o.totalExpectedUsd, backupExpectedUsd: b.totalExpectedUsd, netSavingUsd: o.totalExpectedUsd - b.totalExpectedUsd,
    extraVoyageCostUsd: b.voyageCostUsd - o.voyageCostUsd, warRiskPremiumAvoidedUsd: o.warRiskPremiumUsd - b.warRiskPremiumUsd, expectedDisruptionAvoidedUsd: o.expectedDisruptionUsd - b.expectedDisruptionUsd,
  });
  console.log(`${date}: score ${score} -> ${plan.decision}; original ${o.days}d risk ${o.riskScore} expected $${(o.totalExpectedUsd / 1e6).toFixed(2)}M vs backup ${b.days}d risk ${b.riskScore} $${(b.totalExpectedUsd / 1e6).toFixed(2)}M`);
}

writeFileSync(new URL("ml/out/redsea_case.json", ROOT), JSON.stringify({ generated: new Date().toISOString(), query: QUERY, alertDates, days, pricing, shipment: ship }, null, 1));
console.log("alert dates (replayed layers):", alertDates);
console.log("wrote ml/out/redsea_case.json. Caveat: Google News serves today's index of old articles, so the news replay is indicative.");
