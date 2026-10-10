export type LonLat = [number, number];

const R = 6371; // km
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  let dLon = rad(b[0] - a[0]);
  if (dLon > Math.PI) dLon -= 2 * Math.PI;
  if (dLon < -Math.PI) dLon += 2 * Math.PI;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthKm(path: LonLat[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += haversineKm(path[i - 1], path[i]);
  return d;
}

/** Distance from point p to segment ab, approximated on a local equirectangular plane. */
export function pointSegmentKm(p: LonLat, a: LonLat, b: LonLat): number {
  // far from the segment the planar approximation breaks down; the endpoint distance is good enough
  const far = Math.min(haversineKm(p, a), haversineKm(p, b));
  if (far > 2500) return far;
  const lat0 = rad(p[1]);
  const wrap = (d: number) => (d > 180 ? d - 360 : d < -180 ? d + 360 : d);
  const axDeg = wrap(a[0] - p[0]);
  const bxDeg = axDeg + wrap(b[0] - a[0]);
  const ax = axDeg * Math.cos(lat0), ay = a[1] - p[1];
  const bx = bxDeg * Math.cos(lat0), by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy) * 111.195;
}

/** Minimum distance from a point to a polyline, plus the index of the closest segment. */
export function pointPathKm(p: LonLat, path: LonLat[]): { km: number; seg: number } {
  let best = Infinity, seg = 0;
  for (let i = 1; i < path.length; i++) {
    const d = pointSegmentKm(p, path[i - 1], path[i]);
    if (d < best) { best = d; seg = i - 1; }
  }
  return { km: best, seg };
}

/** Cumulative distance along a path at each vertex. */
export function cumulativeKm(path: LonLat[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + haversineKm(path[i - 1], path[i]));
  return out;
}

/** Evenly spaced samples along a path (by distance). */
export function samplePath(path: LonLat[], n: number): LonLat[] {
  const cum = cumulativeKm(path);
  const total = cum[cum.length - 1];
  const out: LonLat[] = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const target = (total * (i + 0.5)) / n;
    while (j < cum.length - 1 && cum[j] < target) j++;
    const a = path[j - 1], b = path[j];
    const span = cum[j] - cum[j - 1] || 1;
    const t = (target - cum[j - 1]) / span;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

export const KNOT_KMH = 1.852;
export const daysAtSpeed = (km: number, knots: number) => km / (knots * KNOT_KMH * 24);
