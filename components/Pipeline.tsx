"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Circle, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import type { PipelineStep, PipelineStepId } from "@/lib/types";
import { usd } from "@/lib/format";
import { HAZARD_COLORS, SYS, confColor, riskColor } from "./colors";

const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(d)}%`);
const ICON = { size: 16, strokeWidth: 1.75 } as const;

const STEPS: { id: PipelineStepId; label: string; blurb: string }[] = [
  { id: "detect", label: "Detect", blurb: "What is happening near the route, and from which sources." },
  { id: "predict", label: "Predict", blurb: "Trained model: chance of a disruption in the next 14 days." },
  { id: "categorize", label: "Categorize", blurb: "What kind of problem each one is." },
  { id: "prioritize", label: "Prioritize", blurb: "Which to deal with first: urgency, cost, risk x confidence." },
  { id: "decide", label: "Decide & replan", blurb: "Proceed, checkpoint or reroute, and why the new route is better." },
  { id: "explain", label: "Explain", blurb: "Plain English for the decision maker." },
];

// steps whose details open by default once they finish
const OPEN_BY_DEFAULT = new Set<PipelineStepId>(["prioritize", "decide", "explain"]);

const FEATURE_LABEL: Record<string, string> = {
  r7: "traffic over the last 7 days vs normal", r14: "traffic over the last 14 days vs normal", slope14: "14-day traffic trend", accel: "recent change in traffic",
  rz7: "size of the drop (robust z-score)", drawdown60: "drop from the 60-day peak", vol28: "traffic volatility", global_r7: "traffic at all other chokepoints",
  global_frac_low: "share of other chokepoints depressed", peer_r7: "neighbouring chokepoints", cape_r7: "Cape of Good Hope diversion traffic",
  news_log: "volume of maritime headlines", news_surge: "headline surge vs 8-week norm", tanker_share_chg: "tanker share shift",
};

type Of<S extends PipelineStepId> = Extract<PipelineStep, { step: S }>;

export default function PipelinePanel({
  steps,
  progress,
  running,
  onSelectHazard,
  hideTitle = false,
}: {
  steps: PipelineStep[];
  progress: { step: PipelineStepId; message: string } | null;
  running: boolean;
  onSelectHazard: (id: string) => void;
  /** set when a parent (e.g. a disclosure) already shows the title */
  hideTitle?: boolean;
}) {
  const reduce = useReducedMotion();
  const [openState, setOpenState] = useState<Partial<Record<PipelineStepId, boolean>>>({});
  const get = <S extends PipelineStepId>(id: S) => steps.find((s) => s.step === id) as Of<S> | undefined;
  const firstPending = STEPS.find((s) => !get(s.id))?.id;

  return (
    <section className="space-y-1.5" aria-label="Reasoning pipeline" aria-busy={running}>
      {!hideTitle && <h3 className="px-1 text-caption font-medium text-ink-3">Reasoning pipeline</h3>}
      <ol className="group-inset">
        {STEPS.map((st) => {
          const done = get(st.id);
          const active = running && !done && (progress?.step === st.id || firstPending === st.id);
          const open = Boolean(done) && (openState[st.id] ?? OPEN_BY_DEFAULT.has(st.id));
          const line = done ? done.summary : active ? (progress?.step === st.id ? progress.message : "Working…") : st.blurb;
          const head = (
            <>
              <span className="mt-px shrink-0" aria-hidden>
                {done ? (
                  <CircleCheck {...ICON} style={{ color: SYS.green }} />
                ) : active ? (
                  <LoaderCircle {...ICON} className="text-accent motion-safe:animate-spin" />
                ) : (
                  <Circle {...ICON} className="text-ink-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-callout font-semibold ${done || active ? "text-ink" : "text-ink-3"}`}>{st.label}</span>
                <span className={`mt-0.5 block text-caption ${done || active ? "text-ink-2" : "text-ink-3"}`}>{line}</span>
              </span>
              <span className="sr-only">{done ? "(done)" : active ? "(running)" : "(pending)"}</span>
            </>
          );
          return (
            <li key={st.id}>
              {done ? (
                <button
                  type="button"
                  onClick={() => setOpenState((s) => ({ ...s, [st.id]: !open }))}
                  aria-expanded={open}
                  aria-controls={`pl-${st.id}`}
                  className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-fill-3 focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)]"
                >
                  {head}
                  <ChevronDown size={14} strokeWidth={1.75} aria-hidden className={`mt-0.5 shrink-0 text-ink-3 transition-transform duration-300 ease-sheet ${open ? "rotate-180" : ""}`} />
                </button>
              ) : (
                <div className="flex items-start gap-2.5 px-3 py-2.5" aria-live={active ? "polite" : undefined}>
                  {head}
                </div>
              )}
              <AnimatePresence initial={false}>
                {done && open && (
                  <motion.div
                    id={`pl-${st.id}`}
                    key="body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={
                      reduce
                        ? { height: { duration: 0 }, opacity: { duration: 0.15 } }
                        : { height: { type: "spring", bounce: 0, duration: 0.35 }, opacity: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }
                    }
                    className="overflow-hidden"
                  >
                    <div className="space-y-2.5 pb-3 pl-9.5 pr-3 text-caption text-ink-2">
                      {st.id === "detect" && <Detect s={done as Of<"detect">} onSelectHazard={onSelectHazard} />}
                      {st.id === "predict" && <Predict s={done as Of<"predict">} />}
                      {st.id === "categorize" && <Categorize s={done as Of<"categorize">} onSelectHazard={onSelectHazard} />}
                      {st.id === "prioritize" && <Prioritize s={done as Of<"prioritize">} onSelectHazard={onSelectHazard} />}
                      {st.id === "decide" && <Decide s={done as Of<"decide">} />}
                      {st.id === "explain" && <Explain s={done as Of<"explain">} />}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------- shared bits ---------- */

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />;
}

