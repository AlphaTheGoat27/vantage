import { connection } from "next/server";
import { aisSnapshot } from "@/lib/ais";

export const maxDuration = 30;

// Short-lived AISStream sample (8 s, cached 90 s in memory, last good snapshot served if a refresh fails).
// Returns { configured: false } without AISSTREAM_API_KEY. maxDuration leaves headroom for a slow handshake.
export async function GET() {
  await connection();
  return Response.json(await aisSnapshot(), { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } });
}
