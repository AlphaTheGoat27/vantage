/**
 * Trained disruption model, evaluated in TypeScript (no Python at runtime).
 *
 * Features, tree evaluation, isotonic calibration and the alert logic mirror ml/features.py, ml/backtest.py
 * and ml/export_model.py exactly; `node lib/model.test.mjs` checks parity against Python outputs.
 *
 * Input: daily PortWatch transit rows per chokepoint (>= ~200 days) and weekly Google News headline counts per zone.
 * Output per chokepoint: observed state, calibrated probability of a sustained disruption within `horizonDays`,
 * 7-day forecast with an 80% interval, the top feature contributions (Saabas path attribution) and an alert state
 * with persistence + hysteresis.
 */
import model from "./data/vantage-model.json";

export type DailyRow = { date: string; total: number; tanker: number; container: number; dryBulk: number };
export type NewsWeek = { weekStart: string; n: number };
export type NewsByZone = Record<string, NewsWeek[]>;

type Node = { f: number; t: number; nl: boolean; iv: number; l: Node; r: Node } | { v: number };
const M = model as unknown as {
  version: number; horizonDays: number; trainedThrough: string; features: string[];
  newsZones: Record<string, string[]>; newsBaselineWeeks: number; newsQueries: Record<string, string>;
  classifier: {
    kind: "logit" | "lgbm"; trees?: Node[];
    features?: string[]; median?: number[]; center?: number[]; scale?: number[]; coef?: number[]; intercept?: number;
  };
  calibration: { x: number[]; y: number[] } | null;
  operating: { observedDrop: number; probabilityOn: number; persistDays: number; clearDays: number; normalR7: number; disruptionDrop: number };
  forecast: Record<"q10" | "q50" | "q90", { trees: Node[] }>;
  training: { fitRows: number; valRows: number; valPositives: number; farTarget: number; seed: number };
};

/** Google News queries the model's news features were trained on (single source of truth: ml/download_news.py). */
export const MODEL_NEWS_QUERIES = M.newsQueries;

export const MODEL_INFO = {
  version: M.version, horizonDays: M.horizonDays, trainedThrough: M.trainedThrough, features: M.features,
  operating: M.operating, training: M.training,
};

const MIN_BASELINE = 5;
const REGIONS: Record<string, string> = {
  "Bab el-Mandeb Strait": "redsea", "Suez Canal": "redsea", "Strait of Hormuz": "gulf", "Bosporus Strait": "blacksea", "Kerch Strait": "blacksea",
  "Gibraltar Strait": "europe", "Dover Strait": "europe", "Oresund Strait": "europe", "Malacca Strait": "seasia", "Sunda Strait": "seasia",
  "Lombok Strait": "seasia", "Makassar Strait": "seasia", "Mindoro Strait": "seasia", "Balabac Strait": "seasia", "Ombai Strait": "seasia",
  "Torres Strait": "seasia", "Taiwan Strait": "easia", "Luzon Strait": "easia", "Korea Strait": "easia", "Bohai Strait": "easia",
  "Tsugaru Strait": "easia", "Panama Canal": "americas", "Yucatan Channel": "americas", "Mona Passage": "americas",
  "Windward Passage": "americas", "Magellan Strait": "americas", "Cape of Good Hope": "africa", "Bering Strait": "arctic",
};

// ---------------------------------------------------------------- pandas-style rolling helpers (NaN = missing)
const isNum = (v: number) => !Number.isNaN(v);
function roll(a: number[], k: number, minp: number, fn: (w: number[]) => number): number[] {
  const out = new Array<number>(a.length).fill(NaN);
  for (let i = 0; i < a.length; i++) {
    const w: number[] = [];
    for (let j = Math.max(0, i - k + 1); j <= i; j++) if (isNum(a[j])) w.push(a[j]);
    if (w.length >= minp) out[i] = fn(w);
  }
  return out;
}
const mean = (w: number[]) => w.reduce((s, v) => s + v, 0) / w.length;
const sum = (w: number[]) => w.reduce((s, v) => s + v, 0);
const median = (w: number[]) => {
  const s = [...w].sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const shift = (a: number[], k: number) => a.map((_, i) => (i - k >= 0 ? a[i - k] : NaN));
const clip = (v: number, lo: number, hi: number) => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : NaN);
const div = (a: number, b: number) => (isNum(a) && isNum(b) ? a / b : NaN);

