"use client";

import { Check, ChevronRight, X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { signed, usd } from "@/lib/format";
import { CATEGORY_LABEL, type Decision, type Hazard, type PlanResponse, type PlannedRoute } from "@/lib/types";
import { HAZARD_COLORS, ROUTE_ROLE, SYS, confColor, riskColor, riskLabel, routeColor } from "./colors";
import PipelinePanel from "./Pipeline";
import Capsule from "./ui/Capsule";
import Disclosure from "./ui/Disclosure";

export const DECISION: Record<Decision, { label: string; color: string; text: string }> = {
  PROCEED: { label: "Proceed", color: SYS.green, text: "text-green" },
  PROCEED_TO_CHECKPOINT: { label: "Sail to checkpoint, then reassess", color: SYS.yellow, text: "text-yellow" },
  REROUTE: { label: "Reroute now", color: SYS.red, text: "text-red" },
};

const PIPELINE_ANCHOR = "plan-pipeline";

type Props = {
  plan: PlanResponse;
  activeRoute: PlannedRoute["id"] | null;
  onSelectRoute: (id: PlannedRoute["id"]) => void;
  selectedHazardId: string | null;
  onSelectHazard: (id: string) => void;
  hazardsById: Map<string, Hazard>;
  /** the reasoning pipeline was asked for: the parent makes room (the mobile sheet goes to its full detent) */
  onRevealDetail?: () => void;
};

/**
 * A route is dominated when some other route is at least as safe and at least as cheap, and strictly better on one.
 * The original, recommended and backup routes are always kept.
 */
function isDominated(r: PlannedRoute, plan: PlanResponse) {
  if (r.id === "original" || r.id === plan.recommendedRouteId || r.id === plan.backupRouteId) return false;
  const a = r.metrics;
  return plan.routes.some((o) => {
    if (o.id === r.id) return false;
    const b = o.metrics;
    return b.riskScore <= a.riskScore && b.totalExpectedUsd <= a.totalExpectedUsd && (b.riskScore < a.riskScore || b.totalExpectedUsd < a.totalExpectedUsd);
  });
}

/** Exposure-weighted mean confidence of the hazards a route passes; undefined when nothing on it carries a confidence. */
function routeConfidence(r: PlannedRoute, conf: (id: string) => number | undefined) {
  let w = 0;
  let sum = 0;
  for (const e of r.metrics.exposures) {
    const c = conf(e.hazardId);
    if (c === undefined || !(e.exposure > 0)) continue;
    w += e.exposure;
    sum += e.exposure * c;
  }
  return w > 0 ? Math.round(sum / w) : undefined;
}

/** "Detect, Categorize, Prioritize, Explain" in one line, counted from the finished pipeline. */
function pipelineSummary(plan: PlanResponse) {
  const parts: string[] = [];
  for (const s of plan.pipeline) {
    if (s.step === "detect") parts[0] = `${s.items.length} detected`;
    else if (s.step === "categorize") parts[1] = `${s.groups.length} ${s.groups.length === 1 ? "category" : "categories"}`;
    else if (s.step === "prioritize") parts[2] = `${s.rows.length} prioritized`;
    else if (s.step === "explain") parts[3] = "explained";
  }
  return parts.filter(Boolean).join(" · ");
}

/** scroll the nearest scrolling ancestor so `el` sits at its top */
function scrollToTop(el: HTMLElement, smooth: boolean) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) {
      const top = el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop - 4;
      p.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
      return;
    }
  }
}

