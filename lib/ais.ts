/**
 * Live AIS (AISStream.io, free key) sampled server-side.
 *
 * Vercel functions cannot hold a WebSocket open, so each call opens a short-lived connection (default 8 s),
 * subscribes to bounding boxes around the watch zones, collects position reports, closes, and the result is cached
 * for 90 s. The key (AISSTREAM_API_KEY) only ever lives on the server.
 *
 * Anomalies are rule-based with robust statistics (cross-region median/MAD z-scores), because no free historical AIS
 * archive was available to train a model on: congestion/queueing, speed drops, scattered courses (mass diversion
 * away from a lane) and dark gaps (ships that were underway in an earlier snapshot on this warm instance and vanished).
 */
import { cached } from "./cache";
import { WATCH_ZONES } from "./places";

export type ShipClass = "cargo" | "tanker" | "passenger" | "fishing" | "other" | "unknown";
export type Ship = { mmsi: number; lon: number; lat: number; sog: number; cog: number; heading: number | null; cls: ShipClass; nav: number | null };
export type AisAnomaly = { kind: "congestion" | "speed-drop" | "course-scatter" | "dark-gap"; severity: number; detail: string };
export type AisRegion = {
  id: string; name: string; center: [number, number]; radiusKm: number;
  ships: number; moving: number; slowShare: number; medianSog: number | null; courseScatter: number | null; anomalies: AisAnomaly[];
};
export type AisSnapshot = {
  configured: boolean; ok: boolean; sampledAt?: string; seconds?: number; shipCount: number; ships: Ship[]; regions: AisRegion[]; note?: string;
};

export const aisConfigured = () => Boolean(process.env.AISSTREAM_API_KEY);

const classOf = (t: number | undefined): ShipClass =>
  t === undefined ? "unknown" : t >= 70 && t <= 79 ? "cargo" : t >= 80 && t <= 89 ? "tanker" : t >= 60 && t <= 69 ? "passenger" : t === 30 ? "fishing" : "other";

const km = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

function boxFor(c: [number, number], radiusKm: number): [[number, number], [number, number]] {
  const r = Math.min(radiusKm, 420);
  const dLat = r / 111, dLon = r / (111 * Math.max(0.2, Math.cos((c[1] * Math.PI) / 180)));
  return [[c[1] - dLat, c[0] - dLon], [c[1] + dLat, c[0] + dLon]];
}

// remembered ship types (MMSI -> class) and the previous snapshot's underway ships per region (warm instances only)
const typeMemory = new Map<number, ShipClass>();
const previous = new Map<string, { at: number; underway: Set<number> }>();

