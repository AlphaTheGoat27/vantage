import { cached, fetchJson, fetchText } from "./cache";
import type { LonLat } from "./geo";
import { WATCH_ZONES, type WatchZone } from "./places";
import type { Chokepoint, Evidence, Hazard, SourceStatus } from "./types";

const MIN = 60_000;
const PORTWATCH = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services";

type Result<T> = { status: SourceStatus; data: T };

async function guard<T>(name: string, url: string, empty: T, run: () => Promise<{ data: T; count: number; note?: string }>): Promise<Result<T>> {
  try {
    const r = await run();
    return { status: { name, url, ok: true, count: r.count, note: r.note }, data: r.data };
  } catch (e) {
    return { status: { name, url, ok: false, count: 0, note: e instanceof Error ? e.message : String(e) }, data: empty };
  }
}

// ---------- IMF PortWatch: daily transit counts through 28 chokepoints ----------
type PwRow = { date: string; portid: string; portname: string; n_total: number };

export function portwatchChokepoints(): Promise<Result<Chokepoint[]>> {
  return guard("IMF PortWatch chokepoint transits", "https://portwatch.imf.org", [], () =>
    cached("portwatch", 60 * MIN, async () => {
      const [meta, rows] = await Promise.all([
        fetchJson<{ features: { attributes: { portid: string; portname: string; lat: number; lon: number } }[] }>(
          `${PORTWATCH}/PortWatch_chokepoints_database/FeatureServer/0/query?where=1%3D1&outFields=portid,portname,lat,lon&returnGeometry=false&f=json`,
        ),
        (async () => {
          const since = new Date(Date.now() - 110 * 86400_000).toISOString().slice(0, 10);
          const out: PwRow[] = [];
          for (let offset = 0; offset < 6000; offset += 1000) {
            const page = await fetchJson<{ features: { attributes: PwRow }[]; exceededTransferLimit?: boolean }>(
              `${PORTWATCH}/Daily_Chokepoints_Data/FeatureServer/0/query?where=${encodeURIComponent(`date >= DATE '${since}'`)}&outFields=date,portid,portname,n_total&orderByFields=date%20DESC&resultOffset=${offset}&resultRecordCount=1000&f=json`,
            );
            out.push(...page.features.map((f) => f.attributes));
            if (!page.exceededTransferLimit) break;
          }
          return out;
        })(),
      ]);
      const byPort = new Map<string, PwRow[]>();
      for (const r of rows) {
        const list = byPort.get(r.portid) ?? [];
        list.push(r);
        byPort.set(r.portid, list);
      }
      const data: Chokepoint[] = meta.features.map(({ attributes: a }) => {
        const list = (byPort.get(a.portid) ?? []).sort((x, y) => (x.date < y.date ? 1 : -1));
        const recent = list.slice(0, 7), base = list.slice(7, 97);
        const avg = (l: PwRow[]) => (l.length ? l.reduce((s, r) => s + r.n_total, 0) / l.length : undefined);
        const avg7 = avg(recent), baseline = avg(base);
        const changePct = avg7 !== undefined && baseline ? ((avg7 - baseline) / baseline) * 100 : undefined;
        return { id: a.portid, name: a.portname, center: [a.lon, a.lat] as LonLat, avg7, baseline, changePct, asOf: list[0]?.date };
      });
      const asOf = data.find((c) => c.asOf)?.asOf;
      return { data, count: data.length, note: asOf ? `data as of ${asOf} (PortWatch publishes with a few days' lag)` : undefined };
    }),
  );
}

// ---------- GDACS: cyclones, earthquakes, volcanoes, floods ----------
type GdacsFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    eventtype: string; eventid: number; name: string; alertlevel: string; fromdate: string; todate: string;
    iscurrent: string | boolean; url?: { report?: string }; severitydata?: { severity?: number; severitytext?: string }; country?: string;
  };
};

