// Offline self-test for the AISStream parsing/merging code in lib/ais.ts (no key, no network).
// Run: npx tsx scripts/ais-selftest.mts
// Optional live sample (needs AISSTREAM_API_KEY): npx tsx --env-file=.env.local scripts/ais-selftest.mts --live
import assert from "node:assert/strict";
import { aisBoxes, aisSnapshot, classOf, cleanText, createAisCollector, parseAisTime, selectShips, type Ship, type StaticInfo } from "../lib/ais";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok  ${name}`); };

const pos = (mmsi: number, lat: number, lon: number, time: string, extra: Record<string, unknown> = {}, shipName = "") => ({
  MessageType: "PositionReport",
  MetaData: { MMSI: mmsi, MMSI_String: String(mmsi), ShipName: shipName, latitude: lat, longitude: lon, time_utc: time },
  Message: { PositionReport: { MessageID: 1, UserID: mmsi, Valid: true, Latitude: lat, Longitude: lon, Sog: 12.34, Cog: 181.26, TrueHeading: 180, NavigationalStatus: 0, Timestamp: 30, ...extra } },
});
const stat = (mmsi: number, name: string, type: number, destination: string, time: string) => ({
  MessageType: "ShipStaticData",
  MetaData: { MMSI: mmsi, ShipName: name, latitude: 0, longitude: 0, time_utc: time },
  Message: { ShipStaticData: { MessageID: 5, UserID: mmsi, Valid: true, Name: name, Type: type, Destination: destination, CallSign: "ABCD", ImoNumber: 9000000 } },
});

test("parseAisTime handles AISStream's Go-style timestamp", () => {
  assert.equal(parseAisTime("2024-02-17 13:34:56.207576423 +0000 UTC"), "2024-02-17T13:34:56.207Z");
  assert.equal(parseAisTime("2024-02-17 13:34:56 +0200 EET"), "2024-02-17T11:34:56.000Z");
  assert.equal(parseAisTime("2024-02-17T13:34:56Z"), "2024-02-17T13:34:56.000Z");
  assert.equal(parseAisTime("garbage"), undefined);
  assert.equal(parseAisTime(undefined), undefined);
});

test("cleanText strips AIS padding", () => {
  assert.equal(cleanText("EVER GIVEN@@@@@   "), "EVER GIVEN");
  assert.equal(cleanText("  SG   SIN  "), "SG SIN");
  assert.equal(cleanText("@@@@"), undefined);
  assert.equal(cleanText(42), undefined);
});

test("classOf maps ship types and treats 0 as unknown", () => {
  assert.equal(classOf(70), "cargo"); assert.equal(classOf(84), "tanker"); assert.equal(classOf(60), "passenger");
  assert.equal(classOf(30), "fishing"); assert.equal(classOf(52), "other"); assert.equal(classOf(0), "unknown"); assert.equal(classOf(NaN), "unknown");
});

test("collector merges name, destination, class and time; dedupes by MMSI keeping the latest report", () => {
  const memory = new Map<number, StaticInfo>();
  const c = createAisCollector(memory);
  // ship A: position, then static data, then a newer position, then a late-arriving older one
  c.ingest(pos(353136000, 13.1, 42.9, "2026-10-10 12:00:00.100000000 +0000 UTC", {}, "EVER GIVEN   "));
  c.ingest(stat(353136000, "EVER GIVEN@@@@", 71, "NLRTM@@@@", "2026-10-10 12:00:01 +0000 UTC"));
  c.ingest(pos(353136000, 13.123456789, 42.987654321, "2026-10-10 12:00:10.500000000 +0000 UTC", { Sog: 13.06, Cog: 359.96 }));
  c.ingest(pos(353136000, 14, 43, "2026-10-10 11:59:00 +0000 UTC"));
  // ship B: tanker static data arrives before its position; no ShipName in metadata
  c.ingest(stat(636019825, "FRONT ALTAIR", 80, "FUJAIRAH", "2026-10-10 12:00:02 +0000 UTC"));
  c.ingest(pos(636019825, 25.9, 56.6, "2026-10-10 12:00:03 +0000 UTC", { Sog: 102.3, Cog: 360, TrueHeading: 511, NavigationalStatus: 1 }));
  // ship C: no static data, no time_utc -> receive time; name only from MetaData
  const rx = Date.parse("2026-10-10T12:00:04Z");
  c.ingest({ ...pos(477000001, 1.2, 103.8, ""), MetaData: { MMSI: 477000001, ShipName: "MSC ANNA  ", latitude: 1.2, longitude: 103.8 } }, rx);
  // junk that must be ignored: not-available position, null island, bad MMSI, other message types
  c.ingest(pos(111111111, 91, 181, "2026-10-10 12:00:00 +0000 UTC"));
  c.ingest(pos(222222222, 0, 0, "2026-10-10 12:00:00 +0000 UTC"));
  c.ingest(pos(0, 10, 10, "2026-10-10 12:00:00 +0000 UTC"));
  c.ingest({ MessageType: "SubscriptionConfirmation", Message: { CompressionEnabled: true } });
  assert.equal(c.ingest({ error: "Api Key Is Not Valid" }), "Api Key Is Not Valid");

  const ships = new Map(c.ships().map((s) => [s.mmsi, s]));
  assert.equal(ships.size, 3);
  assert.deepEqual(ships.get(353136000), {
    mmsi: 353136000, lat: 13.1235, lon: 42.9877, sog: 13.1, cog: 0, heading: 180, cls: "cargo", nav: 0,
    at: "2026-10-10T12:00:10.500Z", name: "EVER GIVEN", destination: "NLRTM",
  } satisfies Ship);
  const b = ships.get(636019825)!;
  assert.equal(b.cls, "tanker"); assert.equal(b.name, "FRONT ALTAIR"); assert.equal(b.destination, "FUJAIRAH");
  assert.equal(b.sog, 0); assert.equal(b.cog, 0); assert.equal(b.heading, null); assert.equal(b.nav, 1);
  assert.equal(b.at, "2026-10-10T12:00:03.000Z");
  const cShip = ships.get(477000001)!;
  assert.equal(cShip.name, "MSC ANNA"); assert.equal(cShip.destination, undefined); assert.equal(cShip.cls, "unknown");
  assert.equal(cShip.at, "2026-10-10T12:00:04.000Z");

  // static data is remembered for the next sample on a warm instance
  const next = createAisCollector(memory);
  next.ingest(pos(636019825, 25.95, 56.65, "2026-10-10 12:02:00 +0000 UTC"));
  assert.equal(next.ships()[0].destination, "FUJAIRAH");
  assert.equal(next.ships()[0].cls, "tanker");
});

test("selectShips caps the payload, keeps moving/watch-zone ships first and spreads across cells", () => {
  const mk = (i: number, lat: number, lon: number, sog: number): Ship => ({ mmsi: 200000000 + i, lat, lon, sog, cog: 90, heading: null, cls: "cargo", nav: 0 });
  const list: Ship[] = [];
  for (let i = 0; i < 3000; i++) list.push(mk(i, 51 + (i % 10) * 0.01, 3 + (i % 10) * 0.01, 0)); // 3000 moored ships off Rotterdam
  for (let i = 0; i < 300; i++) list.push(mk(10000 + i, 2.4, 102.2, 12)); // moving, in the Malacca watch zone
  for (let i = 0; i < 300; i++) list.push(mk(20000 + i, -34 - (i % 3) * 3, 18 + (i % 5) * 3, 11)); // moving, off the Cape, many cells
  const out = selectShips(list, 2000);
  assert.equal(out.length, 2000);
  assert.equal(new Set(out.map((s) => s.mmsi)).size, 2000);
  assert.equal(out.filter((s) => s.sog > 0).length, 600, "all moving ships kept");
  assert.deepEqual(out.slice(0, 300).map((s) => s.lat), new Array(300).fill(2.4), "moving watch-zone ships come first");
  assert.equal(selectShips(list.slice(0, 10), 2000).length, 10);
  // a flagged zone outranks everything
  const flagged = selectShips(list, 100, new Set(["malacca"]));
  assert.ok(flagged.every((s) => s.lat === 2.4));
});

test("subscription boxes are [[lat, lon], [lat, lon]] and valid", () => {
  const boxes = aisBoxes();
  assert.ok(boxes.length >= 20 && boxes.length <= 50, `box count ${boxes.length}`);
  for (const [[s, w], [n, e]] of boxes) {
    assert.ok(s < n && w < e, "south < north and west < east");
    assert.ok(Math.abs(s) <= 90 && Math.abs(n) <= 90 && Math.abs(w) <= 180 && Math.abs(e) <= 180);
  }
});

console.log(`\n${passed} tests passed`);

if (process.argv.includes("--live")) {
  if (!process.env.AISSTREAM_API_KEY) {
    console.log("live: AISSTREAM_API_KEY not set, skipped");
  } else {
    const t0 = Date.now();
    const snap = await aisSnapshot();
    const named = snap.ships.filter((s) => s.name).length, dest = snap.ships.filter((s) => s.destination).length;
    const byCls = snap.ships.reduce<Record<string, number>>((a, s) => ((a[s.cls] = (a[s.cls] ?? 0) + 1), a), {});
    console.log(`live: ok=${snap.ok} in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${snap.shipCount} ships sampled, ${snap.ships.length} returned, ${named} named, ${dest} with destination, classes ${JSON.stringify(byCls)}`);
    console.log(`live: zones with ships: ${snap.regions.filter((r) => r.ships).map((r) => `${r.id}=${r.ships}`).join(", ")}; anomalies: ${snap.regions.reduce((n, r) => n + r.anomalies.length, 0)}`);
    if (snap.note) console.log(`live: note: ${snap.note}`);
  }
}
