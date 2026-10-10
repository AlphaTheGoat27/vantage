import { DEMO_INFO, getDemoSignals, isDemoRequest } from "@/lib/demo";
import { planShipment } from "@/lib/planner";
import { getSignals } from "@/lib/signals";
import type { Hazard, PipelineEvent, PlanResponse, ShipmentInput, SignalsResponse } from "@/lib/types";

export const maxDuration = 60;

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Demo mode: the Detect stage must not count the scenario's stand-in sources as live feeds. */
function labelDemoStep(e: PipelineEvent) {
  if (e.type !== "step" || e.step !== "detect") return;
  e.summary = e.summary.startsWith("No live hazard")
    ? "No scenario hazard found near the route (demo scenario, not live data)"
    : e.summary.replace(/,? from \d+ live sources?$/, " in the hand-authored demo scenario (not live data)");
  e.sourcesLive = 0;
  e.sourcesFallback = 0;
  e.sourcesDown = 0;
}

export async function POST(req: Request) {
  let body: Partial<ShipmentInput>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  // ?demo=1 -> plan against the labeled demo scenario instead of the live feeds (the planner itself still runs for real).
  // Plans are never cached, so demo and live plans cannot share a cache entry.
  const demo = isDemoRequest(req);
  const loadSignals = (): Promise<SignalsResponse> => (demo ? Promise.resolve(getDemoSignals()) : getSignals());
  const finish = (plan: PlanResponse): PlanResponse => (demo ? { ...plan, demo: { ...DEMO_INFO } } : plan);
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
  // ?stream=1 -> newline-delimited JSON: one event per pipeline stage as it completes, then {type:"result"}
  if (new URL(req.url).searchParams.get("stream") === "1") {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        try {
          send(
            demo
              ? { type: "progress", step: "detect", message: `Loading the demo scenario "${DEMO_INFO.scenario}" (hand-authored, not live data)` }
              : { type: "progress", step: "detect", message: "Collecting live signals: ship traffic, news, disaster alerts" },
          );
          const signals = await loadSignals();
          const emit = (e: PipelineEvent) => {
            if (demo) labelDemoStep(e);
            send(e);
          };
          const plan = await planShipment(input, signals.hazards, signals.chokepoints, { emit, sources: signals.sources });
          send({ type: "result", plan: finish(plan) });
        } catch (e) {
          send({ type: "error", error: e instanceof Error ? e.message : String(e) });
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  }
  try {
    const signals = await loadSignals();
    const plan = await planShipment(input, signals.hazards, signals.chokepoints, { sources: signals.sources, emit: demo ? labelDemoStep : undefined });
    return demo ? Response.json(finish(plan), { headers: { "cache-control": "no-store" } }) : Response.json(plan);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
}