function slopeSeries(a: number[], k: number, minp: number): number[] {
  const out = new Array<number>(a.length).fill(NaN);
  for (let i = 0; i < a.length; i++) {
    const idx: number[] = [], val: number[] = [];
    for (let j = Math.max(0, i - k + 1), p = 0; j <= i; j++, p++) if (isNum(a[j])) { idx.push(p); val.push(a[j]); }
    const winLen = Math.min(k, i + 1);
    if (val.length < minp) continue;
    if (winLen - val.length > Math.floor(winLen / 3)) continue;
    const mi = mean(idx), mv = mean(val);
    let num = 0, den = 0;
    for (let q = 0; q < idx.length; q++) { num += (idx[q] - mi) * (val[q] - mv); den += (idx[q] - mi) ** 2; }
    out[i] = num / den;
  }
  return out;
}

const dayMs = 86_400_000;
const dayNum = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / dayMs);
const doy = (n: number) => {
  const d = new Date(n * dayMs);
  return Math.round((n * dayMs - Date.UTC(d.getUTCFullYear(), 0, 0)) / dayMs);
};

type Series = {
  name: string; days: number[]; base: number[]; r1: number[]; r3: number[]; r7: number[]; r14: number[]; r28: number[]; m7: number[];
  rz7: number[]; slope7: number[]; slope14: number[]; accel: number[]; vol28: number[]; min_r7_30: number[]; days_low14: number[];
  drawdown60: number[]; tanker_share7: number[]; tanker_share_chg: number[]; container_share_chg: number[]; bulk_share_chg: number[];
  log_baseline: number[]; miss28: number[]; doy_sin: number[]; doy_cos: number[];
};

