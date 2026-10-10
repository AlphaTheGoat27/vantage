// Refresh the bundled last-good snapshots (lib/data/snapshots/*.json) from the live feeds.
// Run before a deploy:  npx tsx scripts/snapshot-sources.mts
import { writeFileSync } from "node:fs";
import { peek } from "../lib/cache";
import { WATCH_ZONES } from "../lib/places";
import { getSignals } from "../lib/signals";

const dir = new URL("../lib/data/snapshots/", import.meta.url);
const takenAt = new Date().toISOString().slice(0, 10);
const save = (file: string, data: unknown) => {
  if (data == null) throw new Error(`nothing cached for ${file}: is the upstream reachable?`);
  writeFileSync(new URL(file, dir), JSON.stringify({ takenAt, data }));
  console.log("wrote", file);
};

const s = await getSignals();
console.log("sources:", s.sources.map((x) => `${x.name}: ${x.ok ? (x.fallback ? "FALLBACK" : "ok") : "DOWN"}`).join(" | "));
save("portwatch.json", peek("portwatch"));
save("gdacs.json", peek("gdacs"));
save("eonet.json", peek("eonet"));
save("news-weekly.json", peek("news-weekly"));
writeFileSync(new URL("news-zones.json", dir), JSON.stringify({ takenAt, data: Object.fromEntries(WATCH_ZONES.map((z) => [z.id, peek(`news-${z.id}`) ?? []])) }));
console.log("wrote news-zones.json");