async function sample(seconds: number): Promise<{ ships: Map<number, Ship> }> {
  const key = process.env.AISSTREAM_API_KEY!;
  const boxes = WATCH_ZONES.map((z) => boxFor(z.center, z.radiusKm));
  return new Promise((resolve, reject) => {
    const ships = new Map<number, Ship>();
    let done = false, ws: WebSocket;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* already closed */ }
      if (err && ships.size === 0) reject(err); else resolve({ ships });
    };
    const timer = setTimeout(() => finish(), seconds * 1000);
    try {
      ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    } catch (e) {
      clearTimeout(timer);
      return reject(e instanceof Error ? e : new Error(String(e)));
    }
    ws.onopen = () => ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: boxes, FilterMessageTypes: ["PositionReport", "ShipStaticData"] }));
    ws.onerror = () => finish(new Error("AISStream connection error"));
    ws.onclose = () => finish(ships.size ? undefined : new Error("AISStream closed the connection without data"));
    ws.onmessage = async (ev: MessageEvent) => {
      try {
        const raw = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
        const m = JSON.parse(raw);
        if (m.error) return finish(new Error(`AISStream: ${m.error}`));
        const meta = m.MetaData ?? {};
        if (m.MessageType === "ShipStaticData") {
          typeMemory.set(Number(meta.MMSI), classOf(m.Message?.ShipStaticData?.Type));
        } else if (m.MessageType === "PositionReport") {
          const p = m.Message?.PositionReport;
          const lat = Number(meta.latitude ?? p?.Latitude), lon = Number(meta.longitude ?? p?.Longitude);
          if (!p || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return;
          const mmsi = Number(meta.MMSI ?? p.UserID);
          ships.set(mmsi, {
            mmsi, lon, lat, sog: Number(p.Sog) >= 102.3 ? 0 : Number(p.Sog) || 0, cog: Number(p.Cog) >= 360 ? 0 : Number(p.Cog) || 0,
            heading: p.TrueHeading >= 0 && p.TrueHeading < 360 ? Number(p.TrueHeading) : null, cls: typeMemory.get(mmsi) ?? "unknown", nav: p.NavigationalStatus ?? null,
          });
        }
      } catch { /* ignore malformed frames */ }
    };
  });
}

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function analyse(ships: Ship[], now: number): AisRegion[] {
  const regions: AisRegion[] = WATCH_ZONES.map((z) => {
    const inZone = ships.filter((s) => km([s.lon, s.lat], z.center) <= Math.min(z.radiusKm, 420));
    const notMoored = inZone.filter((s) => s.nav !== 5);
    const moving = inZone.filter((s) => s.sog >= 1.5);
    const slow = notMoored.filter((s) => s.sog < 1 || s.nav === 1);
    // axial course scatter: lane traffic runs along one axis in both directions (doubled-angle resultant)
    let scatter: number | null = null;
    if (moving.length >= 8) {
      const x = moving.reduce((a, s) => a + Math.cos((2 * s.cog * Math.PI) / 180), 0) / moving.length;
      const y = moving.reduce((a, s) => a + Math.sin((2 * s.cog * Math.PI) / 180), 0) / moving.length;
      scatter = 1 - Math.hypot(x, y);
    }
    return {
      id: z.id, name: z.name, center: z.center, radiusKm: Math.min(z.radiusKm, 420),
      ships: inZone.length, moving: moving.length, slowShare: notMoored.length ? slow.length / notMoored.length : 0,
      medianSog: moving.length ? median(moving.map((s) => s.sog)) : null, courseScatter: scatter, anomalies: [],
    };
  });

  // cross-region robust z-scores (median / MAD) so one busy anchorage is not flagged against an empty strait
  const active = regions.filter((r) => r.ships >= 12);
  const z = (v: number, vals: number[]) => {
    const m = median(vals), mad = median(vals.map((x) => Math.abs(x - m)));
    return (v - m) / (1.4826 * mad + 0.05);
  };
  for (const r of regions) {
    if (r.ships < 12) continue;
    if (active.length >= 4) {
      const zs = z(r.slowShare, active.map((a) => a.slowShare));
      if (r.slowShare >= 0.4 && zs >= 3) r.anomalies.push({ kind: "congestion", severity: Math.round(clamp(40 + zs * 8 + (r.slowShare - 0.4) * 100)), detail: `${Math.round(r.slowShare * 100)}% of ${r.ships} ships are stopped or at anchor outside port (robust z ${zs.toFixed(1)} vs other zones): queueing or holding` });
    }
    if (r.medianSog !== null && r.moving >= 8 && r.medianSog < 6) r.anomalies.push({ kind: "speed-drop", severity: Math.round(clamp(30 + (6 - r.medianSog) * 10)), detail: `moving ships average ${r.medianSog.toFixed(1)} kn (lanes normally 10-14 kn)` });
    if (r.courseScatter !== null && r.courseScatter >= 0.6 && r.moving >= 10) r.anomalies.push({ kind: "course-scatter", severity: Math.round(clamp(30 + (r.courseScatter - 0.6) * 150)), detail: `ship courses are scattered (${(r.courseScatter * 100).toFixed(0)}% off the lane axes): possible mass diversion or avoidance` });
  }

  // dark gaps: ships underway in the previous snapshot (same warm instance, 3 min to 3 h ago) that have vanished
  for (const r of regions) {
    const seen = new Set(ships.filter((s) => s.sog >= 3 && km([s.lon, s.lat], r.center) <= r.radiusKm).map((s) => s.mmsi));
    const prev = previous.get(r.id);
    if (prev && now - prev.at > 180_000 && now - prev.at < 3 * 3600_000 && prev.underway.size >= 20) {
      const gone = [...prev.underway].filter((m) => !seen.has(m)).length;
      const share = gone / prev.underway.size;
      if (share >= 0.6) r.anomalies.push({ kind: "dark-gap", severity: Math.round(clamp(30 + (share - 0.6) * 120)), detail: `${gone} of ${prev.underway.size} ships that were underway here ${Math.round((now - prev.at) / 60000)} min ago stopped transmitting (AIS gap)` });
    }
    previous.set(r.id, { at: now, underway: seen });
  }
  return regions;
}

export async function aisSnapshot(): Promise<AisSnapshot> {
  if (!aisConfigured()) return { configured: false, ok: false, shipCount: 0, ships: [], regions: [], note: "AIS is off: set AISSTREAM_API_KEY (free at aisstream.io) to show live ships and AIS anomalies." };
  try {
    return await cached("ais", 90_000, async () => {
      const seconds = 8;
      const { ships } = await sample(seconds);
      const list = [...ships.values()];
      const regions = analyse(list, Date.now());
      // keep the payload small: all ships in anomalous regions, then a spread of the rest
      const flagged = new Set(regions.filter((r) => r.anomalies.length).map((r) => r.id));
      const zoneOf = (s: Ship) => WATCH_ZONES.find((z) => km([s.lon, s.lat], z.center) <= Math.min(z.radiusKm, 420))?.id;
      const keep = list.filter((s) => flagged.has(zoneOf(s) ?? "")).concat(list.filter((s) => !flagged.has(zoneOf(s) ?? "")).slice(0, 1200));
      return { configured: true, ok: true, sampledAt: new Date().toISOString(), seconds, shipCount: list.length, ships: keep.slice(0, 1800), regions };
    });
  } catch (e) {
    return { configured: true, ok: false, shipCount: 0, ships: [], regions: [], note: `AISStream unavailable: ${e instanceof Error ? e.message : e}` };
  }
}
