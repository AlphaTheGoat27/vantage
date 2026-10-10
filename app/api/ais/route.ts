import { connection } from "next/server";
import { aisSnapshot } from "@/lib/ais";

export const maxDuration = 30;

// Short-lived AISStream sample (cached 90 s). Returns { configured: false } without AISSTREAM_API_KEY.
export async function GET() {
  await connection();
  return Response.json(await aisSnapshot(), { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } });
}