export default function PlanResult({ plan, activeRoute, onSelectRoute, selectedHazardId, onSelectHazard, hazardsById, onRevealDetail }: Props) {
  const reduce = useReducedMotion();
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const d = DECISION[plan.decision];
  const original = plan.routes.find((r) => r.id === "original");
  const e = plan.explanation;
  const why = [
    { lead: "The original route.", text: e.whyOriginal },
    { lead: "Why a backup.", text: e.whyBackup },
    { lead: "How the backup helps.", text: e.howBackupAverts },
    { lead: "Trade-offs.", text: e.tradeoffs },
  ].filter((x) => x.text?.trim());
  const actions = (e.actions ?? []).filter((a) => a.trim());
  const problems = [...plan.problems].sort((a, b) => a.priority - b.priority);
  const s = plan.shipment;
  const active = activeRoute ?? plan.recommendedRouteId;

  const planHazards = new Map(plan.hazards.map((h) => [h.id, h]));
  const hazard = (id: string) => planHazards.get(id) ?? hazardsById.get(id);
  const conf = (id: string) => hazard(id)?.confidenceScore;

  // "Safest" only when it really has the lowest risk; otherwise name it for what its numbers do win on
  const alts = plan.routes.filter((r) => r.id !== "original");
  const minOf = (k: "riskScore" | "days" | "totalExpectedUsd") => Math.min(...alts.map((r) => r.metrics[k]));
  const routeLabel = (r: PlannedRoute) => {
    if (r.id !== "safest" || r.metrics.riskScore <= minOf("riskScore")) return r.label;
    if (r.metrics.days <= minOf("days")) return "Fastest alternative";
    if (r.metrics.totalExpectedUsd <= minOf("totalExpectedUsd")) return "Cheapest alternative";
    return "Alternative lane";
  };
  const shown = plan.routes.filter((r) => !isDominated(r, plan));
  const summary = pipelineSummary(plan);

  const revealPipeline = () => {
    setPipelineOpen(true);
    onRevealDetail?.();
    // wait a frame or two for the sheet / disclosure to re-render, then bring the pipeline to the top
    window.setTimeout(() => {
      const el = document.getElementById(PIPELINE_ANCHOR);
      if (el) scrollToTop(el, !reduce);
    }, 80);
  };

  return (
    <div className="space-y-4">
      {/* (a) the decision */}
      <section aria-labelledby="plan-decision">
        <h2 id="plan-decision" className={`text-balance font-display text-large font-semibold ${d.text}`}>
          {d.label}
        </h2>
        <Headline text={e.headline} />
        <p className="mt-2 text-caption text-ink-3">{plan.ai.used ? `Reasoning by Gemini (${plan.ai.model})` : plan.ai.note}</p>
        {plan.demo && <p className="mt-0.5 text-caption text-ink-3">Hand-authored scenario: {plan.demo.scenario}.</p>}
        {summary && (
          <button
            type="button"
            onClick={revealPipeline}
            aria-controls={PIPELINE_ANCHOR}
            className="group-inset mt-3 flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-fill-2"
          >
            <span className="num min-w-0 flex-1 text-balance text-caption text-ink-2">{summary}</span>
            <ChevronRight aria-hidden size={15} strokeWidth={1.75} className="shrink-0 text-ink-3" />
            <span className="sr-only">Show the reasoning pipeline</span>
          </button>
        )}
      </section>

      {/* (b) route options (dominated alternatives are left out; the globe still draws them) */}
      {original && (
        <div role="group" aria-label="Route options" className="group-inset">
          {shown.map((r) => (
            <RouteRow
              key={r.id}
              r={r}
              label={routeLabel(r)}
              base={original}
              selectedId={active}
              confidence={routeConfidence(r, conf)}
              recommended={r.id === plan.recommendedRouteId}
              backup={r.id === plan.backupRouteId && r.id !== plan.recommendedRouteId}
              onClick={() => onSelectRoute(r.id)}
            />
          ))}
        </div>
      )}

      {/* (c) checkpoint */}
      {plan.checkpoint && (
        <div className="group-inset px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: ROUTE_ROLE.alternative }} />
            <span className="min-w-0 flex-1 text-body font-medium text-ink">Checkpoint: {plan.checkpoint.port.name}</span>
            <span className="num shrink-0 text-caption text-ink-3">day {plan.checkpoint.etaDays}</span>
          </div>
          <p className="mt-1 text-callout text-ink-2">{plan.checkpoint.reassessNote}</p>
        </div>
      )}

      {/* (d) the reasoning, one level deeper */}
      <div className="[&>section+section]:border-t [&>section+section]:border-separator">
        <Disclosure title="Why this decision" defaultOpen>
          <div className="space-y-2 text-callout text-ink-2">
            {why.map((w) => (
              <p key={w.lead}>
                <span className="font-semibold text-ink">{w.lead}</span> {w.text}
              </p>
            ))}
            {actions.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 marker:text-ink-3">
                {actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </div>
        </Disclosure>

        <Disclosure title="Problems on this route" trailing={problems.length} defaultOpen>
          {problems.length === 0 ? (
            <p className="text-callout text-ink-3">No live hazards on the original route.</p>
          ) : (
            <ol className="group-inset">
              {problems.map((p) => {
                const h = hazard(p.hazardId);
                const c = h?.confidenceScore;
                return (
                  <li key={p.hazardId}>
                    <button
                      type="button"
                      aria-pressed={selectedHazardId === p.hazardId}
                      onClick={() => onSelectHazard(p.hazardId)}
                      className={`w-full px-3 py-2.5 text-left transition-colors duration-150 hover:bg-fill-3 ${selectedHazardId === p.hazardId ? "bg-fill-2" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="num w-4 shrink-0 text-caption text-ink-3">{p.priority}</span>
                        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: HAZARD_COLORS[p.category] ?? SYS.red }} />
                        <span className="min-w-0 flex-1 text-callout font-medium text-ink">{p.title}</span>
                        {h && (
                          <span className="num shrink-0 text-callout font-semibold" style={{ color: riskColor(h.score) }}>
                            {h.score}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 pl-6">
                        <p className="num text-caption text-ink-3">
                          {CATEGORY_LABEL[p.category]}
                          {c !== undefined && (
                            <>
                              {" · "}
                              <span style={{ color: confColor(c) }} title={h?.confidenceReason}>
                                {Math.round(c)}% confidence
                              </span>
                            </>
                          )}
                        </p>
                        <p className="mt-0.5 text-callout text-ink-2">{p.impact}</p>
                        <p className="mt-0.5 text-caption text-ink-3">{p.reasoning}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </Disclosure>

        <Disclosure title="Reasoning pipeline" anchorId={PIPELINE_ANCHOR} open={pipelineOpen} onOpenChange={setPipelineOpen}>
          <PipelinePanel steps={plan.pipeline} progress={null} running={false} onSelectHazard={onSelectHazard} hideTitle />
        </Disclosure>

        {plan.llmTrace && (
          <Disclosure title="AI replan check" trailing={plan.llmTrace.valid ? "Valid" : "Rejected"}>
            <div className="space-y-2 text-callout text-ink-2">
              <p>{plan.llmTrace.rationale}</p>
              <dl className="grid grid-cols-[3rem_1fr] gap-x-2 gap-y-1 text-caption">
                <dt className="text-ink-3">Avoid</dt>
                <dd className="text-ink-2">{plan.llmTrace.avoidHazardIds.map((id) => hazardsById.get(id)?.title ?? id).join(", ") || "None"}</dd>
                <dt className="text-ink-3">Via</dt>
                <dd className="text-ink-2">{plan.llmTrace.via.join(", then ") || "Direct"}</dd>
              </dl>
              <p className="flex items-start gap-1.5">
                {plan.llmTrace.valid ? (
                  <Check aria-hidden size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-green" />
                ) : (
                  <X aria-hidden size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-red" />
                )}
                <span>
                  <span className="sr-only">{plan.llmTrace.valid ? "Valid: " : "Invalid: "}</span>
                  Sea-lane router: {plan.llmTrace.validation}
                  {!plan.llmTrace.valid && " (falling back to the router's safest route)"}
                </span>
              </p>
            </div>
          </Disclosure>
        )}

        <Disclosure title="Cost assumptions">
          <ul className="list-disc space-y-1 pl-4 text-caption text-ink-2 marker:text-ink-3">
            <li>Voyage cost = days at {s.speedKnots} kn × vessel cost per day (charter + fuel).</li>
            <li>War-risk premium = 1% × exposure to conflict zones × (hull {usd(s.hullValueUsd)} + cargo), charged when exposure ≥ 25%.</li>
            <li>Chance of a disruption = 25% × (risk index ÷ 100)², so a risk of 100 means a 1-in-4 chance and 50 means about 6%.</li>
            <li>Disruption cost = 15% of cargo value (25% if critical) + 10 days of vessel cost; expected disruption = chance × cost.</li>
            <li>Risk index = 100 × (1 − Π(1 − 0.95 × exposure)) over avoidable hazards; exposure = hazard score × proximity, discounted for storms more than 5 days ahead.</li>
            <li>Hazards that contain the origin or destination port are shown but not scored, since every route is exposed to them.</li>
          </ul>
        </Disclosure>
      </div>
    </div>
  );
}

/** Gemini's one-sentence headline, clamped to three lines with a More toggle when it runs longer. */
function Headline({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, text]);
  if (!text?.trim()) return null;
  return (
    <div className="mt-1.5">
      <p ref={ref} className={`text-body text-ink-2 ${expanded ? "" : "line-clamp-3"}`}>
        {text}
      </p>
      {(overflows || expanded) && (
        <button type="button" className="btn-plain -ml-2 h-7 text-callout" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

type RowProps = {
  r: PlannedRoute;
  label: string;
  base: PlannedRoute;
  selectedId: PlannedRoute["id"];
  confidence?: number;
  recommended: boolean;
  backup: boolean;
  onClick: () => void;
};

function RouteRow({ r, label, base, selectedId, confidence, recommended, backup, onClick }: RowProps) {
  const m = r.metrics;
  const b = base.metrics;
  const isOriginal = r.id === "original";
  const active = r.id === selectedId;
  const dd = m.days - b.days;
  const dc = m.totalExpectedUsd - b.totalExpectedUsd;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 px-3 py-2.5 text-left transition-colors duration-150 ${active ? "bg-fill-2" : "hover:bg-fill-3"}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: routeColor(r.id, selectedId) }} />
        <span className="min-w-0 text-body font-medium text-ink">{label}</span>
        {recommended && <Capsule tone="accent">Recommended</Capsule>}
        {backup && <Capsule>Backup</Capsule>}
      </span>
      <span className="flex items-baseline justify-end gap-1.5">
        <span className="text-caption text-ink-3">{riskLabel(m.riskScore)}</span>
        <span className="num text-headline font-semibold" style={{ color: riskColor(m.riskScore) }}>
          {m.riskScore}
        </span>
      </span>
      <span className="num mt-1 block pl-[18px] text-caption text-ink-2">
        {m.days} d{!isOriginal && Math.abs(dd) >= 0.05 && <span className="text-ink-3"> ({signed(dd)})</span>}
        <span className="text-ink-4"> · </span>
        {m.km.toLocaleString()} km
        <span className="text-ink-4"> · </span>
        {usd(m.totalExpectedUsd)} expected
        {isOriginal ? (
          m.warRiskPremiumUsd > 0 && (
            <>
              <span className="text-ink-4"> · </span>war-risk {usd(m.warRiskPremiumUsd)}
            </>
          )
        ) : (
          <>
            <span className="text-ink-4"> · </span>
            <span className={dc < 0 ? "text-green" : "text-orange"}>{dc < 0 ? `saves ${usd(-dc)}` : `+${usd(dc)}`}</span>
          </>
        )}
      </span>
      <span className="num mt-1 block text-right text-caption text-ink-3" title="Exposure-weighted confidence of the hazards on this route">
        {confidence !== undefined && `${confidence}% conf.`}
      </span>
      {m.chokepoints.length > 0 && <span className="col-span-2 mt-0.5 block pl-[18px] text-caption text-ink-3">Via {m.chokepoints.join(", ")}</span>}
    </button>
  );
}
