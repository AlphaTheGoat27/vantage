"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Crosshair, Layers, LoaderCircle, RefreshCw, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AisSnapshot, Ship } from "@/lib/ais";
import { ago, usd } from "@/lib/format";
import type { LonLat } from "@/lib/geo";
import type { Hazard, PipelineEvent, PipelineStep, PipelineStepId, PlanResponse, PlannedRoute, ShipmentInput, SignalsResponse } from "@/lib/types";
import type { BaseMap } from "./Globe";
import PipelinePanel from "./Pipeline";
import PlanResult, { DECISION } from "./PlanResult";
import ShipCard from "./ShipCard";
import SourcesPanel from "./SourcesPanel";
import ThreatList from "./ThreatList";
import VoyageForm, { PRESETS, StrikeChips, portName, type VoyageFormState } from "./VoyageForm";
import { ROUTE_ROLE, SHIP_COLORS } from "./colors";
import Capsule from "./ui/Capsule";
import Segmented from "./ui/Segmented";
import Sheet, { type Detent } from "./ui/Sheet";
import Switch from "./ui/Switch";
import { useMediaQuery } from "./ui/useMediaQuery";

const Globe = dynamic(() => import("./Globe"), { ssr: false });

type Tab = "voyage" | "threats" | "sources";
const TABS = [
  { value: "voyage", label: "Voyage" },
  { value: "threats", label: "Threats" },
  { value: "sources", label: "Sources" },
] as const;
const MAP_STYLES = [
  { value: "dark", label: "Dark" },
  { value: "osm", label: "Standard" },
  { value: "satellite", label: "Satellite" },
] as const;
const SHIP_LEGEND: Partial<Record<Ship["cls"], string>> = { cargo: "Cargo", tanker: "Tanker", passenger: "Passenger", fishing: "Fishing", other: "Other ships" };

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const PANEL_SPRING = { type: "spring", bounce: 0, duration: 0.35 } as const;
const AIS_POLL_MS = 90_000;
const SIDEBAR_RIGHT_EDGE = 12 + 380; // px from the left edge of the screen
const PEEK_HEIGHT = 128; // the mobile sheet at its peek detent, px

const readDemoFlag = () => new URLSearchParams(window.location.search).get("demo") === "1";

type PlanStreamEvent = PipelineEvent | { type: "result"; plan: PlanResponse } | { type: "error"; error: string };