/** A hazard name that selects the hazard on the globe. */
function HazardButton({ id, title, onSelectHazard }: { id: string; title: string; onSelectHazard: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelectHazard(id);
      }}
      className="rounded-xs text-left font-medium text-ink decoration-ink-3 underline-offset-2 hover:underline"
      title="Show on the globe"
    >
      {title}
    </button>
  );
}

/** Clickable list item: the whole row selects the hazard for pointer users, the title button serves the keyboard. */
function HazardItem({ id, onSelectHazard, children }: { id: string; onSelectHazard: (id: string) => void; children: ReactNode }) {
  return (
    <li className="-mx-1.5 cursor-pointer rounded-md px-1.5 py-2 hover:bg-fill-3" onClick={() => onSelectHazard(id)}>
      {children}
    </li>
  );
}

const TH = "px-1.5 pb-1.5 align-bottom font-normal text-ink-3";
const TDN = "num whitespace-nowrap px-1.5 py-1.5 text-right align-top";

function Table({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="-mx-1.5 overflow-x-auto rounded-sm focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)]" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full border-collapse text-caption">{children}</table>
    </div>
  );
}

/* ---------- stages ---------- */

function Detect({ s, onSelectHazard }: { s: Of<"detect">; onSelectHazard: (id: string) => void }) {
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-3">
        <span>Sources this run:</span>
        <span className="inline-flex items-center gap-1.5">
          <Dot color={SYS.green} />
          <span className="num text-ink-2">{s.sourcesLive}</span> live
        </span>
        {s.sourcesFallback > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Dot color={SYS.yellow} />
            <span className="num text-ink-2">{s.sourcesFallback}</span> on bundled snapshot
          </span>
        )}
        {s.sourcesDown > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Dot color={SYS.red} />
            <span className="num text-ink-2">{s.sourcesDown}</span> down
          </span>
        )}
      </p>
      {s.items.length > 0 ? (
        <ul className="divide-y divide-hairline">
          {s.items.map((d) => (
            <HazardItem key={d.hazardId} id={d.hazardId} onSelectHazard={onSelectHazard}>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-callout">
                  <HazardButton id={d.hazardId} title={d.title} onSelectHazard={onSelectHazard} />
                </span>
                <span className="num shrink-0 text-ink-3">day {d.etaDays}</span>
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5">
                <Dot color={HAZARD_COLORS[d.category] ?? SYS.gray} />
                <span className="num" style={{ color: riskColor(d.score) }}>
                  Risk {d.score}
                </span>
                {d.confidenceScore !== undefined && (
                  <span className="num" style={{ color: confColor(d.confidenceScore) }}>
                    · {d.confidenceScore}% confidence
                  </span>
                )}
              </p>
              {d.confidenceReason && <p className="mt-0.5 text-ink-3">{d.confidenceReason}</p>}
              {d.observations.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 marker:text-ink-4">
                  {d.observations.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              )}
            </HazardItem>
          ))}
        </ul>
      ) : (
        <p className="text-ink-3">Nothing within reach of this route.</p>
      )}
    </>
  );
}