function seriesFeatures(name: string, rows: DailyRow[]): Series {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
  const d0 = dayNum(sorted[0].date), d1 = dayNum(sorted[sorted.length - 1].date);
  const n = d1 - d0 + 1;
  const days = Array.from({ length: n }, (_, i) => d0 + i);
  const col = (f: (r: DailyRow) => number) => {
    const a = new Array<number>(n).fill(NaN);
    for (const r of sorted) a[dayNum(r.date) - d0] = f(r);
    return a;
  };
  const x = col((r) => r.total), tk = col((r) => r.tanker), ct = col((r) => r.container), bk = col((r) => r.dryBulk);
  const cap = roll(x, 56, 14, median).map((v) => 3 * v);
  const xw = x.map((v, i) => (isNum(v) ? Math.min(Math.max(v, 0), isNum(cap[i]) ? cap[i] : Infinity) : NaN));
  const base = roll(shift(xw, 7), 91, 60, median);
  const dev = xw.map((v, i) => Math.abs(v - base[i]));
  const mad = roll(shift(dev, 7), 91, 60, median);
  const m = (k: number) => roll(xw, k, Math.max(1, Math.min(k, Math.floor(k * 0.7))), mean);
  const mk = { 1: m(1), 3: m(3), 7: m(7), 14: m(14), 28: m(28) };
  const rr = (k: 1 | 3 | 7 | 14 | 28) => mk[k].map((v, i) => clip(div(v, base[i]), 0, 3));
  const r1 = rr(1), r3 = rr(3), r7 = rr(7), r14 = rr(14), r28 = rr(28);
  const rz7 = mk[7].map((v, i) => clip((v - base[i]) / ((1.4826 * mad[i]) / Math.sqrt(7) + 0.02 * base[i] + 1e-9), -20, 20));
  const rel = xw.map((v, i) => div(v, base[i]));
  const slope7 = slopeSeries(rel, 7, 5).map((v) => clip(v, -0.5, 0.5));
  const slope14 = slopeSeries(rel, 14, 10).map((v) => clip(v, -0.5, 0.5));
  const accel = r3.map((v, i) => v - r14[i]);
  const med28 = roll(xw, 28, 14, median);
  const vol28 = roll(xw.map((v, i) => Math.abs(v - med28[i])), 28, 14, median).map((v, i) => clip(v / base[i], 0, 3));
  const min_r7_30 = roll(r7, 30, 15, (w) => Math.min(...w));
  const days_low14 = roll(rel.map((v) => (isNum(v) ? (v < 0.8 ? 1 : 0) : NaN)), 14, 7, sum);
  const m7max = roll(mk[7], 60, 30, (w) => Math.max(...w));
  const drawdown60 = mk[7].map((v, i) => clip(1 - v / m7max[i], 0, 1));
  const share = (c: number[]) => {
    const a = roll(c, 7, 5, sum), t = roll(x, 7, 5, sum);
    return a.map((v, i) => div(v, t[i]));
  };
  const shChg = (c: number[]) => {
    const sh = share(c), bs = roll(shift(sh, 7), 91, 60, median);
    return { sh, chg: sh.map((v, i) => clip(v - bs[i], -0.5, 0.5)) };
  };
  const tank = shChg(tk), cont = shChg(ct), bulk = shChg(bk);
  const miss28 = roll(x.map((v) => (isNum(v) ? 0 : 1)), 28, 1, mean);
  return {
    name, days, base, r1, r3, r7, r14, r28, m7: mk[7], rz7, slope7, slope14, accel, vol28, min_r7_30, days_low14, drawdown60,
    tanker_share7: tank.sh, tanker_share_chg: tank.chg, container_share_chg: cont.chg, bulk_share_chg: bulk.chg,
    log_baseline: base.map((v) => (isNum(v) ? Math.log1p(v) : NaN)), miss28,
    doy_sin: days.map((d) => Math.sin((2 * Math.PI * doy(d)) / 365.25)), doy_cos: days.map((d) => Math.cos((2 * Math.PI * doy(d)) / 365.25)),
  };
}

/** Weekly news features per zone, usable once the Monday-aligned week has fully ended (mirrors features.add_news). */
function newsFeatures(weeks: NewsWeek[] | undefined, day: number): { log: number; surge: number } {
  if (!weeks?.length) return { log: NaN, surge: NaN };
  const byStart = new Map(weeks.map((w) => [dayNum(w.weekStart), w.n]));
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const first = starts[0], last = starts[starts.length - 1];
  const full: number[] = [];
  for (let s = first; s <= last; s += 7) full.push(byStart.get(s) ?? NaN);
  // latest week with start + 7 <= day
  let idx = Math.floor((day - 7 - first) / 7);
  if (idx < 0) return { log: NaN, surge: NaN };
  idx = Math.min(idx, full.length - 1);
  const prev = full.slice(Math.max(0, idx - M.newsBaselineWeeks), idx).filter(isNum);
  const cur = full[idx];
  if (!isNum(cur)) return { log: NaN, surge: NaN };
  const base = prev.length >= 4 ? median(prev) : NaN;
  return { log: Math.log1p(cur), surge: clip((cur + 1) / (base + 1), 0, 10) };
}

export type FeatureRow = Record<string, number>;
export type ChokepointInput = { name: string; rows: DailyRow[] };