export default function Dashboard() {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const reduce = useReducedMotion();

  const [signals, setSignals] = useState<SignalsResponse | null>(null);
  const [sigErr, setSigErr] = useState<string | null>(null);
  const [loadingSignals, setLoadingSignals] = useState(true);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [ais, setAis] = useState<AisSnapshot | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [progress, setProgress] = useState<{ step: PipelineStepId; message: string } | null>(null);
  const [activeRoute, setActiveRoute] = useState<PlannedRoute["id"] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedShip, setSelectedShip] = useState<number | null>(null);
  const [baseMap, setBaseMap] = useState<BaseMap>("dark");
  const [pickMode, setPickMode] = useState(false);
  const [strikes, setStrikes] = useState<LonLat[]>([]);
  const [onlyRoute, setOnlyRoute] = useState(false);
  const [tab, setTab] = useState<Tab>("voyage");
  const [demo, setDemo] = useState(false);
  const [editing, setEditing] = useState(false);
  const [detent, setDetent] = useState<Detent>("peek");
  const [form, setForm] = useState<VoyageFormState>({
    originId: "CNSHA", destinationId: "NLRTM", cargo: "Semiconductors", cargoValueUsd: 85e6, critical: true,
    speedKnots: 16, dailyCostUsd: 60000, hullValueUsd: 120e6,
  });

  // only the latest request may write state (demo switches and replans can overlap)
  const sigReq = useRef(0);
  const planReq = useRef(0);
  const planAbort = useRef<AbortController | null>(null);

  const loadSignals = useCallback(async (demoMode: boolean) => {
    const id = ++sigReq.current;
    setLoadingSignals(true);
    setSigErr(null);
    try {
      const r = await fetch(demoMode ? "/api/signals?demo=1" : "/api/signals");
      if (!r.ok) throw new Error(`signals ${r.status}`);
      const j = (await r.json()) as SignalsResponse;
      if (id === sigReq.current) setSignals(j);
    } catch (e) {
      if (id === sigReq.current) setSigErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === sigReq.current) setLoadingSignals(false);
    }
  }, []);

  useEffect(() => {
    // initial load on mount: the demo flag comes from ?demo=1 in the page URL
    const d = readDemoFlag();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (d) setDemo(true);
    loadSignals(d);
  }, [loadSignals]);

  useEffect(() => {
    // live AIS ships: sampled server-side for a few seconds, cached 90 s (returns configured:false without a key)
    let alive = true;
    const pull = () =>
      fetch("/api/ais")
        .then((r) => r.json())
        .then((j: AisSnapshot) => alive && setAis(j))
        .catch(() => undefined);
    pull();
    const t = setInterval(pull, AIS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const runPlan = useCallback(
    async (override?: Partial<VoyageFormState>, strikeList = strikes) => {
      const body: ShipmentInput = {
        ...form, ...override,
        extraHazards: strikeList.map((c, i) => ({
          id: `sim-${i}`, title: `Simulated missile strike #${i + 1}`, category: "simulated-strike", center: c, radiusKm: 250, score: 92, signalScore: 92,
          rationale: "", evidence: [], sources: [],
        })),
      };
      planAbort.current?.abort();
      const ctrl = new AbortController();
      planAbort.current = ctrl;
      const id = ++planReq.current;
      setPlanning(true);
      setPlanErr(null);
      setSteps([]);
      setProgress({ step: "detect", message: "Starting…" });
      setEditing(false);
      try {
        // the plan streams one event per pipeline stage (newline-delimited JSON)
        const r = await fetch(`/api/plan?stream=1${demo ? "&demo=1" : ""}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal,
        });
        if (!r.ok || !r.body) throw new Error(`plan ${r.status}`);
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        const out: { plan: PlanResponse | null } = { plan: null };
        const handle = (line: string) => {
          if (!line.trim() || id !== planReq.current) return;
          const ev = JSON.parse(line) as PlanStreamEvent;
          if (ev.type === "progress") setProgress({ step: ev.step, message: ev.message });
          else if (ev.type === "step") setSteps((prev) => [...prev.filter((x) => x.step !== ev.step), ev]);
          else if (ev.type === "result") out.plan = ev.plan;
          else if (ev.type === "error") throw new Error(ev.error);
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          lines.forEach(handle);
        }
        handle(buf);
        if (id !== planReq.current) return;
        if (!out.plan) throw new Error("the plan stream ended without a result");
        setPlan(out.plan);
        setActiveRoute(null);
      } catch (e) {
        if (id !== planReq.current || ctrl.signal.aborted) return;
        setPlanErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === planReq.current) {
          setPlanning(false);
          setProgress(null);
        }
      }
    },
    [form, strikes, demo],
  );

  const toggleDemo = (on: boolean) => {
    setDemo(on);
    const url = new URL(window.location.href);
    if (on) url.searchParams.set("demo", "1");
    else url.searchParams.delete("demo");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    // a different world: drop the plan (and any plan in flight) and reload the signals
    planAbort.current?.abort();
    planReq.current++;
    setPlan(null);
    setPlanErr(null);
    setPlanning(false);
    setSteps([]);
    setProgress(null);
    setActiveRoute(null);
    setSelected(null);
    setOnlyRoute(false);
    loadSignals(on);
  };

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

  const ship = useMemo(() => (selectedShip === null ? null : (ais?.ships.find((s) => s.mmsi === selectedShip) ?? null)), [ais, selectedShip]);

  const setPick = useCallback(
    (on: boolean) => {
      setPickMode(on);
      if (on && !isDesktop) setDetent("peek"); // uncover the globe
    },
    [isDesktop],
  );

  const onPick = useCallback(
    (p: LonLat) => {
      const next = [...strikes, p];
      setStrikes(next);
      setPickMode(false);
      setTab("voyage");
      runPlan(undefined, next);
    },
    [strikes, runPlan],
  );

  const updateStrikes = (next: LonLat[]) => {
    setStrikes(next);
    if (plan) runPlan(undefined, next);
  };

  const selectShip = useCallback(
    (mmsi: number | null) => {
      setSelectedShip(mmsi);
      if (mmsi !== null && !isDesktop) setDetent((d) => (d === "peek" ? "half" : d));
    },
    [isDesktop],
  );

  const choosePreset = (i: number) => {
    const p = PRESETS[i];
    const next = { ...form, originId: p.o, destinationId: p.d, cargo: p.cargo, cargoValueUsd: p.value, critical: p.critical };
    setForm(next);
    runPlan(next);
  };

  // Esc: cancel strike picking first, then close the ship card
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pickMode) setPickMode(false);
      else if (selectedShip !== null) setSelectedShip(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickMode, selectedShip]);

  // ---- pieces shared by the desktop sidebar and the mobile sheet

  const header = (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <h1 className="font-display text-headline font-semibold text-ink">Vantage</h1>
        <button
          type="button"
          className="btn-plain ml-auto h-7 w-7 p-0 text-ink-2"
          aria-label="Refresh live signals"
          title="Refresh live signals"
          onClick={() => loadSignals(demo)}
          disabled={loadingSignals}
        >
          <RefreshCw size={15} strokeWidth={1.75} className={loadingSignals ? "animate-spin" : ""} />
        </button>
      </div>
      <StatusLine signals={signals} loading={loadingSignals} error={sigErr} demo={demo} />
    </div>
  );

  const tabs = <Segmented mode="tabs" idBase="vt" label="Panel" options={TABS} value={tab} onChange={setTab} />;

  const voyagePanel = (
    <div className="space-y-4">
      {plan || planning ? (
        <>
          <VoyageSummary form={form} open={editing} onToggle={() => setEditing((v) => !v)} />
          {editing && (
            <VoyageForm
              form={form} onChange={setForm} onPreset={choosePreset} onSubmit={() => runPlan()} planning={planning}
              strikes={strikes} onRemoveStrike={(i) => updateStrikes(strikes.filter((_, j) => j !== i))} onClearStrikes={() => updateStrikes([])}
            />
          )}
          {!editing && strikes.length > 0 && (
            <StrikeChips strikes={strikes} onRemove={(i) => updateStrikes(strikes.filter((_, j) => j !== i))} onClear={() => updateStrikes([])} />
          )}
        </>
      ) : (
        <VoyageForm
          form={form} onChange={setForm} onPreset={choosePreset} onSubmit={() => runPlan()} planning={planning}
          strikes={strikes} onRemoveStrike={(i) => updateStrikes(strikes.filter((_, j) => j !== i))} onClearStrikes={() => updateStrikes([])}
        />
      )}

      {planErr && !planning && (
        <div role="alert" className="flex items-center gap-2 text-callout">
          <span className="min-w-0 flex-1 text-red">Couldn’t assess the route ({planErr}).</span>
          <button type="button" className="btn-plain" onClick={() => runPlan()}>
            <RotateCw size={14} strokeWidth={1.75} />
            Retry
          </button>
        </div>
      )}

      {planning ? (
        <PipelinePanel steps={steps} progress={progress} running onSelectHazard={setSelected} />
      ) : plan ? (
        <PlanResult
          plan={plan}
          activeRoute={activeRoute}
          onSelectRoute={setActiveRoute}
          selectedHazardId={selected}
          onSelectHazard={setSelected}
          hazardsById={allHazards}
          onRevealDetail={isDesktop ? undefined : () => setDetent("full")}
        />
      ) : (
        !planErr && (
          <div className="space-y-1 text-callout text-ink-3">
            <p>Choose a voyage and press Assess Route to check it against {demo ? "the scenario’s threats" : "live threats"}.</p>
            <p>Simulate strike drops a hypothetical strike on the globe so you can watch the plan adapt.</p>
          </div>
        )
      )}
    </div>
  );

  const panel = (
    <motion.div
      key={tab}
      role="tabpanel"
      id={`vt-panel-${tab}`}
      aria-labelledby={`vt-tab-${tab}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      {tab === "voyage" && voyagePanel}
      {tab === "threats" && (
        <ThreatList
          hazards={hazards}
          selectedId={selected}
          onSelect={setSelected}
          loading={loadingSignals}
          aiNote={signals?.ai.note}
          routeFilter={plan ? { on: onlyRoute, onChange: setOnlyRoute } : undefined}
        />
      )}
      {tab === "sources" && <SourcesPanel signals={signals} ais={ais} />}
    </motion.div>
  );

  const peekLine = planning ? (
    <div className="flex h-10 items-center gap-2 text-callout" role="status">
      <LoaderCircle size={16} strokeWidth={1.75} className="shrink-0 animate-spin text-accent" />
      <span className="shrink-0 font-medium text-ink">Assessing route</span>
      <span className="min-w-0 truncate text-ink-3">{progress?.message}</span>
    </div>
  ) : plan ? (
    <button type="button" className="flex h-10 w-full items-baseline gap-2 rounded-md pt-2 text-left" onClick={() => setDetent("half")}>
      <span className={`shrink-0 font-display text-headline font-semibold ${DECISION[plan.decision].text}`}>{DECISION[plan.decision].label}</span>
      <span className="num min-w-0 truncate text-callout text-ink-3">{peekDetail(plan)}</span>
    </button>
  ) : (
    <button type="button" className="btn-primary w-full" disabled={form.originId === form.destinationId} onClick={() => runPlan()}>
      Assess Route
    </button>
  );

  const shipCard = ship && <ShipCard ship={ship} onClose={() => setSelectedShip(null)} variant={isDesktop ? "floating" : "inline"} />;

  const selectedRouteId = activeRoute ?? plan?.recommendedRouteId;
  const hasAlternatives = (plan?.routes ?? []).some((r) => r.id !== "original" && r.id !== selectedRouteId);
  const shipClasses = [...new Set((ais?.ships ?? []).map((s) => s.cls))].filter((c) => SHIP_LEGEND[c]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-space text-ink">
      <Globe
        hazards={signals?.hazards ?? []}
        chokepoints={signals?.chokepoints ?? []}
        ships={ais?.ships}
        plan={plan}
        activeRouteId={activeRoute}
        onSelectRoute={setActiveRoute}
        selectedHazardId={selected}
        baseMap={baseMap}
        pickMode={pickMode}
        onPick={onPick}
        onSelectHazard={setSelected}
        selectedShipMmsi={selectedShip}
        onSelectShip={selectShip}
        insets={isDesktop ? { left: SIDEBAR_RIGHT_EDGE, bottom: 0 } : { left: 0, bottom: PEEK_HEIGHT }}
        autoRotate={!pickMode}
      />

      {/* sidebar (desktop) or sheet (mobile) */}
      {isDesktop ? (
        <motion.aside
          aria-label="Vantage planner"
          className="material absolute bottom-3 left-3 top-3 z-10 flex w-[380px] flex-col overflow-hidden rounded-2xl"
          // same initial on server and client (the reduced-motion preference is unknown during SSR); reduce only shortens it
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={reduce ? { duration: 0.2 } : PANEL_SPRING}
        >
          <div className="shrink-0 space-y-3 px-4 pb-3 pt-3.5">
            {header}
            {tabs}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4" style={{ overscrollBehavior: "contain" }}>
            {panel}
          </div>
        </motion.aside>
      ) : (
        <Sheet
          label="Vantage planner"
          detent={detent}
          onDetentChange={setDetent}
          peekHeight={PEEK_HEIGHT}
          header={
            <div className="space-y-2 pb-2">
              {header}
              {peekLine}
            </div>
          }
        >
          <div className="space-y-3 pt-1">
            {shipCard}
            {tabs}
            {panel}
          </div>
        </Sheet>
      )}

      {/* top-right: map controls, the strike hint and the ship card */}
      <div className="pointer-events-none absolute right-3 z-20 flex flex-col items-end gap-2" style={{ top: "max(12px, env(safe-area-inset-top))" }}>
        <div className="pointer-events-auto hidden lg:block">
          <MapControls baseMap={baseMap} onBaseMap={setBaseMap} pickMode={pickMode} onPick={setPick} demo={demo} onDemo={toggleDemo} />
        </div>
        <div className="pointer-events-auto lg:hidden">
          <CompactControls baseMap={baseMap} onBaseMap={setBaseMap} pickMode={pickMode} onPick={setPick} demo={demo} onDemo={toggleDemo} />
        </div>
        <AnimatePresence>
          {pickMode && (
            <motion.p
              key="hint"
              role="status"
              className="material-control pointer-events-auto rounded-full px-3 py-1.5 text-caption text-ink"
              initial={{ opacity: 0, y: reduce ? 0 : -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : -4 }}
              transition={reduce ? { duration: 0.15 } : PANEL_SPRING}
            >
              {isDesktop ? "Click the globe to place a strike · Esc to cancel" : "Tap the globe to place a strike"}
            </motion.p>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {isDesktop && shipCard && (
            <motion.div
              key="ship"
              className="pointer-events-auto w-[300px]"
              initial={{ opacity: 0, y: reduce ? 0 : -6, scale: reduce ? 1 : 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: reduce ? 0 : -6, scale: reduce ? 1 : 0.98 }}
              transition={reduce ? { duration: 0.15 } : PANEL_SPRING}
              style={{ transformOrigin: "top right" }}
            >
              {shipCard}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* legend: only once routes exist */}
      <AnimatePresence>
        {plan && isDesktop && (
          <motion.ul
            key="legend"
            aria-label="Map legend"
            className="material-control pointer-events-none absolute bottom-3 z-10 flex max-w-[calc(100%-428px)] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full px-3.5 py-1.5 text-caption text-ink-2"
            style={{ left: `calc((100% + ${SIDEBAR_RIGHT_EDGE}px) / 2)`, x: "-50%" }}
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : 6 }}
            transition={reduce ? { duration: 0.15 } : PANEL_SPRING}
          >
            <LegendItem label="Selected route">
              <span aria-hidden className="inline-block h-[3px] w-4 rounded-full" style={{ background: ROUTE_ROLE.selected }} />
            </LegendItem>
            {selectedRouteId !== "original" && (
              <LegendItem label="Original">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-4 rounded-full"
                  style={{ background: `repeating-linear-gradient(90deg, ${ROUTE_ROLE.original} 0 4px, transparent 4px 7px)` }}
                />
              </LegendItem>
            )}
            {hasAlternatives && (
              <LegendItem label="Alternatives">
                <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: ROUTE_ROLE.alternative }} />
              </LegendItem>
            )}
            {shipClasses.length > 0 && <li aria-hidden className="h-3 w-px bg-separator" />}
            {shipClasses.map((c) => (
              <LegendItem key={c} label={SHIP_LEGEND[c]!}>
                <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: SHIP_COLORS[c] }} />
              </LegendItem>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** the short fact after the decision in the mobile peek line: where to reassess, or how much risk the plan removes */
function peekDetail(plan: PlanResponse) {
  if (plan.decision === "PROCEED_TO_CHECKPOINT" && plan.checkpoint) return `at ${plan.checkpoint.port.name}`;
  const orig = plan.routes.find((r) => r.id === "original")?.metrics.riskScore;
  const rec = plan.routes.find((r) => r.id === plan.recommendedRouteId)?.metrics.riskScore;
  if (rec === undefined) return "";
  return orig !== undefined && orig !== rec ? `risk ${orig} → ${rec}` : `risk ${rec}`;
}

function StatusLine({ signals, loading, error, demo }: { signals: SignalsResponse | null; loading: boolean; error: string | null; demo: boolean }) {
  const demoInfo = signals?.demo;
  const capsule = (demo || demoInfo) && (
    <Capsule tone="demo" title={demoInfo ? `${demoInfo.scenario}: ${demoInfo.note}` : "Hand-authored scenario in place of the live feeds"}>
      Demo scenario
    </Capsule>
  );
  if (error && !loading) {
    return (
      <div className="flex items-center gap-2 text-caption">
        {capsule}
        <p role="alert" className="min-w-0 truncate text-red" title={error}>
          Live signals unavailable ({error})
        </p>
      </div>
    );
  }
  if (!signals) {
    return (
      <div className="flex items-center gap-2 text-caption text-ink-3">
        {capsule}
        <p>Loading live signals…</p>
      </div>
    );
  }
  const live = signals.sources.filter((s) => s.ok && !s.fallback).length;
  const snap = signals.sources.filter((s) => s.fallback).length;
  return (
    <div className="flex min-w-0 items-center gap-2 text-caption text-ink-3">
      {capsule}
      {signals.demo ? (
        // the capsule already says it is a scenario; keep the line short so it never truncates
        <p className="num min-w-0 truncate" title="Scenario data, not live">
          {signals.hazards.length} hazards · {loading ? "updating…" : ago(signals.generatedAt)}
        </p>
      ) : (
        <p className="num min-w-0 truncate" title={signals.ai.model ? `AI model: ${signals.ai.model}` : signals.ai.note}>
          {live}/{signals.sources.length} sources live
          {snap > 0 && <span className="text-yellow"> · {snap} on snapshot</span>}
          {" · "}
          {signals.hazards.length} hazards · {loading ? "updating…" : ago(signals.generatedAt)}
          {" · "}
          {signals.ai.model ? "AI on" : "AI off"}
        </p>
      )}
    </div>
  );
}

function VoyageSummary({ form, open, onToggle }: { form: VoyageFormState; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="group-inset flex w-full items-center gap-3 px-3 py-2.5 text-left">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-body font-semibold text-ink">
          <span className="truncate">{portName(form.originId)}</span>
          <ArrowRight aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-3" />
          <span className="truncate">{portName(form.destinationId)}</span>
        </span>
        <span className="num block truncate text-caption text-ink-3">
          {form.cargo} · {usd(form.cargoValueUsd)}
          {form.critical && " · Critical"}
        </span>
      </span>
      <span className="shrink-0 text-callout font-medium text-link">{open ? "Done" : "Edit"}</span>
    </button>
  );
}

type ControlProps = { baseMap: BaseMap; onBaseMap: (b: BaseMap) => void; pickMode: boolean; onPick: (on: boolean) => void; demo: boolean; onDemo: (on: boolean) => void };

function MapControls({ baseMap, onBaseMap, pickMode, onPick, demo, onDemo }: ControlProps) {
  return (
    <div className="material-control flex items-center gap-2 rounded-xl p-1.5">
      <Segmented mode="pressed" label="Map style" options={MAP_STYLES} value={baseMap} onChange={onBaseMap} />
      <span aria-hidden className="h-5 w-px bg-separator" />
      <button type="button" aria-pressed={pickMode} onClick={() => onPick(!pickMode)} className={`btn h-7 px-2.5 ${pickMode ? "bg-pink/25" : "bg-transparent hover:bg-fill-2"}`}>
        <Crosshair size={15} strokeWidth={1.75} className={pickMode ? "text-pink" : "text-ink-2"} />
        Simulate strike
      </button>
      <span aria-hidden className="h-5 w-px bg-separator" />
      <label htmlFor="demo-switch-wide" className="cursor-pointer pl-0.5 text-caption font-medium text-ink-2">
        Demo
      </label>
      <span className="pr-1">
        <Switch id="demo-switch-wide" size="sm" checked={demo} onChange={onDemo} />
      </span>
    </div>
  );
}

function CompactControls({ baseMap, onBaseMap, pickMode, onPick, demo, onDemo }: ControlProps) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);
  return (
    <div ref={ref} className="relative">
      <div className="material-control flex items-center gap-0.5 rounded-xl p-1">
        <button type="button" className="btn-plain h-8 w-8 p-0 text-ink" aria-label="Map style" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <Layers {...ICON} />
        </button>
        <button
          type="button"
          aria-label="Simulate strike"
          aria-pressed={pickMode}
          onClick={() => onPick(!pickMode)}
          className={`btn-plain h-8 w-8 p-0 ${pickMode ? "bg-pink/25 text-pink" : "text-ink"}`}
        >
          <Crosshair {...ICON} />
        </button>
        <span aria-hidden className="mx-1 h-5 w-px bg-separator" />
        <label htmlFor="demo-switch-compact" className="cursor-pointer text-caption font-medium text-ink-2">
          Demo
        </label>
        <span className="px-1.5">
          <Switch id="demo-switch-compact" size="sm" checked={demo} onChange={onDemo} />
        </span>
      </div>
      <AnimatePresence>
        {menu && (
          <motion.div
            className="material-control absolute right-0 top-full mt-2 rounded-xl p-1.5"
            style={{ transformOrigin: "top right" }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", bounce: 0, duration: 0.25 }}
          >
            <Segmented
              mode="pressed"
              label="Map style"
              options={MAP_STYLES}
              value={baseMap}
              onChange={(b) => {
                onBaseMap(b);
                setMenu(false);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LegendItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 whitespace-nowrap">
      {children}
      {label}
    </li>
  );
}