export function gdacsHazards(): Promise<Result<Hazard[]>> {
  return guard("GDACS disaster alerts", "https://www.gdacs.org", [], () =>
    cached("gdacs", 20 * MIN, async () => {
      const d = await fetchJson<{ features: GdacsFeature[] }>(
        "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC;EQ;VO&alertlevel=Green;Orange;Red",
      );
      const out: Hazard[] = [];
      const seenQuakeCluster = new Map<string, Hazard>();
      for (const f of d.features) {
        const p = f.properties;
        if (String(p.iscurrent) !== "true") continue;
        const lvl = p.alertlevel;
        const base = lvl === "Red" ? 85 : lvl === "Orange" ? 62 : 35;
        const center = f.geometry.coordinates as LonLat;
        const ev: Evidence = { source: "GDACS", text: `${p.name}: ${p.severitydata?.severitytext ?? ""} (${lvl} alert)`, url: p.url?.report, time: p.todate };
        if (p.eventtype === "TC") {
          out.push({
            id: `gdacs-tc-${p.eventid}`, title: p.name.replace("Tropical Cyclone ", "Cyclone "), category: "tropical-cyclone", center,
            radiusKm: lvl === "Red" ? 550 : lvl === "Orange" ? 420 : 300, score: base, signalScore: base,
            rationale: `${lvl} cyclone alert. ${p.severitydata?.severitytext ?? ""}. Ships divert or slow down around the storm track.`,
            evidence: [ev], sources: ["GDACS"], updated: p.todate,
          });
        } else if (p.eventtype === "EQ") {
          const mag = Number(/Magnitude ([\d.]+)/.exec(p.severitydata?.severitytext ?? "")?.[1] ?? 0);
          if (mag < 5.8 && lvl === "Green") continue;
          // cluster swarms (many quakes in one place) into one hazard
          const key = `${Math.round(center[0])},${Math.round(center[1])}`;
          const prev = seenQuakeCluster.get(key);
          if (prev) {
            prev.evidence.push(ev);
            prev.signalScore = prev.score = Math.min(80, prev.score + 3);
            continue;
          }
          const s = Math.max(base, Math.min(70, (mag - 5) * 25));
          const h: Hazard = {
            id: `gdacs-eq-${p.eventid}`, title: p.name, category: "earthquake", center, radiusKm: 200, score: s, signalScore: s,
            rationale: `M${mag} earthquake. Coastal quakes can damage port infrastructure and trigger tsunami warnings or canal/port inspections.`,
            evidence: [ev], sources: ["GDACS"], updated: p.todate,
          };
          seenQuakeCluster.set(key, h);
          out.push(h);
        } else if (p.eventtype === "VO") {
          out.push({
            id: `gdacs-vo-${p.eventid}`, title: p.name, category: "volcano", center, radiusKm: 150, score: base, signalScore: base,
            rationale: `${lvl} volcano alert: ash and closures can affect nearby ports.`, evidence: [ev], sources: ["GDACS"], updated: p.todate,
          });
        }
      }
      return { data: out, count: out.length };
    }),
  );
}

// ---------- NASA EONET: severe storms and sea ice ----------
type EonetEvent = { id: string; title: string; link: string; categories: { id: string }[]; geometry: { date: string; coordinates: [number, number] | number[][][]; type: string; magnitudeValue?: number; magnitudeUnit?: string }[] };

export function eonetHazards(): Promise<Result<Hazard[]>> {
  return guard("NASA EONET natural events", "https://eonet.gsfc.nasa.gov", [], () =>
    cached("eonet", 30 * MIN, async () => {
      const d = await fetchJson<{ events: EonetEvent[] }>("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=10&category=severeStorms,seaLakeIce");
      const out: Hazard[] = [];
      for (const e of d.events) {
        const g = e.geometry[e.geometry.length - 1];
        if (!g || g.type !== "Point") continue;
        const ice = e.categories.some((c) => c.id === "seaLakeIce");
        const kts = g.magnitudeUnit === "kts" ? g.magnitudeValue ?? 0 : 0;
        const s = ice ? 30 : Math.min(85, 30 + kts * 0.45);
        out.push({
          id: `eonet-${e.id}`, title: e.title, category: ice ? "sea-ice" : "tropical-cyclone", center: g.coordinates as LonLat,
          radiusKm: ice ? 150 : 250 + kts * 2, score: s, signalScore: s,
          rationale: ice ? "Drifting sea ice reported by NASA EONET." : `Severe storm tracked by NASA EONET${kts ? ` with ${kts} kt winds` : ""}.`,
          evidence: [{ source: "NASA EONET", text: `${e.title}${kts ? ` (${kts} kts)` : ""}`, url: e.link, time: g.date }], sources: ["NASA EONET"], updated: g.date,
        });
      }
      return { data: out, count: out.length };
    }),
  );
}

// ---------- Live news: Google News RSS per watch zone, GDELT as a second source ----------
export type Headline = { title: string; url: string; source: string; time: string; weight: number };

const LEX: [RegExp, number][] = [
  [/missile|drone strike|struck|hit by|attack(ed|s)?|explosion|blast|sank|sinking|hijack|seiz(ed|ure)|mine\b|killed|ablaze|fire aboard|shots fired|projectile/i, 1],
  [/pirat|boarded|blockade|clos(ed|ure)|suspend|halt|warship|navy|naval|drill|live-fire|intercept|escalat|offensive|fighting/i, 0.65],
  [/threat|warn|tension|advisory|divert|rerout|delay|congest|queue|restrict|drought|insurance|war risk|surcharge/i, 0.4],
];
const MARITIME = /ship|vessel|tanker|carrier|port|maritime|shipping|strait|canal|cargo|crew|freight|navy|sea\b|oil|transit/i;
export const headlineWeight = (t: string) => (LEX.find(([re]) => re.test(t))?.[1] ?? 0.15) * (MARITIME.test(t) ? 1 : 0.5);

function parseRss(xml: string): Omit<Headline, "weight">[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const pick = (s: string, tag: string) => (new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(s)?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "");
  const unesc = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return items.map((it) => {
    const raw = unesc(pick(it, "title"));
    const source = unesc(pick(it, "source")) || raw.split(" - ").pop() || "";
    const title = raw.endsWith(` - ${source}`) ? raw.slice(0, -(source.length + 3)) : raw;
    return { title, url: pick(it, "link"), source, time: new Date(pick(it, "pubDate")).toISOString() };
  });
}

