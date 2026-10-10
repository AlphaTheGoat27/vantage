/**
 * Live AIS (AISStream.io, free key) sampled server-side.
 *
 * Vercel functions cannot hold a WebSocket open, so each call opens a short-lived connection (default 8 s),
 * subscribes to bounding boxes around the watch zones and the main ocean lanes the planner routes through, collects
 * position reports and static data (name, destination, ship type), closes, and the result is cached for 90 s.
 * The key (AISSTREAM_API_KEY) only ever lives on the server.
 *
 * Message shapes (aisstream.io/documentation and github.com/aisstream/ais-message-models):
 *   { MessageType: "PositionReport" | "ShipStaticData", MetaData: { MMSI, ShipName, latitude, longitude, time_utc },
 *     Message: { PositionReport: { UserID, Latitude, Longitude, Sog, Cog, TrueHeading, NavigationalStatus, ... } }
 *              { ShipStaticData: { UserID, Name, Type, Destination, CallSign, ImoNumber, Eta, ... } } }
 *   time_utc looks like "2024-02-17 13:34:56.207576423 +0000 UTC" (not ISO; parsed below).
 *   Errors arrive as { error: "..." } and the server closes the socket.
 * Class B position reports are not subscribed: they are mostly leisure and small craft and would crowd merchant
 * traffic out of the short sample.
 *
 * Anomalies are rule-based with robust statistics (cross-region median/MAD z-scores), because no free historical AIS
 * archive was available to train a model on: congestion/queueing, speed drops, scattered courses (mass diversion
 * away from a lane) and dark gaps (ships that were underway in an earlier snapshot on this warm instance and vanished).
 */
import { cached } from "./cache";
import { WATCH_ZONES } from "./places";

export type ShipClass = "cargo" | "tanker" | "passenger" | "fishing" | "other" | "unknown";
export type Ship = {
  mmsi: number; lon: number; lat: number; sog: number; cog: number; heading: number | null; cls: ShipClass; nav: number | null;
  /** vessel name and reported destination, when AIS static data arrived during the sample */
  name?: string; destination?: string;
  /** ISO time of the position report, used by the globe to dead-reckon the ship forward between samples */
  at?: string;
};
export type AisAnomaly = { kind: "congestion" | "speed-drop" | "course-scatter" | "dark-gap"; severity: number; detail: string };
export type AisRegion = {
  id: string; name: string; center: [number, number]; radiusKm: number;
  ships: number; moving: number; slowShare: number; medianSog: number | null; courseScatter: number | null; anomalies: AisAnomaly[];
};
export type AisSnapshot = {
  configured: boolean; ok: boolean; sampledAt?: string; seconds?: number; shipCount: number; ships: Ship[]; regions: AisRegion[]; note?: string;
};

export const aisConfigured = () => Boolean(process.env.AISSTREAM_API_KEY);

const SAMPLE_SECONDS = 8;
const MAX_SHIPS = 2000;

/** AIS ship-type code (ITU-R M.1371) to a coarse class. 0 means "not available". */
export const classOf = (t: number | undefined | null): ShipClass => {
  if (t == null || !Number.isFinite(t) || t <= 0) return "unknown";
  return t >= 70 && t <= 79 ? "cargo" : t >= 80 && t <= 89 ? "tanker" : t >= 60 && t <= 69 ? "passenger" : t === 30 ? "fishing" : "other";
};

const km = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/** AISStream boxes are [[lat, lon], [lat, lon]] corner pairs. */
type Box = [[number, number], [number, number]];

function boxFor(c: [number, number], radiusKm: number): Box {
  const r = Math.min(radiusKm, 420);
  const dLat = r / 111, dLon = r / (111 * Math.max(0.2, Math.cos((c[1] * Math.PI) / 180)));
  return [[c[1] - dLat, c[0] - dLon], [c[1] + dLat, c[0] + dLon]];
}