/** Features for every chokepoint on each of the last `lookback` days (needed for persistence/hysteresis). */
export function computeFeatures(inputs: ChokepointInput[], news: NewsByZone, lookback = 10): Map<string, { day: number; valid: boolean; f: FeatureRow }[]> {
  const S = inputs.filter((c) => c.rows.length >= 100).map((c) => seriesFeatures(c.name, c.rows));
  const last = Math.max(...S.map((s) => s.days[s.days.length - 1]));
  const at = (s: Series, day: number, k: keyof Series) => {
    const i = day - s.days[0];
    return i >= 0 && i < s.days.length ? (s[k] as number[])[i] : NaN;
  };
  const cape = S.find((s) => s.name === "Cape of Good Hope");
  const out = new Map<string, { day: number; valid: boolean; f: FeatureRow }[]>();
  for (const s of S) out.set(s.name, []);
  for (let day = last - lookback + 1; day <= last; day++) {
    const r7 = new Map(S.map((s) => [s.name, at(s, day, "r7")]));
    const validBase = new Map(S.map((s) => [s.name, at(s, day, "base") >= MIN_BASELINE]));
    for (const s of S) {
      const others = S.filter((o) => o.name !== s.name && validBase.get(o.name) && isNum(r7.get(o.name)!)).map((o) => r7.get(o.name)!);
      const region = REGIONS[s.name] ?? "other";
      const peers = S.filter((o) => o.name !== s.name && (REGIONS[o.name] ?? "other") === region && isNum(r7.get(o.name)!)).map((o) => r7.get(o.name)!);
      const zones = M.newsZones[s.name] ?? [];
      const nf = zones.map((z) => newsFeatures(news[z], day)).filter((n) => isNum(n.log));
      const f: FeatureRow = {};
      for (const k of M.features) {
        if (k in s) f[k] = at(s, day, k as keyof Series);
      }
      f.cape_r7 = cape ? at(cape, day, "r7") : NaN;
      f.cape_slope14 = cape ? at(cape, day, "slope14") : NaN;
      f.peer_r7 = peers.length ? mean(peers) : NaN;
      f.global_r7 = others.length ? mean(others) : NaN;
      f.global_frac_low = others.length ? others.filter((v) => v < 0.85).length / others.length : NaN;
      f.news_log = nf.length ? Math.max(...nf.map((n) => n.log)) : NaN;
      f.news_surge = nf.length ? Math.max(...nf.map((n) => n.surge)) : NaN;
      out.get(s.name)!.push({ day, valid: validBase.get(s.name)!, f });
    }
  }
  return out;
}

// ---------------------------------------------------------------- tree evaluation
function walk(node: Node, x: number[], contrib?: Float64Array): number {
  let n = node;
  while ("f" in n) {
    const v = x[n.f];
    const next = Number.isNaN(v) ? (n.nl ? n.l : n.r) : v <= n.t ? n.l : n.r;
    if (contrib) contrib[n.f] += ("f" in next ? next.iv : (next as { v: number }).v) - n.iv;
    n = next;
  }
  return n.v;
}

export function rawScore(trees: Node[], x: number[], contrib?: Float64Array): number {
  let s = 0;
  for (const t of trees) s += walk(t, x, contrib);
  return s;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
function isotonic(p: number): number {
  const c = M.calibration;
  if (!c) return p;
  const { x, y } = c;
  if (p <= x[0]) return y[0];
  if (p >= x[x.length - 1]) return y[y.length - 1];
  let lo = 0, hi = x.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] <= p) lo = mid; else hi = mid; }
  return y[lo] + ((y[hi] - y[lo]) * (p - x[lo])) / (x[hi] - x[lo]);
}

export type Contribution = { feature: string; value: number; contribution: number };
export type Prediction = {
  name: string;
  valid: boolean;
  ratio7: number | null;           // 7-day transits / 90-day robust baseline
  observedDrop: boolean;           // already disrupted (drop beyond the tuned threshold)
  probability: number | null;      // calibrated P(sustained disruption starts within horizon), normal-state chokepoints only
  rawScore: number | null;
  forecast: { q10: number; q50: number; q90: number } | null;  // next-7-day level relative to baseline
  alert: boolean;                  // after persistence + hysteresis
  alertKind: "none" | "observed" | "predicted";
  contributions: Contribution[];   // top drivers, signed (+ raises risk)
  newsSurge: number | null;
};