function Predict({ s }: { s: Of<"predict"> }) {
  return (
    <>
      <p className="text-ink-3">
        Logistic model trained on IMF PortWatch transits + news-surge features through {s.trainedThrough}, calibrated, with persistence and hysteresis. It predicts a sustained
        (7-day) traffic collapse of 30%+ within {s.horizonDays} days. Forecast = next-7-day traffic vs normal with an 80% interval.
      </p>
      <ul className="divide-y divide-hairline">
        {s.items.map((p) => {
          const status =
            p.alertKind === "observed" ? { text: "Disrupted now", color: SYS.red } : p.alertKind === "predicted" ? { text: "Alert", color: SYS.orange } : { text: "No alert", color: SYS.green };
          return (
            <li key={p.chokepoint} className="space-y-1 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-callout font-medium text-ink">{p.chokepoint}</span>
                <span className="inline-flex items-center gap-1.5 self-center" style={{ color: status.color }}>
                  <Dot color={status.color} />
                  {status.text}
                </span>
                <span className="num ml-auto shrink-0 text-ink-2">traffic {pct(p.ratio7)} of normal</span>
              </div>
              {p.probability !== null && (
                <div className="flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-fill-2" aria-hidden>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, p.probability * 100 * 2)}%`, background: SYS.orange }} />
                  </div>
                  <span className="num shrink-0 text-ink">
                    {pct(p.probability, 1)} chance in {s.horizonDays} d
                  </span>
                </div>
              )}
              {p.forecast && (
                <p className="num">
                  Next 7 days: about {pct(p.forecast.q50)} of normal (80% range {pct(p.forecast.q10)} to {pct(p.forecast.q90)}).
                  {p.newsSurge !== null && ` Headline volume ${p.newsSurge.toFixed(1)}x its 8-week norm.`}
                </p>
              )}
              {p.drivers.length > 0 && (
                <p className="text-ink-3">
                  Main drivers:{" "}
                  {p.drivers.slice(0, 3).map((d, i) => (
                    <span key={d.feature}>
                      {i > 0 && ", "}
                      <span style={{ color: d.contribution > 0 ? SYS.orange : SYS.green }}>{d.contribution > 0 ? "raises" : "lowers"} risk</span>: {FEATURE_LABEL[d.feature] ?? d.feature}
                    </span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Categorize({ s, onSelectHazard }: { s: Of<"categorize">; onSelectHazard: (id: string) => void }) {
  return (
    <div className="space-y-3">
      {s.groups.map((g) => (
        <div key={g.category}>
          <p className="flex items-center gap-1.5 text-callout font-semibold text-ink">
            <Dot color={HAZARD_COLORS[g.category] ?? SYS.gray} />
            {g.label}
            <span className="num font-normal text-ink-3">{g.hazards.length}</span>
          </p>
          <ul className="mt-0.5 pl-3">
            {g.hazards.map((h) => (
              <HazardItem key={h.hazardId} id={h.hazardId} onSelectHazard={onSelectHazard}>
                <HazardButton id={h.hazardId} title={h.title} onSelectHazard={onSelectHazard} />
                {h.evidence.map((e, i) => (
                  <p key={i} className="mt-0.5 text-ink-3">
                    {e}
                  </p>
                ))}
              </HazardItem>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Prioritize({ s, onSelectHazard }: { s: Of<"prioritize">; onSelectHazard: (id: string) => void }) {
  if (s.rows.length === 0)
    return (
      <>
        <p className="text-ink-3">{s.formula}</p>
        <p className="text-ink-3">Nothing to rank.</p>
      </>
    );
  return (
    <>
      <p className="text-ink-3">{s.formula}</p>
      <Table label="Priority ranking">
        <thead>
          <tr>
            <th scope="col" className={`${TH} text-right`}>
              #
            </th>
            <th scope="col" className={`${TH} text-left`}>
              Hazard
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Reached
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Risk × conf.
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Cost added
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Priority
            </th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.hazardId} className="cursor-pointer border-t border-hairline hover:bg-fill-3" onClick={() => onSelectHazard(r.hazardId)}>
              <td className={`${TDN} text-ink-3`}>{r.rank}</td>
              <td className="min-w-28 px-1.5 py-1.5 align-top">
                <HazardButton id={r.hazardId} title={r.title} onSelectHazard={onSelectHazard} />
                {r.unavoidable && <span className="block text-ink-3">unavoidable</span>}
              </td>
              <td className={TDN}>day {r.etaDays}</td>
              <td className={TDN}>
                {r.riskScore} × {r.confidence}% = {(r.riskTimesConfidence * 100).toFixed(0)}
              </td>
              <td className={TDN}>{usd(r.impactUsd)}</td>
              <td className={`${TDN} font-semibold text-link`}>{r.priority}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function Decide({ s }: { s: Of<"decide"> }) {
  const j = s.justification;
  const valid = s.validation?.startsWith("valid");
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Stat label="Risk" value={`${j.riskBefore} → ${j.riskAfter}`} good={j.riskAfter < j.riskBefore} />
        <Stat label="Extra days" value={`${j.extraDays >= 0 ? "+" : ""}${j.extraDays}`} good={j.extraDays <= 0} />
        <Stat label="Extra voyage cost" value={`${j.extraVoyageCostUsd >= 0 ? "+" : ""}${usd(j.extraVoyageCostUsd)}`} good={j.extraVoyageCostUsd <= 0} />
        <Stat label="Expected total" value={`${j.netSavingUsd >= 0 ? "saves " : "adds "}${usd(Math.abs(j.netSavingUsd))}`} good={j.netSavingUsd >= 0} />
      </dl>
      {j.avoids.length > 0 && (
        <p>
          <span className="font-semibold text-ink">What it avoids.</span>{" "}
          <span className="num">{j.avoids.map((a) => `${a.title} (exposure ${(a.exposureBefore * 100).toFixed(0)}% → ${(a.exposureAfter * 100).toFixed(0)}%)`).join("; ")}.</span>
        </p>
      )}
      {s.rationale && (
        <p>
          <span className="font-semibold text-ink">Replanner.</span> {s.rationale}
        </p>
      )}
      {s.validation && (
        <p className="flex items-start gap-1.5" style={{ color: valid ? SYS.green : SYS.red }}>
          {valid ? <CircleCheck size={14} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden /> : <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />}
          <span>Router check: {s.validation}</span>
        </p>
      )}
      <Table label="Route options">
        <thead>
          <tr>
            <th scope="col" className={`${TH} text-left`}>
              Option
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Days
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Risk
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Expected cost
            </th>
            <th scope="col" className={`${TH} text-left`}>
              Verdict
            </th>
          </tr>
        </thead>
        <tbody>
          {j.alternatives.map((a) => {
            const rec = a.verdict === "Recommended";
            return (
              <tr key={a.id} className={`border-t border-hairline ${rec ? "font-medium text-link" : ""}`}>
                <th scope="row" className={`px-1.5 py-1.5 text-left align-top ${rec ? "font-medium" : "font-normal text-ink"}`}>
                  {a.label}
                </th>
                <td className={TDN}>{a.days}</td>
                <td className={TDN} style={rec ? undefined : { color: riskColor(a.riskScore) }}>
                  {a.riskScore}
                </td>
                <td className={TDN}>{usd(a.totalExpectedUsd)}</td>
                <td className={`px-1.5 py-1.5 align-top ${rec ? "" : "text-ink-3"}`}>{a.verdict}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {j.checkpointVerdict && (
        <p>
          <span className="font-semibold" style={{ color: SYS.yellow }}>
            Checkpoint option.
          </span>{" "}
          {j.checkpointVerdict}
        </p>
      )}
    </>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className="num text-callout font-semibold" style={{ color: good ? SYS.green : SYS.orange }}>
        {value}
      </dd>
    </div>
  );
}

function Explain({ s }: { s: Of<"explain"> }) {
  const e = s.explanation;
  return (
    <div className="space-y-2 text-callout">
      <p>
        <span className="font-semibold text-ink">Why the original route is risky (or safe).</span> {e.whyOriginal}
      </p>
      <p>
        <span className="font-semibold text-ink">Why a backup.</span> {e.whyBackup}
      </p>
      <p>
        <span className="font-semibold text-ink">How the backup averts the risk.</span> {e.howBackupAverts}
      </p>
      <p>
        <span className="font-semibold text-ink">Trade-offs.</span> {e.tradeoffs}
      </p>
      {e.actions.length > 0 && (
        <ul className="list-disc space-y-1 pl-4 marker:text-ink-3">
          {e.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
