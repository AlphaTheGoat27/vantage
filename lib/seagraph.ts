import graphData from "./data/searoute-graph.json";
import { haversineKm, type LonLat } from "./geo";

type Graph = {
  coords: LonLat[];
  adj: { to: number; km: number }[][];
  /** nodes in the largest connected component (the world ocean network) */
  main: Uint8Array;
};

let graph: Graph | null = null;

function load(): Graph {
  if (graph) return graph;
  const { nodes, edges } = graphData as { nodes: number[]; edges: number[] };
  const coords: LonLat[] = [];
  for (let i = 0; i < nodes.length; i += 2) coords.push([nodes[i], nodes[i + 1]]);
  const adj: Graph["adj"] = coords.map(() => []);
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i], b = edges[i + 1];
    const km = haversineKm(coords[a], coords[b]);
    adj[a].push({ to: b, km });
    adj[b].push({ to: a, km });
  }
  // label connected components; small fragments (harbour spurs, lakes) are not routable endpoints
  const comp = new Int32Array(coords.length).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < coords.length; i++) {
    if (comp[i] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const { to } of adj[u]) if (comp[to] === -1) { comp[to] = id; stack.push(to); }
    }
    sizes.push(size);
  }
  const biggest = sizes.indexOf(Math.max(...sizes));
  const main = new Uint8Array(coords.length);
  for (let i = 0; i < coords.length; i++) main[i] = comp[i] === biggest ? 1 : 0;
  graph = { coords, adj, main };
  return graph;
}

export function nearestNode(p: LonLat): number {
  const g = load();
  let best = -1, bestD = Infinity;
  for (let i = 0; i < g.coords.length; i++) {
    if (!g.main[i]) continue;
    const d = haversineKm(p, g.coords[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Extra cost multiplier for travelling an edge (1 = no penalty, Infinity = forbidden). */
export type EdgePenalty = (a: LonLat, b: LonLat) => number;

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    this.k.push(key); this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
      [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0], this.v[0]];
    const lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l] < this.k[m]) m = l;
        if (r < this.k.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        [this.k[m], this.k[i]] = [this.k[i], this.k[m]];
        [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest path on the sea-lane network from one coordinate to another,
 * where each edge costs km × penalty(edge). Returns null when no feasible path exists.
 */
export function seaRoute(from: LonLat, to: LonLat, penalty?: EdgePenalty): LonLat[] | null {
  const g = load();
  const s = nearestNode(from), t = nearestNode(to);
  const dist = new Float64Array(g.coords.length).fill(Infinity);
  const prev = new Int32Array(g.coords.length).fill(-1);
  dist[s] = 0;
  const heap = new MinHeap();
  heap.push(0, s);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (u === t) break;
    for (const { to: v, km } of g.adj[u]) {
      const mult = penalty ? penalty(g.coords[u], g.coords[v]) : 1;
      if (!Number.isFinite(mult)) continue;
      const nd = d + km * mult;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
    }
  }
  if (!Number.isFinite(dist[t])) return null;
  const path: LonLat[] = [];
  for (let u = t; u !== -1; u = prev[u]) path.push(g.coords[u]);
  path.reverse();
  return [from, ...path, to];
}

/** Route through an ordered list of waypoints (each leg routed on the network). */
export function seaRouteVia(points: LonLat[], penalty?: EdgePenalty): LonLat[] | null {
  const out: LonLat[] = [];
  for (let i = 1; i < points.length; i++) {
    const leg = seaRoute(points[i - 1], points[i], penalty);
    if (!leg) return null;
    out.push(...(i === 1 ? leg : leg.slice(1)));
  }
  return out;
}