/**
 * Main ocean lanes the planner routes through, as [west, south, east, north]. AISStream is fed by shore receivers,
 * so open-ocean legs (mid Indian Ocean, mid Pacific) have little coverage; these boxes hug the coastal approaches
 * and chokepoints where data actually exists. None crosses the antimeridian.
 */
export const AIS_LANES: { name: string; bbox: [number, number, number, number] }[] = [
  { name: "Malacca & Singapore Straits", bbox: [94, -2, 105.5, 8] },
  { name: "South China Sea", bbox: [105, 2, 121, 21] },
  { name: "Taiwan Strait & East China Sea", bbox: [116, 21, 126, 32.5] },
  { name: "Korea Strait & Busan approaches", bbox: [124, 32.5, 132.5, 38] },
  { name: "Japan Pacific coast (trans-Pacific departures)", bbox: [132.5, 31, 142.5, 37] },
  { name: "Los Angeles / Long Beach approaches", bbox: [-124, 31, -116, 36] },
  { name: "Sri Lanka & southern India", bbox: [72, 2, 84, 11] },
  { name: "Arabian Sea & west India coast", bbox: [62, 11, 74, 25] },
  { name: "Gulf of Aden", bbox: [43, 10, 56, 16] },
  { name: "Southern Red Sea & Bab el-Mandeb", bbox: [37, 11, 44, 20] },
  { name: "Northern Red Sea & Suez Canal", bbox: [32, 20, 39.5, 31.8] },
  { name: "Persian Gulf, Hormuz & Gulf of Oman", bbox: [47.5, 22, 60, 30.5] },
  { name: "Mediterranean", bbox: [-6.5, 30, 36.5, 46] },
  { name: "Black Sea", bbox: [27, 40.5, 42, 47.5] },
  { name: "English Channel & North Sea", bbox: [-6, 48, 10.5, 58.5] },
  { name: "Baltic Sea", bbox: [10, 53.5, 30.5, 61] },
  { name: "Gulf of Guinea", bbox: [-5, -3, 10, 7] },
  { name: "Cape of Good Hope & Durban", bbox: [15, -37, 33, -28] },
  { name: "Panama & western Caribbean", bbox: [-83, 6, -75, 19] },
  { name: "US Gulf of Mexico", bbox: [-98, 24, -81, 31] },
  { name: "US East Coast (Savannah to New York)", bbox: [-81.5, 31, -72, 41.5] },
];

/** Subscription boxes: the lanes plus each watch zone (the regional anomaly analysis needs full zone coverage). */
export const aisBoxes = (): Box[] => [
  ...AIS_LANES.map(({ bbox: [w, s, e, n] }): Box => [[s, w], [n, e]]),
  ...WATCH_ZONES.map((z) => boxFor(z.center, z.radiusKm)),
];

// ---------------------------------------------------------------- parsing and merging (pure, unit-tested)

/** AIS text fields are padded with spaces or "@"; returns undefined when nothing is left. */
export const cleanText = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/@+/g, " ").replace(/\s+/g, " ").trim();
  return s || undefined;
};

