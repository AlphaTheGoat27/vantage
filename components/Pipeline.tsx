"use client";

import type { PipelineStep, PipelineStepId } from "@/lib/types";
import { HAZARD_COLORS } from "./colors";

const usd = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}k`);
const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(d)}%`);
const confColor = (c?: number) => (c === undefined ? "#94a3b8" : c >= 70 ? "#22e39b" : c >= 45 ? "#facc15" : "#ff9f1a");

const STEPS: { id: PipelineStepId; label: string; blurb: string }[] = [
  { id: "detect", label: "Detect", blurb: "what is happening near the route, and from which sources" },
  { id: "predict", label: "Predict", blurb: "trained model: chance of a disruption in the next 14 days" },
  { id: "categorize", label: "Categorize", blurb: "what kind of problem each one is" },
  { id: "prioritize", label: "Prioritize", blurb: "which to deal with first: urgency, cost, risk x confidence" },
  { id: "decide", label: "Decide & replan", blurb: "proceed, checkpoint or reroute, and why the new route is better" },
  { id: "explain", label: "Explain", blurb: "plain English for the decision maker" },
];

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
}: {
  steps: PipelineStep[];
  progress: { step: PipelineStepId; message: string } | null;
  running: boolean;
  onSelectHazard: (id: string) => void;
}) {
  const get = <S extends PipelineStepId>(id: S) => steps.find((s) => s.step === id) as Of<S> | undefined;
  const firstPending = STEPS.find((s) => !get(s.id))?.id;

  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300">Reasoning pipeline</h3>
      {STEPS.map((st, i) => {
        const done = get(st.id);
        const active = running && !done && (progress?.step === st.id || firstPending === st.id);
        return (
          <details key={st.id} open={Boolean(done) && (st.id === "decide" || st.id === "explain" || st.id === "prioritize")} className="rounded-lg border border-white/5 bg-white/[0.03]">
            <summary className="flex cursor-pointer list-none items-start gap-2 p-2">
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[10px] ${done ? "bg-emerald-500/20 text-emerald-300" : active ? "animate-pulse bg-cyan-500/20 text-cyan-300" : "bg-white/5 text-slate-600"}`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`font-medium ${done || active ? "text-slate-100" : "text-slate-500"}`}>{st.label}</span>
                <span className="ml-2 text-[10px] text-slate-500">{st.blurb}</span>
                <span className="mt-0.5 block text-slate-300">{done ? done.summary : active ? (progress?.step === st.id ? progress.message : "working…") : ""}</span>
              </span>
            </summary>
            {done && (
              <div className="space-y-1.5 border-t border-white/5 p-2 text-[11px]">
                {st.id === "detect" && <Detect s={done as Of<"detect">} onSelectHazard={onSelectHazard} />}
                {st.id === "predict" && <Predict s={done as Of<"predict">} />}
                {st.id === "categorize" && <Categorize s={done as Of<"categorize">} onSelectHazard={onSelectHazard} />}
                {st.id === "prioritize" && <Prioritize s={done as Of<"prioritize">} onSelectHazard={onSelectHazard} />}
                {st.id === "decide" && <Decide s={done as Of<"decide">} />}
                {st.id === "explain" && <Explain s={done as Of<"explain">} />}
              </div>
            )}
          </details>
        );
      })}
    </section>
  );
}

function Detect({ s, onSelectHazard }: { s: Of<"detect">; onSelectHazard: (id: string) => void }) {
  return (
    <>
      <p className="text-slate-500">
        Sources this run: <span className="text-emerald-300">{s.sourcesLive} live</span>
        {s.sourcesFallback > 0 && <span className="text-amber-300"> · {s.sourcesFallback} on bundled snapshot</span>}
        {s.sourcesDown > 0 && <span className="text-rose-300"> · {s.sourcesDown} down</span>}
      </p>
      {s.items.map((d) => (
        <div key={d.hazardId} className="cursor-pointer rounded border border-white/5 p-1.5 hover:bg-white/[0.04]" onClick={() => onSelectHazard(d.hazardId)}>
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-100">{d.title}</span>
            <span className="rounded px-1 text-[10px]" style={{ background: `${HAZARD_COLORS[d.category]}22`, color: HAZARD_COLORS[d.category] }}>risk {d.score}</span>
            {d.confidenceScore !== undefined && (
              <span className="rounded px-1 text-[10px]" style={{ background: `${confColor(d.confidenceScore)}22`, color: confColor(d.confidenceScore) }} title={d.confidenceReason}>
                confidence {d.confidenceScore}%
              </span>
            )}
            <span className="ml-auto font-mono text-slate-500">day {d.etaDays}</span>
          </div>
          {d.confidenceReason && <p className="mt-0.5 text-slate-500">{d.confidenceReason}</p>}
          {d.observations.map((o, i) => (
            <p key={i} className="mt-0.5 text-slate-400">• {o}</p>
          ))}
        </div>
      ))}
      {s.items.length === 0 && <p className="text-slate-500">Nothing within reach of this route.</p>}
    </>
  );
}

function Predict({ s }: { s: Of<"predict"> }) {
  return (
    <>
      <p className="text-slate-500">
        Logistic model trained on IMF PortWatch transits + news-surge features through {s.trainedThrough}, calibrated, with persistence and hysteresis. It predicts a sustained
        (7-day) traffic collapse of 30%+ within {s.horizonDays} days. Forecast = next-7-day traffic vs normal with an 80% interval.
      </p>
      {s.items.map((p) => (
        <div key={p.chokepoint} className="rounded border border-white/5 p-1.5">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-100">{p.chokepoint}</span>
            {p.alertKind === "observed" && <span className="rounded bg-rose-500/20 px-1 text-[10px] text-rose-300">DISRUPTED NOW</span>}
            {p.alertKind === "predicted" && <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">ALERT</span>}
            {p.alertKind === "none" && <span className="rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-300">no alert</span>}
            <span className="ml-auto font-mono text-slate-400">traffic {pct(p.ratio7)} of normal</span>
          </div>
          {p.probability !== null && (
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/10">
                <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, p.probability * 100 * 2)}%` }} />
              </div>
              <span className="font-mono text-slate-300">{pct(p.probability, 1)} chance in {s.horizonDays} d</span>
            </div>
          )}
          {p.forecast && (
            <p className="mt-0.5 text-slate-400">
              Next 7 days: about {pct(p.forecast.q50)} of normal (80% range {pct(p.forecast.q10)} to {pct(p.forecast.q90)}).
              {p.newsSurge !== null && ` Headline volume ${p.newsSurge.toFixed(1)}x its 8-week norm.`}
            </p>
          )}
          {p.drivers.length > 0 && (
            <p className="mt-0.5 text-slate-500">
              Main drivers:{" "}
              {p.drivers.slice(0, 3).map((d, i) => (
                <span key={d.feature}>
                  {i > 0 && ", "}
                  <span className={d.contribution > 0 ? "text-amber-300" : "text-emerald-300"}>{d.contribution > 0 ? "raises" : "lowers"} risk</span>: {FEATURE_LABEL[d.feature] ?? d.feature}
                </span>
              ))}
            </p>
          )}
        </div>
      ))}
    </>
  );
}

