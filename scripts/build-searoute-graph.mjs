// Builds a compact sea-lane graph from the Eurostat marnet network
// (shipped in the searoute-js package, data/marnet_densified.json).
// Usage: node scripts/build-searoute-graph.mjs <marnet_densified.json>
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2];
if (!src) throw new Error("pass the path to marnet_densified.json");
const fc = JSON.parse(readFileSync(src, "utf8"));

const nodes = [];
const index = new Map();
const key = (lon, lat) => {
  // the network is split at the antimeridian: treat -180 and 180 as the same meridian
  if (lon <= -179.9999) lon = 180;
  return `${lon.toFixed(4)},${lat.toFixed(4)}`;
};
const nodeId = (lon, lat) => {
  const k = key(lon, lat);
  let id = index.get(k);
  if (id === undefined) {
    id = nodes.length / 2;
    index.set(k, id);
    nodes.push(+lon.toFixed(4), +lat.toFixed(4));
  }
  return id;
};

const MAX_KM = 150;
const toVec = ([lon, lat]) => {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};
const toLonLat = ([x, y, z]) => [(Math.atan2(y, x) * 180) / Math.PI, (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI];
// split long ocean-crossing segments along the great circle so hazard checks and rendering stay accurate
function densify(a, b) {
  const va = toVec(a), vb = toVec(b);
  const ang = Math.acos(Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const n = Math.ceil((ang * 6371) / MAX_KM);
  if (n <= 1) return [a, b];
  const out = [a];
  for (let i = 1; i < n; i++) {
    const t = i / n, s = Math.sin(ang);
    const wa = Math.sin((1 - t) * ang) / s, wb = Math.sin(t * ang) / s;
    out.push(toLonLat([wa * va[0] + wb * vb[0], wa * va[1] + wb * vb[1], wa * va[2] + wb * vb[2]]));
  }
  out.push(b);
  return out;
}

const edges = [];
const seen = new Set();
for (const f of fc.features) {
  const raw = f.geometry.coordinates;
  const c = [raw[0]];
  for (let i = 1; i < raw.length; i++) c.push(...densify(raw[i - 1], raw[i]).slice(1));
  for (let i = 1; i < c.length; i++) {
    const a = nodeId(c[i - 1][0], c[i - 1][1]);
    const b = nodeId(c[i][0], c[i][1]);
    if (a === b) continue;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push(a, b);
  }
}

writeFileSync(
  new URL("../lib/data/searoute-graph.json", import.meta.url),
  JSON.stringify({ source: "Eurostat marnet via searoute-js (MIT)", nodes, edges }),
);
console.log(`nodes ${nodes.length / 2}, edges ${edges.length / 2}`);