/** AISStream's "2024-02-17 13:34:56.207576423 +0000 UTC" (or an ISO string) to ISO 8601 with milliseconds. */
export function parseAisTime(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s*(?:([+-])(\d{2}):?(\d{2}))?/);
  if (!m) return undefined;
  const ms = (m[3] ?? "").padEnd(3, "0").slice(0, 3);
  const off = m[4] ? `${m[4]}${m[5]}:${m[6]}` : "Z";
  const t = Date.parse(`${m[1]}T${m[2]}.${ms}${off}`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const r1 = (v: number) => Math.round(v * 10) / 10;

export type StaticInfo = { name?: string; destination?: string; cls?: ShipClass };

// static data remembered across samples on a warm instance (MMSI -> name/destination/class), bounded
const staticMemory = new Map<number, StaticInfo>();
const STATIC_MEMORY_MAX = 50_000;

function remember(memory: Map<number, StaticInfo>, mmsi: number, info: StaticInfo) {
  const prev = memory.get(mmsi) ?? {};
  const next: StaticInfo = {
    name: info.name ?? prev.name,
    destination: info.destination ?? prev.destination,
    cls: info.cls && info.cls !== "unknown" ? info.cls : prev.cls,
  };
  memory.delete(mmsi); // re-insert so Map order tracks recency
  memory.set(mmsi, next);
  if (memory.size > STATIC_MEMORY_MAX) memory.delete(memory.keys().next().value as number);
}

type AisMessage = { error?: unknown; MessageType?: unknown; MetaData?: Record<string, unknown>; Message?: Record<string, Record<string, unknown> | undefined> };

/**
 * Collects AISStream messages during one sample: dedupes position reports by MMSI (latest report wins), and merges
 * names, destinations and ship types from static data (this sample or remembered from earlier ones).
 */
export function createAisCollector(memory: Map<number, StaticInfo> = staticMemory) {
  const positions = new Map<number, { ship: Ship; t: number }>();
  const metaNames = new Map<number, string>();

  /** Feeds one decoded message. Returns an error string if AISStream reported one. */
  function ingest(raw: unknown, receivedAt = Date.now()): string | undefined {
    if (!raw || typeof raw !== "object") return;
    const m = raw as AisMessage;
    if (m.error) return String(m.error);
    const meta = m.MetaData ?? {};
    const type = m.MessageType;
    const body = typeof type === "string" ? m.Message?.[type] : undefined;
    if (!body) return;
    const mmsi = Number(meta.MMSI ?? body.UserID);
    if (!Number.isInteger(mmsi) || mmsi <= 0) return;
    const metaName = cleanText(meta.ShipName);
    if (metaName) metaNames.set(mmsi, metaName);

    if (type === "ShipStaticData") {
      remember(memory, mmsi, { name: cleanText(body.Name) ?? metaName, destination: cleanText(body.Destination), cls: classOf(Number(body.Type)) });
      return;
    }
    if (type !== "PositionReport") return;
    const lat = Number(body.Latitude ?? meta.latitude ?? meta.Latitude), lon = Number(body.Longitude ?? meta.longitude ?? meta.Longitude);
    // 91 / 181 mean "not available"; 0,0 is a common bad fix
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return;
    const at = parseAisTime(meta.time_utc) ?? new Date(receivedAt).toISOString();
    const t = Date.parse(at);
    const prev = positions.get(mmsi);
    if (prev && prev.t > t) return; // an older report arrived late
    const sog = Number(body.Sog), cog = Number(body.Cog), hdg = Number(body.TrueHeading), nav = Number(body.NavigationalStatus);
    positions.set(mmsi, {
      t,
      ship: {
        mmsi, lon: r4(lon), lat: r4(lat),
        sog: Number.isFinite(sog) && sog >= 0 && sog < 102.3 ? r1(sog) : 0,
        cog: Number.isFinite(cog) && cog >= 0 && cog < 360 ? r1(cog) % 360 : 0,
        heading: Number.isFinite(hdg) && hdg >= 0 && hdg < 360 ? hdg : null,
        cls: "unknown",
        nav: body.NavigationalStatus == null || !Number.isFinite(nav) ? null : nav,
        at,
      },
    });
  }

  /** The deduped ships with static data merged in. */
  function ships(): Ship[] {
    return [...positions.values()].map(({ ship }) => {
      const st = memory.get(ship.mmsi);
      const out: Ship = { ...ship, cls: st?.cls ?? ship.cls };
      const name = st?.name ?? metaNames.get(ship.mmsi);
      if (name) out.name = name;
      if (st?.destination) out.destination = st.destination;
      return out;
    });
  }

  return { ingest, ships, get size() { return positions.size; } };
}

const zoneOf = (s: Ship) => WATCH_ZONES.find((z) => km([s.lon, s.lat], z.center) <= Math.min(z.radiusKm, 420))?.id;

/**
 * Caps the payload: ships in flagged (anomalous) zones first, then moving ships, ships in watch zones and merchant
 * ships. Inside the tier that overflows, ships are taken round-robin across 3-degree cells so one busy port does not
 * crowd out the rest of the map.
 */
export function selectShips(list: Ship[], cap = MAX_SHIPS, flagged: Set<string> = new Set()): Ship[] {
  if (list.length <= cap) return list;
  const tiers = new Map<number, Ship[]>();
  for (const s of list) {
    const zone = zoneOf(s);
    const score = (zone && flagged.has(zone) ? 8 : 0) + (s.sog >= 1.5 ? 4 : 0) + (zone ? 2 : 0) + (s.cls === "cargo" || s.cls === "tanker" ? 1 : 0);
    (tiers.get(score) ?? tiers.set(score, []).get(score)!).push(s);
  }
  const out: Ship[] = [];
  for (const score of [...tiers.keys()].sort((a, b) => b - a)) {
    const tier = tiers.get(score)!;
    const room = cap - out.length;
    if (room <= 0) break;
    if (tier.length <= room) { out.push(...tier); continue; }
    const cells = new Map<string, Ship[]>();
    for (const s of tier) {
      const k = `${Math.floor(s.lat / 3)}:${Math.floor(s.lon / 3)}`;
      (cells.get(k) ?? cells.set(k, []).get(k)!).push(s);
    }
    const queues = [...cells.values()];
    for (let i = 0; out.length < cap; i++) {
      let took = false;
      for (const q of queues) {
        if (i < q.length) { out.push(q[i]); took = true; if (out.length >= cap) break; }
      }
      if (!took) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- live sample

async function sample(seconds: number): Promise<Ship[]> {
  const key = process.env.AISSTREAM_API_KEY!;
  const collector = createAisCollector();
  const decoder = new TextDecoder();
  return new Promise((resolve, reject) => {
    let done = false, ws: WebSocket | undefined;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* already closed */ }
      if (collector.size > 0) resolve(collector.ships());
      else reject(err ?? new Error(`no position reports within ${seconds}s`));
    };
    const timer = setTimeout(() => finish(), seconds * 1000);
    try {
      ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
      ws.binaryType = "arraybuffer";
    } catch (e) {
      clearTimeout(timer);
      return reject(e instanceof Error ? e : new Error(String(e)));
    }
    const sock = ws;
    sock.onopen = () => sock.send(JSON.stringify({ APIKey: key, BoundingBoxes: aisBoxes(), FilterMessageTypes: ["PositionReport", "ShipStaticData"] }));
    sock.onerror = () => finish(new Error("AISStream connection error"));
    sock.onclose = () => finish(new Error("AISStream closed the connection without data"));
    sock.onmessage = (ev: MessageEvent) => {
      if (done) return;
      try {
        const text = typeof ev.data === "string" ? ev.data : decoder.decode(ev.data as ArrayBuffer);
        const err = collector.ingest(JSON.parse(text), Date.now());
        if (err) finish(new Error(`AISStream: ${err}`));
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

// the previous snapshot's underway ships per region (warm instances only)
const previous = new Map<string, { at: number; underway: Set<number> }>();

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
    // cached() serves the last good snapshot when a refresh fails (sample() rejects instead of returning no ships)
    return await cached("ais", 90_000, async () => {
      const list = await sample(SAMPLE_SECONDS);
      const regions = analyse(list, Date.now());
      const flagged = new Set(regions.filter((r) => r.anomalies.length).map((r) => r.id));
      return { configured: true, ok: true, sampledAt: new Date().toISOString(), seconds: SAMPLE_SECONDS, shipCount: list.length, ships: selectShips(list, MAX_SHIPS, flagged), regions };
    });
  } catch (e) {
    return { configured: true, ok: false, shipCount: 0, ships: [], regions: [], note: `AISStream unavailable: ${e instanceof Error ? e.message : e}` };
  }
}
