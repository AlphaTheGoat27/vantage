// Runs the five dashboard demo voyages against the labeled demo scenario (lib/demo.ts) through the REAL planner
// (sea-lane routing, cost model, Open-Meteo waves, Gemini replanner + explainer) and prints what each one decides.
//
//   npx tsx --env-file=.env.local scripts/demo-check.mts           # with Gemini (needs GEMINI_API_KEY)
//   npx tsx --env-file=.env.local scripts/demo-check.mts --rules   # rule-based fallback only (no Gemini calls)
//   add --verbose to also print exposures, the checkpoint verdict and the explanation headline; --only=AEJEA,MYPKG filters by origin
import { getDemoSignals } from "../lib/demo";
import { planShipment } from "../lib/planner";
import type { PlanResponse, ShipmentInput } from "../lib/types";

const args = new Set(process.argv.slice(2));
if (args.has("--rules")) delete process.env.GEMINI_API_KEY;
const verbose = args.has("--verbose");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");

// keep in sync with PRESETS in components/Dashboard.tsx (form defaults: 16 kn, $60k/day, $120M hull)
const PRESETS = [
  { label: "Shanghai -> Rotterdam", o: "CNSHA", d: "NLRTM", cargo: "Semiconductors", value: 85e6, critical: true },
  { label: "Port Klang -> Hamburg", o: "MYPKG", d: "DEHAM", cargo: "Medical gloves", value: 18e6, critical: false },
  { label: "Jebel Ali -> Rotterdam", o: "AEJEA", d: "NLRTM", cargo: "Petrochemicals", value: 40e6, critical: false },
  { label: "Houston -> Shanghai", o: "USHOU", d: "CNSHA", cargo: "LNG equipment", value: 60e6, critical: true },
  { label: "Busan -> Los Angeles", o: "KRPUS", d: "USLAX", cargo: "EV batteries", value: 70e6, critical: true },
];

const usd = (n: number) => `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1e6).toFixed(2)}M`;

const signals = getDemoSignals();
// tuning aid: --set=demo-red-sea:60,demo-gulf-of-aden:30 overrides hazard scores for this run only
for (const kv of process.argv.find((a) => a.startsWith("--set="))?.slice(6).split(",") ?? []) {
  const [id, v] = kv.split(":");
  const h = signals.hazards.find((x) => x.id === id);
  if (h) h.score = h.signalScore = Number(v);
}
if (!signals.demo) throw new Error("demo signals must carry the demo badge");
console.log(`Scenario: ${signals.demo.scenario}\n${signals.demo.note}`);
console.log(`${signals.hazards.length} hazards, ${signals.chokepoints.length} chokepoints, ${signals.filtering?.dismissed.length} dismissed; Gemini ${process.env.GEMINI_API_KEY ? "on" : "off (rule-based)"}\n`);

const rows: Record<string, string | number>[] = [];
for (const p of PRESETS.filter((x) => !only || only.includes(x.o))) {
  const input: ShipmentInput = {
    originId: p.o, destinationId: p.d, cargo: p.cargo, cargoValueUsd: p.value, critical: p.critical,
    speedKnots: 16, dailyCostUsd: 60000, hullValueUsd: 120e6, extraHazards: [],
  };
  const t0 = Date.now();
  let plan: PlanResponse;
  try {
    plan = await planShipment(input, signals.hazards, signals.chokepoints, { sources: signals.sources });
  } catch (e) {
    console.log(`${p.label}: FAILED ${e instanceof Error ? e.message : e}`);
    continue;
  }
  const j = plan.justification;
  const rec = plan.routes.find((r) => r.id === plan.recommendedRouteId)!;
  const orig = plan.routes.find((r) => r.id === "original")!;
  rows.push({
    voyage: p.label,
    decision: plan.decision,
    recommended: `${rec.id}${plan.decision === "PROCEED_TO_CHECKPOINT" ? ` (checkpoint ${plan.checkpoint?.port.name}, day ${plan.checkpoint?.etaDays})` : ""}`,
    backup: plan.backupRouteId,
    "risk before->after": `${j.riskBefore} -> ${plan.decision === "REROUTE" ? j.riskAfter : `${orig.metrics.riskScore} (backup ${j.riskAfter})`}`,
    "days +": j.extraDays,
    "net saving (backup)": usd(j.netSavingUsd),
    gemini: plan.ai.used ? `yes (${plan.ai.model})` : `no${plan.ai.note ? `: ${plan.ai.note.slice(0, 60)}` : ""}`,
    secs: Math.round((Date.now() - t0) / 1000),
  });
  console.log(`${p.label}: ${plan.decision} -> ${rec.label} | risk ${j.riskBefore}->${j.riskAfter} | ${j.extraDays >= 0 ? "+" : ""}${j.extraDays} d | net saving ${usd(j.netSavingUsd)} | AI ${plan.ai.used ? plan.ai.model : "off"}`);
  if (verbose) {
    console.log(`  original ${orig.metrics.km} km ${orig.metrics.days} d, expected ${usd(orig.metrics.totalExpectedUsd)} (war ${usd(orig.metrics.warRiskPremiumUsd)}, disruption ${usd(orig.metrics.expectedDisruptionUsd)}), max wave ${orig.metrics.maxWaveM} m`);
    for (const e of orig.metrics.exposures.slice(0, 8)) console.log(`    ${e.title} | ${e.category} | score ${e.score} | exp ${e.exposure} | day ${e.etaDays}${e.unavoidable ? " | unavoidable" : ""}`);
    for (const a of j.alternatives) console.log(`  alt ${a.id}: ${a.km} km ${a.days} d risk ${a.riskScore} expected ${usd(a.totalExpectedUsd)} (${a.deltaVsOriginalUsd >= 0 ? "+" : ""}${usd(a.deltaVsOriginalUsd)}) ${a.verdict}`);
    if (j.checkpointVerdict) console.log(`  checkpoint: ${j.checkpointVerdict}`);
    if (plan.llmTrace) console.log(`  llm: avoid [${plan.llmTrace.avoidHazardIds.join(", ")}] via [${plan.llmTrace.via.join(", ")}] ${plan.llmTrace.valid ? "valid" : "INVALID"}: ${plan.llmTrace.validation}\n  rationale: ${plan.llmTrace.rationale}`);
    console.log(`  headline: ${plan.explanation.headline}\n`);
  }
}
console.log();
console.table(rows);
const decisions = new Set(rows.map((r) => r.decision));
const missing = (["REROUTE", "PROCEED_TO_CHECKPOINT", "PROCEED"] as const).filter((d) => !decisions.has(d));
console.log(missing.length ? `Variety check: missing ${missing.join(", ")}` : "Variety check: REROUTE, PROCEED_TO_CHECKPOINT and PROCEED all present");