/** Classifier logit and per-feature contributions (logistic: coef x scaled value; trees: Saabas path attribution). */
function classify(f: FeatureRow): { z: number; contrib: { feature: string; value: number; contribution: number }[] } {
  const c = M.classifier;
  if (c.kind === "logit") {
    const feats = c.features!;
    let z = c.intercept!;
    const contrib = feats.map((k, i) => {
      const raw = f[k];
      const v = Number.isNaN(raw) || raw === undefined ? c.median![i] : raw;
      const s = (v - c.center![i]) / c.scale![i];
      const part = c.coef![i] * s;
      z += part;
      return { feature: k, value: raw === undefined ? NaN : raw, contribution: part };
    });
    return { z, contrib };
  }
  const x = M.features.map((k) => (f[k] === undefined ? NaN : f[k]));
  const acc = new Float64Array(M.features.length);
  const z = rawScore(c.trees!, x, acc);
  return { z, contrib: M.features.map((k, i) => ({ feature: k, value: x[i], contribution: acc[i] })) };
}

function evalDay(f: FeatureRow, valid: boolean) {
  const r7 = f.r7;
  const normal = valid && isNum(r7) && r7 >= M.operating.normalR7;
  const observed = valid && isNum(r7) && 1 - r7 > M.operating.observedDrop;
  let p: number | null = null, rs: number | null = null;
  if (valid) {
    rs = classify(f).z;
    p = isotonic(sigmoid(rs));
  }
  const modelRaw = normal && p !== null && p >= M.operating.probabilityOn;
  return { r7, normal, observed, p, rs, raw: observed || modelRaw };
}

/** Calibrated probability for one feature row (used by the parity test). */
export function probabilityOf(f: FeatureRow): number {
  return isotonic(sigmoid(classify(f).z));
}

export function forecastOf(f: FeatureRow): { q10: number; q50: number; q90: number } {
  const x = M.features.map((k) => (f[k] === undefined ? NaN : f[k]));
  const q = (["q10", "q50", "q90"] as const).map((k) => rawScore(M.forecast[k].trees, x)).sort((a, b) => a - b);
  return { q10: q[0], q50: q[1], q90: q[2] };
}

export function predictAll(inputs: ChokepointInput[], news: NewsByZone): Prediction[] {
  const feats = computeFeatures(inputs, news, 10);
  const preds: Prediction[] = [];
  for (const [name, days] of feats) {
    const last = days[days.length - 1];
    const e = days.map((d) => evalDay(d.f, d.valid));
    // persistence + hysteresis over the last days (same state machine as ml/backtest.alert_state)
    let on = false, up = 0, down = 0;
    for (const d of e) {
      if (d.raw) { up++; down = 0; } else { up = 0; down++; }
      if (!on && up >= M.operating.persistDays) on = true;
      else if (on && down >= M.operating.clearDays) on = false;
    }
    const cur = e[e.length - 1];
    let contributions: Contribution[] = [];
    let forecast: Prediction["forecast"] = null;
    if (last.valid) {
      contributions = classify(last.f).contrib
        .filter((r) => Math.abs(r.contribution) > 1e-6)
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 5);
      const x = M.features.map((k) => (last.f[k] === undefined ? NaN : last.f[k]));
      const q = (["q10", "q50", "q90"] as const).map((k) => rawScore(M.forecast[k].trees, x)).sort((a, b) => a - b);
      forecast = { q10: q[0], q50: q[1], q90: q[2] };
    }
    preds.push({
      name, valid: last.valid, ratio7: isNum(cur.r7) ? cur.r7 : null, observedDrop: cur.observed,
      probability: cur.normal ? cur.p : null, rawScore: cur.rs, forecast, alert: on,
      alertKind: !on ? "none" : cur.observed ? "observed" : "predicted",
      contributions, newsSurge: isNum(last.f.news_surge) ? last.f.news_surge : null,
    });
  }
  return preds;
}