async function zoneNews(z: WatchZone): Promise<Headline[]> {
  return cached(`news-${z.id}`, 30 * MIN, async () => {
    const q = encodeURIComponent(`${z.query} when:7d`);
    const xml = await fetchText(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`);
    const seen = new Set<string>();
    return parseRss(xml)
      .filter((h) => z.mustMatch.test(h.title))
      .filter((h) => {
        const k = h.title.toLowerCase().slice(0, 60);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((h) => ({ ...h, weight: headlineWeight(h.title) }))
      .sort((a, b) => b.weight - a.weight || (a.time < b.time ? 1 : -1))
      .slice(0, 25);
  });
}

type GdeltArticle = { url: string; title: string; seendate: string; domain: string };

async function gdeltMaritime(): Promise<Omit<Headline, "weight">[]> {
  return cached("gdelt", 30 * MIN, async () => {
    const q = encodeURIComponent("(ship OR vessel OR tanker OR shipping) (attack OR missile OR drone OR seized OR hijacked OR pirates) sourcelang:english");
    const res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=150&format=json&timespan=7d&sort=datedesc`, { signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    if (!res.ok || !text.startsWith("{")) throw new Error(`GDELT ${res.status}: ${text.slice(0, 80)}`);
    const d = JSON.parse(text) as { articles?: GdeltArticle[] };
    return (d.articles ?? []).map((a) => ({
      title: a.title, url: a.url, source: a.domain,
      time: `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}T${a.seendate.slice(9, 11)}:${a.seendate.slice(11, 13)}:00Z`,
    }));
  });
}

export type ZoneNews = { zone: WatchZone; headlines: Headline[]; signal: number };

export async function newsSignals(): Promise<{ statuses: SourceStatus[]; zones: ZoneNews[] }> {
  const [gn, gd] = await Promise.all([
    guard("Google News (live maritime security headlines)", "https://news.google.com", [] as { z: WatchZone; h: Headline[] }[], async () => {
      const res = await Promise.allSettled(WATCH_ZONES.map(async (z) => ({ z, h: await zoneNews(z) })));
      const data = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (!data.length) throw new Error((res[0] as PromiseRejectedResult).reason?.message ?? "no feeds");
      return { data, count: data.reduce((s, x) => s + x.h.length, 0), note: `${data.length}/${WATCH_ZONES.length} zones` };
    }),
    guard("GDELT 2.0 global news", "https://www.gdeltproject.org", [] as Omit<Headline, "weight">[], async () => {
      const data = await gdeltMaritime();
      return { data, count: data.length };
    }),
  ]);
  const now = Date.now();
  const zones: ZoneNews[] = WATCH_ZONES.map((z) => {
    const fromGn = gn.data.find((x) => x.z.id === z.id)?.h ?? [];
    const fromGd = gd.data.filter((a) => z.mustMatch.test(a.title)).map((a) => ({ ...a, weight: headlineWeight(a.title) }));
    const seen = new Set(fromGn.map((h) => h.title.toLowerCase().slice(0, 60)));
    const headlines = [...fromGn, ...fromGd.filter((h) => !seen.has(h.title.toLowerCase().slice(0, 60)))];
    const mass = headlines.reduce((s, h) => {
      const ageH = (now - Date.parse(h.time)) / 3600_000;
      return s + h.weight * (ageH < 72 ? 1 : 0.5);
    }, 0);
    return { zone: z, headlines, signal: Math.round(100 * (1 - Math.exp(-mass / 7))) };
  });
  return { statuses: [gn.status, gd.status], zones };
}

// ---------- Open-Meteo Marine: wave forecast along a route ----------
export async function waveForecast(points: LonLat[]): Promise<{ status: SourceStatus; maxByPointDay: number[][] }> {
  const url = "https://marine-api.open-meteo.com";
  try {
    const lat = points.map((p) => p[1].toFixed(2)).join(",");
    const lon = points.map((p) => p[0].toFixed(2)).join(",");
    const key = `waves-${lat}-${lon}`;
    const d = await cached(key, 60 * MIN, () =>
      fetchJson<{ daily?: { wave_height_max: (number | null)[] } }[] | { daily?: { wave_height_max: (number | null)[] } }>(
        `${url}/v1/marine?latitude=${lat}&longitude=${lon}&daily=wave_height_max&forecast_days=10`,
      ),
    );
    const arr = Array.isArray(d) ? d : [d];
    const maxByPointDay = arr.map((x) => (x.daily?.wave_height_max ?? []).map((v) => v ?? 0));
    return { status: { name: "Open-Meteo Marine wave forecast", url, ok: true, count: points.length }, maxByPointDay };
  } catch (e) {
    return { status: { name: "Open-Meteo Marine wave forecast", url, ok: false, count: 0, note: String(e) }, maxByPointDay: [] };
  }
}
