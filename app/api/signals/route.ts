import { connection } from "next/server";
import { getSignals } from "@/lib/signals";

export const maxDuration = 60;

export async function GET() {
  // live data: always evaluate at request time (upstream calls are cached in memory)
  await connection();
  const signals = await getSignals();
  return Response.json(signals, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=900" } });
}
