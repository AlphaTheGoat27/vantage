// Last-good snapshot of every live source, bundled with the app so a cold serverless instance can still
// answer when an upstream (PortWatch, Google News, GDACS...) is down. Refresh with:
//   npx tsx scripts/snapshot-sources.mts
import portwatch from "./data/snapshots/portwatch.json";
import gdacs from "./data/snapshots/gdacs.json";
import eonet from "./data/snapshots/eonet.json";
import newsZones from "./data/snapshots/news-zones.json";
import newsWeekly from "./data/snapshots/news-weekly.json";

type Snap = { takenAt: string; data: unknown };
const zones = newsZones as unknown as { takenAt: string; data: Record<string, unknown> | null };

export const SNAPSHOTS: Record<string, Snap> = {
  portwatch: portwatch as Snap,
  gdacs: gdacs as Snap,
  eonet: eonet as Snap,
  "news-weekly": newsWeekly as Snap,
  ...Object.fromEntries(Object.entries(zones.data ?? {}).map(([id, data]) => [`news-${id}`, { takenAt: zones.takenAt, data }])),
};