function Categorize({ s, onSelectHazard }: { s: Of<"categorize">; onSelectHazard: (id: string) => void }) {
  return (
    <>
      {s.groups.map((g) => (
        <div key={g.category}>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${HAZARD_COLORS[g.category]}22`, color: HAZARD_COLORS[g.category] }}>
            {g.label}
          </span>
          {g.hazards.map((h) => (
            <div key={h.hazardId} className="mt-1 cursor-pointer pl-2 hover:text-white" onClick={() => onSelectHazard(h.hazardId)}>
              <span className="text-slate-200">{h.title}</span>
              {h.evidence.map((e, i) => (
                <p key={i} className="text-slate-500">{e}</p>
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function Prioritize({ s, onSelectHazard }: { s: Of<"prioritize">; onSelectHazard: (id: string) => void }) {
  return (
    <>
      <p className="rounded bg-white/5 p-1.5 font-mono text-[10px] leading-snug text-slate-300">{s.formula}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[10px]">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-1">#</th>
              <th className="pr-1">Hazard</th>
              <th className="pr-1">Reached</th>
              <th className="pr-1">Risk × conf.</th>
              <th className="pr-1">Cost added</th>
              <th className="pr-1">Priority</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.hazardId} className="cursor-pointer border-t border-white/5 hover:bg-white/[0.04]" onClick={() => onSelectHazard(r.hazardId)}>
                <td className="py-1 pr-1 font-mono text-slate-500">{r.rank}</td>
                <td className="pr-1 text-slate-200">
                  {r.title}
                  {r.unavoidable && <span className="ml-1 text-slate-500">(unavoidable)</span>}
                </td>
                <td className="pr-1 font-mono">day {r.etaDays}</td>
                <td className="pr-1 font-mono">{r.riskScore} × {r.confidence}% = {(r.riskTimesConfidence * 100).toFixed(0)}</td>
                <td className="pr-1 font-mono">{usd(r.impactUsd)}</td>
                <td className="pr-1 font-mono font-bold text-cyan-300">{r.priority}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.rows.length === 0 && <p className="text-slate-500">Nothing to rank.</p>}
    </>
  );
}

function Decide({ s }: { s: Of<"decide"> }) {
  const j = s.justification;
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px] sm:grid-cols-4">
        <Stat label="Risk" value={`${j.riskBefore} → ${j.riskAfter}`} good={j.riskAfter < j.riskBefore} />
        <Stat label="Extra days" value={`${j.extraDays >= 0 ? "+" : ""}${j.extraDays}`} good={j.extraDays <= 0} />
        <Stat label="Extra voyage cost" value={`${j.extraVoyageCostUsd >= 0 ? "+" : ""}${usd(j.extraVoyageCostUsd)}`} good={j.extraVoyageCostUsd <= 0} />
        <Stat label="Expected total" value={`${j.netSavingUsd >= 0 ? "saves " : "adds "}${usd(Math.abs(j.netSavingUsd))}`} good={j.netSavingUsd >= 0} />
      </div>
      {j.avoids.length > 0 && (
        <p className="text-slate-300">
          <b className="text-slate-100">What it avoids:</b> {j.avoids.map((a) => `${a.title} (exposure ${(a.exposureBefore * 100).toFixed(0)}% → ${(a.exposureAfter * 100).toFixed(0)}%)`).join("; ")}.
        </p>
      )}
      {s.rationale && <p className="text-slate-400"><b className="text-slate-200">Replanner:</b> {s.rationale}</p>}
      {s.validation && <p className={s.validation.startsWith("valid") ? "text-emerald-300" : "text-rose-300"}>Router check: {s.validation}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[10px]">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-1">Option</th>
              <th className="pr-1">Days</th>
              <th className="pr-1">Risk</th>
              <th className="pr-1">Expected cost</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {j.alternatives.map((a) => (
              <tr key={a.id} className={`border-t border-white/5 ${a.verdict === "Recommended" ? "bg-emerald-500/10" : ""}`}>
                <td className="py-1 pr-1 text-slate-200">{a.label}</td>
                <td className="pr-1 font-mono">{a.days}</td>
                <td className="pr-1 font-mono">{a.riskScore}</td>
                <td className="pr-1 font-mono">{usd(a.totalExpectedUsd)}</td>
                <td className="text-slate-400">{a.verdict}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {j.checkpointVerdict && (
        <p className="text-amber-200/90"><b>Checkpoint option:</b> {j.checkpointVerdict}</p>
      )}
    </>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded bg-white/5 p-1.5">
      <div className="text-[9px] uppercase text-slate-500">{label}</div>
      <div className={good ? "text-emerald-300" : "text-amber-300"}>{value}</div>
    </div>
  );
}

function Explain({ s }: { s: Of<"explain"> }) {
  const e = s.explanation;
  return (
    <div className="space-y-1.5 leading-relaxed text-slate-300">
      <p><b className="text-slate-100">Why the original route is risky (or safe).</b> {e.whyOriginal}</p>
      <p><b className="text-slate-100">Why a backup.</b> {e.whyBackup}</p>
      <p><b className="text-slate-100">How the backup averts the risk.</b> {e.howBackupAverts}</p>
      <p><b className="text-slate-100">Trade-offs.</b> {e.tradeoffs}</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {e.actions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  );
}
