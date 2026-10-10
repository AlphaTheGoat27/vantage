"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PORTS } from "@/lib/places";
import type { LonLat } from "@/lib/geo";
import { CATEGORY_LABEL, type Hazard, type PlanResponse, type PlannedRoute, type ShipmentInput, type SignalsResponse } from "@/lib/types";
import type { BaseMap } from "./Globe";
import { HAZARD_COLORS, ROUTE_COLORS } from "./colors";

const Globe = dynamic(() => import("./Globe"), { ssr: false });

const usd = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}k`);
const ago = (iso?: string) => {
  if (!iso) return "";
  const h = (Date.now() - Date.parse(iso)) / 3600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
};
const riskColor = (s: number) => (s >= 70 ? "#ff4d4d" : s >= 45 ? "#ff9f1a" : s >= 25 ? "#facc15" : "#22e39b");

const PRESETS: { label: string; o: string; d: string; cargo: string; value: number; critical: boolean }[] = [
  { label: "Shanghai → Rotterdam", o: "CNSHA", d: "NLRTM", cargo: "Semiconductors", value: 85e6, critical: true },
  { label: "Port Klang → Hamburg", o: "MYPKG", d: "DEHAM", cargo: "Medical gloves", value: 18e6, critical: false },
  { label: "Jebel Ali → Rotterdam", o: "AEJEA", d: "NLRTM", cargo: "Petrochemicals", value: 40e6, critical: false },
  { label: "Houston → Shanghai", o: "USHOU", d: "CNSHA", cargo: "LNG equipment", value: 60e6, critical: true },
  { label: "Busan → Los Angeles", o: "KRPUS", d: "USLAX", cargo: "EV batteries", value: 70e6, critical: true },
];

const DECISION_STYLE: Record<PlanResponse["decision"], { label: string; cls: string }> = {
  PROCEED: { label: "PROCEED ON ORIGINAL ROUTE", cls: "bg-emerald-500/15 border-emerald-400/60 text-emerald-300" },
  PROCEED_TO_CHECKPOINT: { label: "SAIL TO CHECKPOINT, THEN REASSESS", cls: "bg-amber-500/15 border-amber-400/60 text-amber-200" },
  REROUTE: { label: "REROUTE NOW", cls: "bg-rose-500/15 border-rose-400/60 text-rose-200" },
};

export default function Dashboard() {
  const [signals, setSignals] = useState<SignalsResponse | null>(null);
  const [sigErr, setSigErr] = useState<string | null>(null);
  const [loadingSignals, setLoadingSignals] = useState(true);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [activeRoute, setActiveRoute] = useState<PlannedRoute["id"] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [baseMap, setBaseMap] = useState<BaseMap>("dark");
  const [pickMode, setPickMode] = useState(false);
  const [strikes, setStrikes] = useState<LonLat[]>([]);
  const [onlyRoute, setOnlyRoute] = useState(false);
  const [tab, setTab] = useState<"threats" | "sources">("threats");
  const [form, setForm] = useState({
    originId: "CNSHA", destinationId: "NLRTM", cargo: "Semiconductors", cargoValueUsd: 85e6, critical: true,
    speedKnots: 16, dailyCostUsd: 60000, hullValueUsd: 120e6,
  });

  const loadSignals = useCallback(async () => {
    setLoadingSignals(true);
    setSigErr(null);
    try {
      const r = await fetch("/api/signals");
      if (!r.ok) throw new Error(`signals ${r.status}`);
      setSignals(await r.json());
    } catch (e) {
      setSigErr(String(e));
    } finally {
      setLoadingSignals(false);
    }
  }, []);

  useEffect(() => {
    // initial live-data load on mount
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSignals();
  }, [loadSignals]);

  const runPlan = useCallback(
    async (override?: Partial<typeof form>, strikeList = strikes) => {
      const body: ShipmentInput = {
        ...form, ...override,
        extraHazards: strikeList.map((c, i) => ({
          id: `sim-${i}`, title: `Simulated missile strike #${i + 1}`, category: "simulated-strike", center: c, radiusKm: 250, score: 92, signalScore: 92,
          rationale: "", evidence: [], sources: [],
        })),
      };
      setPlanning(true);
      setPlanErr(null);
      try {
        const r = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `plan ${r.status}`);
        setPlan(j);
        setActiveRoute(null);
      } catch (e) {
        setPlanErr(e instanceof Error ? e.message : String(e));
      } finally {
        setPlanning(false);
      }
    },
    [form, strikes],
  );

  const hazards = useMemo(() => {
    const base = signals?.hazards ?? [];
    if (!onlyRoute || !plan) return base;
    const ids = new Set(plan.routes.find((r) => r.id === "original")?.metrics.exposures.map((e) => e.hazardId));
    return [...base, ...plan.hazards.filter((h) => h.id.startsWith("waves-") || h.id.startsWith("sim-"))].filter((h) => ids.has(h.id));
  }, [signals, onlyRoute, plan]);

  const allHazards = useMemo(() => {
    const m = new Map<string, Hazard>();
    for (const h of [...(signals?.hazards ?? []), ...(plan?.hazards ?? [])]) m.set(h.id, h);
    return m;
  }, [signals, plan]);

  const onPick = useCallback(
    (p: LonLat) => {
      const next = [...strikes, p];
      setStrikes(next);
      setPickMode(false);
      runPlan(undefined, next);
    },
    [strikes, runPlan],
  );

  const recommended = plan?.routes.find((r) => r.id === plan.recommendedRouteId);
  const backup = plan?.routes.find((r) => r.id === plan.backupRouteId);
  const original = plan?.routes.find((r) => r.id === "original");

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#02060d] text-slate-200">
      <Globe
        hazards={signals?.hazards ?? []}
        chokepoints={signals?.chokepoints ?? []}
        plan={plan}
        activeRouteId={activeRoute}
        selectedHazardId={selected}
        baseMap={baseMap}
        pickMode={pickMode}
        onPick={onPick}
        onSelectHazard={setSelected}
      />

      {/* top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto rounded-xl border border-white/10 bg-[#07101d]/85 px-4 py-2 backdrop-blur">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg font-bold tracking-[0.3em] text-cyan-300">VANTAGE</span>
            <span className="hidden text-xs text-slate-400 sm:inline">live maritime risk & rerouting</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            {loadingSignals ? (
              <span className="animate-pulse">fetching live signals…</span>
            ) : signals ? (
              <>
                <span>
                  <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  {signals.sources.filter((s) => s.ok).length}/{signals.sources.length} live sources · {signals.hazards.length} hazards · updated {ago(signals.generatedAt)}
                </span>
                <span className={signals.ai.model ? "text-violet-300" : "text-slate-500"}>
                  AI: {signals.ai.model ? `Gemini (${signals.ai.model})` : "off"}
                </span>
              </>
            ) : (
              <span className="text-rose-300">{sigErr}</span>
            )}
            <button onClick={loadSignals} className="rounded border border-white/10 px-1.5 py-0.5 hover:bg-white/10">
              refresh
            </button>
          </div>
        </div>
        <div className="pointer-events-auto flex gap-1 rounded-xl border border-white/10 bg-[#07101d]/85 p-1 text-xs backdrop-blur">
          {(["dark", "osm", "satellite"] as BaseMap[]).map((b) => (
            <button key={b} onClick={() => setBaseMap(b)} className={`rounded-lg px-2.5 py-1 capitalize ${baseMap === b ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:bg-white/5"}`}>
              {b === "osm" ? "OpenStreetMap" : b}
            </button>
          ))}
        </div>
      </header>

      {/* left: threat board */}
      <aside className="absolute bottom-3 left-3 top-24 z-10 hidden w-[360px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#07101d]/88 backdrop-blur md:flex">
        <div className="flex items-center gap-1 border-b border-white/10 p-2 text-xs">
          <button onClick={() => setTab("threats")} className={`rounded px-2 py-1 ${tab === "threats" ? "bg-white/10 text-white" : "text-slate-400"}`}>
            Threat board
          </button>
          <button onClick={() => setTab("sources")} className={`rounded px-2 py-1 ${tab === "sources" ? "bg-white/10 text-white" : "text-slate-400"}`}>
            Data sources
          </button>
          {plan && tab === "threats" && (
            <label className="ml-auto flex items-center gap-1 text-slate-400">
              <input type="checkbox" checked={onlyRoute} onChange={(e) => setOnlyRoute(e.target.checked)} /> on my route
            </label>
          )}
        </div>
        {tab === "threats" ? (
          <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
            {signals?.ai.note && <p className="rounded bg-violet-500/10 p-2 text-[11px] text-violet-200">{signals.ai.note}</p>}
            {hazards.map((h, i) => (
              <HazardCard key={h.id} h={h} rank={i + 1} open={selected === h.id} onClick={() => setSelected(selected === h.id ? null : h.id)} />
            ))}
            {!loadingSignals && hazards.length === 0 && <p className="p-3 text-xs text-slate-500">No hazards.</p>}
          </div>
        ) : (
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-xs">
            {signals?.sources.map((s) => (
              <div key={s.name} className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${s.ok ? "bg-emerald-400" : "bg-rose-400"}`} />
                  <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-slate-200 hover:underline">
                    {s.name}
                  </a>
                  <span className="ml-auto font-mono text-slate-400">{s.count}</span>
                </div>
                {s.note && <p className="mt-1 text-slate-500">{s.note}</p>}
              </div>
            ))}
            <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2 text-slate-400">
              <p className="font-medium text-slate-200">Also used</p>
              <p className="mt-1">Open-Meteo Marine wave forecast (per route, at the day the ship arrives) · Eurostat MARNET sea-lane network · OpenStreetMap / CARTO / Esri imagery · Google Gemini for categorizing, reasoning and explanations.</p>
            </div>
          </div>
        )}
      </aside>

      {/* right: planner */}
      <aside className="absolute bottom-3 right-3 top-24 z-10 flex w-[min(440px,calc(100%-24px))] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#07101d]/90 backdrop-blur">
        <div className="space-y-2 border-b border-white/10 p-3 text-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Shipment planner</h2>
            <select
              className="rounded border border-white/10 bg-[#0b1626] px-1.5 py-1 text-[11px]"
              value=""
              onChange={(e) => {
                const p = PRESETS[Number(e.target.value)];
                if (!p) return;
                const next = { ...form, originId: p.o, destinationId: p.d, cargo: p.cargo, cargoValueUsd: p.value, critical: p.critical };
                setForm(next);
                runPlan(next);
              }}
            >
              <option value="">Demo voyages…</option>
              {PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PortSelect label="From" value={form.originId} onChange={(v) => setForm({ ...form, originId: v })} />
            <PortSelect label="To" value={form.destinationId} onChange={(v) => setForm({ ...form, destinationId: v })} />
            <Field label="Cargo">
              <input className="input" value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} />
            </Field>
            <Field label="Cargo value (USD M)">
              <input className="input" type="number" min={0} value={form.cargoValueUsd / 1e6} onChange={(e) => setForm({ ...form, cargoValueUsd: Number(e.target.value) * 1e6 })} />
            </Field>
            <Field label="Speed (knots)">
              <input className="input" type="number" min={6} max={25} value={form.speedKnots} onChange={(e) => setForm({ ...form, speedKnots: Number(e.target.value) })} />
            </Field>
            <Field label="Vessel cost / day (USD k)">
              <input className="input" type="number" min={1} value={form.dailyCostUsd / 1000} onChange={(e) => setForm({ ...form, dailyCostUsd: Number(e.target.value) * 1000 })} />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.critical} onChange={(e) => setForm({ ...form, critical: e.target.checked })} />
              Critical shipment (lower risk tolerance)
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => runPlan()}
              disabled={planning || form.originId === form.destinationId}
              className="flex-1 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              {planning ? "Assessing live risk…" : "Assess & replan"}
            </button>
            <button
              onClick={() => setPickMode(!pickMode)}
              title="Click a point on the globe to simulate a missile strike on shipping there"
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${pickMode ? "border-pink-400 bg-pink-500/20 text-pink-200" : "border-white/15 text-slate-300 hover:bg-white/5"}`}
            >
              {pickMode ? "Click the globe…" : "💥 Simulate strike"}
            </button>
          </div>
          {strikes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-pink-200">
              {strikes.map((s, i) => (
                <span key={i} className="rounded bg-pink-500/15 px-1.5 py-0.5 font-mono">
                  strike #{i + 1} {s[1].toFixed(1)}, {s[0].toFixed(1)}
                </span>
              ))}
              <button
                className="text-slate-400 underline"
                onClick={() => {
                  setStrikes([]);
                  if (plan) runPlan(undefined, []);
                }}
              >
                clear
              </button>
            </div>
          )}
          {planErr && <p className="text-rose-300">{planErr}</p>}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
          {!plan && !planning && (
            <div className="space-y-2 text-slate-400">
              <p>Pick a voyage and press <b className="text-slate-200">Assess & replan</b>. Vantage checks the route against live conflict news, chokepoint traffic, cyclones, earthquakes and the wave forecast, ranks each problem, and asks Gemini to replan a feasible safer route and explain it.</p>
              <p>Use <b className="text-pink-200">Simulate strike</b> to drop a missile strike anywhere and watch the plan change.</p>
            </div>
          )}
          {planning && <div className="h-24 animate-pulse rounded-lg bg-white/5" />}
          {plan && !planning && original && backup && (
            <>
              <div className={`rounded-lg border p-3 ${DECISION_STYLE[plan.decision].cls}`}>
                <div className="font-mono text-[11px] tracking-widest">{DECISION_STYLE[plan.decision].label}</div>
                <p className="mt-1 text-sm font-medium text-white">{plan.explanation.headline}</p>
                <p className="mt-1 text-[11px] opacity-70">{plan.ai.used ? `Reasoning by Gemini (${plan.ai.model})` : plan.ai.note}</p>
              </div>

              <div className="space-y-1.5">
                {plan.routes.map((r) => (
                  <RouteCard
                    key={r.id}
                    r={r}
                    base={original}
                    active={(activeRoute ?? plan.recommendedRouteId) === r.id}
                    recommended={r.id === recommended?.id}
                    backup={r.id === plan.backupRouteId && r.id !== recommended?.id}
                    onClick={() => setActiveRoute(r.id)}
                  />
                ))}
              </div>

              {plan.checkpoint && (
                <Section title={`Checkpoint: ${plan.checkpoint.port.name}`} accent="text-amber-300">
                  <p>{plan.checkpoint.reassessNote}</p>
                </Section>
              )}

              <Section title="Problems on the original route, by priority">
                <ol className="space-y-1.5">
                  {plan.problems.map((p) => (
                    <li key={p.hazardId} className="cursor-pointer rounded border border-white/5 bg-white/[0.03] p-2 hover:bg-white/[0.06]" onClick={() => setSelected(p.hazardId)}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-500">#{p.priority}</span>
                        <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${HAZARD_COLORS[p.category]}22`, color: HAZARD_COLORS[p.category] }}>
                          {CATEGORY_LABEL[p.category]}
                        </span>
                        <span className="font-medium text-slate-100">{p.title}</span>
                        {allHazards.get(p.hazardId) && <span className="ml-auto font-mono" style={{ color: riskColor(allHazards.get(p.hazardId)!.score) }}>{allHazards.get(p.hazardId)!.score}</span>}
                      </div>
                      <p className="mt-1 text-slate-300">{p.impact}</p>
                      <p className="mt-0.5 text-slate-500">{p.reasoning}</p>
                    </li>
                  ))}
                  {plan.problems.length === 0 && <li className="text-slate-500">No live hazards on the original route.</li>}
                </ol>
              </Section>

              <Section title="Why the original route is risky (or safe)">
                <p>{plan.explanation.whyOriginal}</p>
              </Section>
              <Section title="Why a backup route">
                <p>{plan.explanation.whyBackup}</p>
              </Section>
              <Section title="How the backup averts the risk">
                <p>{plan.explanation.howBackupAverts}</p>
              </Section>
              <Section title="Trade-offs">
                <p>{plan.explanation.tradeoffs}</p>
              </Section>
              <Section title="Next actions">
                <ul className="list-disc space-y-0.5 pl-4">
                  {plan.explanation.actions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </Section>

              {plan.llmTrace && (
                <Section title="AI replan, checked by the sea-lane router" accent="text-violet-300">
                  <p>{plan.llmTrace.rationale}</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-400">
                    avoid: {plan.llmTrace.avoidHazardIds.map((id) => allHazards.get(id)?.title ?? id).join(", ") || "none"}
                    <br />
                    via: {plan.llmTrace.via.join(" → ") || "direct"}
                  </p>
                  <p className={`mt-1 ${plan.llmTrace.valid ? "text-emerald-300" : "text-rose-300"}`}>
                    {plan.llmTrace.valid ? "✓ " : "✗ "}
                    {plan.llmTrace.validation}
                    {!plan.llmTrace.valid && " (falling back to the router's safest route)"}
                  </p>
                </Section>
              )}

              <details className="rounded border border-white/5 p-2 text-slate-500">
                <summary className="cursor-pointer text-slate-400">Assumptions behind the costs</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>Voyage cost = days at {form.speedKnots} kn × vessel cost per day (charter + fuel).</li>
                  <li>War-risk premium = 1% × exposure to conflict zones × (hull {usd(form.hullValueUsd)} + cargo), charged when exposure ≥ 25%.</li>
                  <li>Chance of a disruption = 25% × (risk index ÷ 100)², so a risk of 100 means a 1-in-4 chance and 50 means about 6%.</li>
                  <li>Disruption cost = 15% of cargo value (25% if critical) + 10 days of vessel cost; expected disruption = chance × cost.</li>
                  <li>Risk index = 100 × (1 − Π(1 − 0.95 × exposure)) over avoidable hazards; exposure = hazard score × proximity, discounted for storms more than 5 days ahead.</li>
                  <li>Hazards that contain the origin or destination port are shown but not scored, since every route is exposed to them.</li>
                </ul>
              </details>
            </>
          )}
        </div>
      </aside>

      {/* legend */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 gap-3 rounded-lg border border-white/10 bg-[#07101d]/80 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur lg:flex">
        <Legend color={ROUTE_COLORS.original} label="original" dashed />
        <Legend color={ROUTE_COLORS.ai} label="AI replanned" />
        <Legend color={ROUTE_COLORS.safest} label="safest" />
        <Legend color={ROUTE_COLORS.checkpoint} label="via checkpoint" />
        <span className="text-slate-500">circles: hazards (pulsing = high risk) · teal: chokepoint traffic vs 90-day baseline</span>
      </div>
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-0.5 w-5" style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color }} />
      {label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-slate-400">
      {label}
      {children}
    </label>
  );
}

function PortSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {[...PORTS].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}, {p.country}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <section className="space-y-1">
      <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${accent ?? "text-slate-400"}`}>{title}</h3>
      <div className="leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

function HazardCard({ h, rank, open, onClick }: { h: Hazard; rank: number; open: boolean; onClick: () => void }) {
  const c = HAZARD_COLORS[h.category] ?? "#ff3b3b";
  return (
    <div onClick={onClick} className={`cursor-pointer rounded-lg border p-2 text-xs transition ${open ? "border-white/25 bg-white/[0.07]" : "border-white/5 bg-white/[0.03] hover:bg-white/[0.06]"}`}>
      <div className="flex items-center gap-2">
        <span className="w-5 font-mono text-slate-500">{rank}</span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded font-mono text-sm font-bold" style={{ background: `${riskColor(h.score)}22`, color: riskColor(h.score) }}>
          {h.score}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-slate-100">{h.title}</div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span style={{ color: c }}>{CATEGORY_LABEL[h.category]}</span>
            {h.confidence && <span className="text-slate-500">· {h.confidence} confidence</span>}
            <span className="truncate text-slate-500">· {h.sources.join(", ")}</span>
          </div>
        </div>
      </div>
      <p className={`mt-1.5 text-slate-400 ${open ? "" : "line-clamp-2"}`}>{h.rationale}</p>
      {open && (
        <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
          <div className="flex gap-3 font-mono text-[10px] text-slate-500">
            <span>signals {h.signalScore}</span>
            {h.aiScore !== undefined && <span className="text-violet-300">gemini {h.aiScore}</span>}
            <span>radius {h.radiusKm} km</span>
          </div>
          {h.evidence.map((e, i) => (
            <div key={i} className="text-[11px] leading-snug">
              <span className="text-slate-500">{e.time ? `${ago(e.time)} · ` : ""}{e.source}: </span>
              {e.url ? (
                <a href={e.url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="text-slate-300 hover:underline">
                  {e.text}
                </a>
              ) : (
                <span className="text-slate-300">{e.text}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RouteCard({ r, base, active, recommended, backup, onClick }: { r: PlannedRoute; base: PlannedRoute; active: boolean; recommended: boolean; backup: boolean; onClick: () => void }) {
  const m = r.metrics, b = base.metrics;
  const dd = m.days - b.days;
  const dc = m.totalExpectedUsd - b.totalExpectedUsd;
  return (
    <button onClick={onClick} className={`w-full rounded-lg border p-2 text-left transition ${active ? "border-white/30 bg-white/[0.07]" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05]"}`}>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: ROUTE_COLORS[r.id] }} />
        <span className="font-medium text-slate-100">{r.label}</span>
        {recommended && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">recommended</span>}
        {backup && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">backup</span>}
        <span className="ml-auto font-mono text-sm font-bold" style={{ color: riskColor(m.riskScore) }}>
          {m.riskScore}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded bg-white/10">
        <div className="h-full" style={{ width: `${m.riskScore}%`, background: riskColor(m.riskScore) }} />
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1 font-mono text-[10px] text-slate-400">
        <span>{m.km.toLocaleString()} km</span>
        <span>
          {m.days} d{r.id !== "original" && <span className={dd > 0 ? "text-amber-300" : "text-emerald-300"}> {dd >= 0 ? "+" : ""}{dd.toFixed(1)}</span>}
        </span>
        <span title="expected total cost">{usd(m.totalExpectedUsd)}</span>
        <span className={r.id === "original" ? "" : dc < 0 ? "text-emerald-300" : "text-rose-300"}>{r.id === "original" ? `war ${usd(m.warRiskPremiumUsd)}` : `${dc < 0 ? "saves" : "+"} ${usd(Math.abs(dc))}`}</span>
      </div>
      {m.chokepoints.length > 0 && <div className="mt-1 truncate text-[10px] text-slate-500">via {m.chokepoints.join(" · ")}</div>}
    </button>
  );
}
