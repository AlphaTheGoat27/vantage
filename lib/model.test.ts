// Parity test: the TypeScript feature pipeline + model must reproduce the Python training pipeline exactly.
// Run: npx tsx lib/model.test.ts   (fixture written by ml/export_model.py)
import fixture from "./data/model-fixture.json";
import { computeFeatures, forecastOf, probabilityOf, type ChokepointInput, type NewsByZone } from "./model";

const inputs: ChokepointInput[] = Object.entries(fixture.inputs as Record<string, (string | number)[][]>).map(([name, rows]) => ({
  name,
  rows: rows.map((r) => ({ date: String(r[0]), total: Number(r[1]), tanker: Number(r[2]), container: Number(r[3]), dryBulk: Number(r[4]) })),
}));
const news: NewsByZone = {};
for (const [zone, weekStart, n] of fixture.news as [string, string, number][]) (news[zone] ??= []).push({ weekStart, n });

const feats = computeFeatures(inputs, news, 1);
let worst = 0, checked = 0, bad = 0, pDiff = 0, qDiff = 0;
const expected = fixture.expected as Record<string, { valid: boolean; features: Record<string, number | null>; pCal: number; forecast: Record<string, number> }>;
for (const [name, exp] of Object.entries(expected)) {
  if (!exp.valid) continue;
  const got = feats.get(name)?.[0];
  if (!got) { console.log("missing chokepoint", name); bad++; continue; }
  for (const [k, v] of Object.entries(exp.features)) {
    const g = got.f[k];
    if (v === null) { if (!Number.isNaN(g)) { console.log(`${name}.${k}: expected NaN got ${g}`); bad++; } continue; }
    const d = Math.abs(g - v) / Math.max(1, Math.abs(v));
    worst = Math.max(worst, d);
    checked++;
    if (!(d < 1e-6)) { console.log(`${name}.${k}: expected ${v} got ${g}`); bad++; }
  }
  pDiff = Math.max(pDiff, Math.abs(probabilityOf(got.f) - exp.pCal));
  const fq = forecastOf(got.f);
  for (const q of ["q10", "q50", "q90"] as const) qDiff = Math.max(qDiff, Math.abs(fq[q] - exp.forecast[q]));
}
console.log(`features checked: ${checked}, mismatches: ${bad}, worst relative diff ${worst.toExponential(2)}, max |p - p_python| ${pDiff.toExponential(2)}, max forecast diff ${qDiff.toExponential(2)}`);
if (bad || pDiff > 1e-6 || qDiff > 1e-6) { console.error("PARITY FAILED"); process.exit(1); }
console.log("PARITY OK");
