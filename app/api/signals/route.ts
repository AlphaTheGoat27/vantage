import { connection } from "next/server";
import { getDemoSignals, isDemoRequest } from "@/lib/demo";
import { getSignals } from "@/lib/signals";

export const maxDuration = 60;

export async function GET(req: Request) {
  // live data: always evaluate at request time (upstream calls are cached in memory)
  await connection();
  // ?demo=1: the labeled, hand-authored scenario; never cached so it cannot mix with live responses
  if (isDemoRequest(req)) return Response.json(getDemoSignals(), { headers: { "cache-control": "no-store" } });
  const signals = await getSignals();
  return Response.json(signals, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=900" } });
}
