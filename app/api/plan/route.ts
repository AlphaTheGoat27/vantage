import { planShipment } from "@/lib/planner";
import { getSignals } from "@/lib/signals";
import type { Hazard, ShipmentInput } from "@/lib/types";

export const maxDuration = 60;

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export async function POST(req: Request) {
  let body: Partial<ShipmentInput>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const extra = Array.isArray(body.extraHazards) ? body.extraHazards.slice(0, 10) : [];
  const input: ShipmentInput = {
    originId: String(body.originId ?? ""),
    destinationId: String(body.destinationId ?? ""),
    cargo: String(body.cargo ?? "general cargo").slice(0, 80),
    cargoValueUsd: num(body.cargoValueUsd, 20e6, 0, 5e9),
    speedKnots: num(body.speedKnots, 16, 6, 25),
    dailyCostUsd: num(body.dailyCostUsd, 60000, 1000, 1e6),
    hullValueUsd: num(body.hullValueUsd, 120e6, 1e6, 1e9),
    critical: Boolean(body.critical),
    extraHazards: extra.map(
      (h, i): Hazard => ({
        id: `sim-${i}`,
        title: String(h.title ?? "Simulated missile strike").slice(0, 80),
        category: "simulated-strike",
        center: [num(h.center?.[0], 0, -180, 180), num(h.center?.[1], 0, -85, 85)],
        radiusKm: num(h.radiusKm, 250, 50, 1000),
        score: num(h.score, 90, 0, 100),
        signalScore: num(h.score, 90, 0, 100),
        rationale: "Scenario injected by the planner: a missile strike on shipping at this position. Insurers typically suspend cover and carriers avoid the area within hours.",
        evidence: [{ source: "What-if scenario", text: "User-simulated strike" }],
        sources: ["Scenario"],
      }),
    ),
  };
  try {
    const signals = await getSignals();
    const plan = await planShipment(input, signals.hazards, signals.chokepoints);
    return Response.json(plan);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
}
