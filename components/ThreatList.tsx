"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { CATEGORY_LABEL, type Hazard } from "@/lib/types";
import { ago } from "@/lib/format";
import { HAZARD_COLORS, SYS, confColor, riskColor } from "./colors";

type Props = {
  hazards: Hazard[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  loading: boolean;
  aiNote?: string;
  routeFilter?: { on: boolean; onChange: (v: boolean) => void };
};

const ICON = { size: 14, strokeWidth: 1.75 } as const;

export default function ThreatList({ hazards, selectedId, onSelect, loading, aiNote, routeFilter }: Props) {
  const reduce = useReducedMotion();
  const rows = useRef(new Map<string, HTMLLIElement>());
  // the id this list selected itself; any other selection came from the globe and is scrolled into view
  const localPick = useRef<string | null>(null);
  const pendingScroll = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    if (localPick.current === selectedId) {
      localPick.current = null;
      return;
    }
    const el = rows.current.get(selectedId);
    if (!el) return;
    pendingScroll.current = selectedId;
    el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [selectedId, reduce]);

  const toggle = (id: string) => {
    const next = selectedId === id ? null : id;
    localPick.current = next;
    onSelect(next);
  };

  const settle = (id: string) => {
    // once the expanded row has finished opening, bring all of it into view (globe-originated selections only)
    if (pendingScroll.current !== id) return;
    pendingScroll.current = null;
    rows.current.get(id)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  };

  const showSkeleton = loading && hazards.length === 0;
  const count = hazards.length;

  return (
    <div className="space-y-2">
      <div className="flex min-h-8 items-center gap-2 px-1">
        <p className="flex-1 text-caption text-ink-3" aria-live="polite">
          {showSkeleton ? (
            "Loading hazards…"
          ) : (
            <>
              <span className="num">{count}</span> {count === 1 ? "hazard" : "hazards"}, ranked
              {loading && <span> · updating…</span>}
            </>
          )}
        </p>
        {routeFilter && (
          <div className="segmented" role="group" aria-label="Which hazards to show">
            <button type="button" aria-pressed={!routeFilter.on} onClick={() => routeFilter.onChange(false)}>
              All
            </button>
            <button type="button" aria-pressed={routeFilter.on} onClick={() => routeFilter.onChange(true)}>
              On route
            </button>
          </div>
        )}
      </div>

      {aiNote && <p className="px-1 text-caption text-ink-3">{aiNote}</p>}

      {showSkeleton ? (
        <ul className="group-inset" aria-hidden>
          {[0.9, 0.7, 0.8, 0.6, 0.75].map((w, i) => (
            <li key={i} className="flex items-center gap-2.5 px-3 py-2.5">
              <span className="h-3 w-4 rounded-xs bg-fill-3" />
              <span className="h-6 w-7 rounded-sm bg-fill-2" />
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="h-3 rounded-xs bg-fill-2 motion-safe:animate-pulse" style={{ width: `${w * 100}%` }} />
                <span className="h-2.5 rounded-xs bg-fill-3" style={{ width: `${w * 60}%` }} />
              </span>
            </li>
          ))}
        </ul>
      ) : count === 0 ? (
        <p className="group-inset px-3 py-4 text-center text-callout text-ink-2">{routeFilter?.on ? "No active hazards on this route." : "No active hazards."}</p>
      ) : (
        <ul className="group-inset">
          {hazards.map((h, i) => {
            const open = selectedId === h.id;
            return (
              <li
                key={h.id}
                ref={(el) => {
                  if (el) rows.current.set(h.id, el);
                  else rows.current.delete(h.id);
                }}
                className={`scroll-my-3 transition-colors duration-200 ease-out ${open ? "bg-fill-2" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => toggle(h.id)}
                  aria-expanded={open}
                  aria-controls={`hz-${h.id}`}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)] ${open ? "" : "hover:bg-fill-3"}`}
                >
                  <span className="num w-4 shrink-0 text-right text-caption text-ink-3">{i + 1}</span>
                  <RiskBadge score={h.score} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-callout font-medium text-ink">{h.title}</span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: HAZARD_COLORS[h.category] ?? SYS.gray }} aria-hidden />
                      <span className="shrink-0 text-ink-2">{CATEGORY_LABEL[h.category]}</span>
                      {h.confidenceScore !== undefined && (
                        <span className="num shrink-0" style={{ color: confColor(h.confidenceScore) }}>
                          · {h.confidenceScore}% confidence
                        </span>
                      )}
                      {h.sources.length > 0 && <span className="min-w-0 truncate text-ink-3">· {h.sources.join(", ")}</span>}
                    </span>
                  </span>
                  <ChevronDown
                    {...ICON}
                    aria-hidden
                    className={`shrink-0 text-ink-3 transition-transform duration-300 ease-sheet ${open ? "rotate-180" : ""}`}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      id={`hz-${h.id}`}
                      key="detail"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={
                        reduce
                          ? { height: { duration: 0 }, opacity: { duration: 0.15 } }
                          : { height: { type: "spring", bounce: 0, duration: 0.35 }, opacity: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }
                      }
                      onAnimationComplete={() => settle(h.id)}
                      className="overflow-hidden"
                    >
                      <HazardDetail h={h} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RiskBadge({ score }: { score: number }) {
  const c = riskColor(score);
  return (
    <span className="flex w-7 shrink-0 flex-col items-start gap-1" aria-label={`Risk ${score} of 100`}>
      <span className="num text-callout font-semibold leading-none" style={{ color: c }}>
        {score}
      </span>
      <span className="h-0.5 w-full overflow-hidden rounded-full bg-fill-2" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, score))}%`, background: c }} />
      </span>
    </span>
  );
}

function HazardDetail({ h }: { h: Hazard }) {
  return (
    <div className="space-y-2.5 pb-3 pl-9.5 pr-3 text-caption">
      {h.rationale && <p className="text-callout text-ink-2">{h.rationale}</p>}

      {h.confidenceReason && (
        <p style={{ color: confColor(h.confidenceScore) }}>
          <span className="num">{h.confidenceScore !== undefined ? `${h.confidenceScore}% confidence. ` : ""}</span>
          {h.confidenceReason}
        </p>
      )}

      {h.model && (
        <p className="text-ink-2">
          <span className="font-semibold text-ink">Trained model ({h.model.chokepoint}):</span>{" "}
          <span className="num">
            {h.model.observedDrop
              ? `traffic is already down to ${Math.round((h.model.ratio7 ?? 0) * 100)}% of normal.`
              : `${((h.model.probability ?? 0) * 100).toFixed(1)}% chance of a sustained traffic collapse within ${h.model.horizonDays} days`}
            {h.model.forecast && ` · next-7-day traffic ≈ ${Math.round(h.model.forecast.q50 * 100)}% of normal (80% range ${Math.round(h.model.forecast.q10 * 100)}–${Math.round(h.model.forecast.q90 * 100)}%)`}
            {h.model.newsSurge !== null && h.model.newsSurge >= 2 && ` · headline volume ${h.model.newsSurge.toFixed(1)}× normal`}
          </span>
        </p>
      )}

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-ink-3">
        <div className="flex gap-1">
          <dt>Signals</dt>
          <dd className="num text-ink-2">{h.signalScore}</dd>
        </div>
        {h.aiScore !== undefined && (
          <div className="flex gap-1">
            <dt>Gemini</dt>
            <dd className="num text-ink-2">{h.aiScore}</dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt>Radius</dt>
          <dd className="num text-ink-2">{h.radiusKm.toLocaleString()} km</dd>
        </div>
        {h.updated && (
          <div className="flex gap-1">
            <dt>Updated</dt>
            <dd className="text-ink-2">{ago(h.updated)}</dd>
          </div>
        )}
      </dl>

      {h.evidence.length > 0 && (
        <ul className="space-y-2 border-t border-hairline pt-2.5">
          {h.evidence.map((e, i) => (
            <li key={i} className="leading-snug">
              {e.url ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(ev) => ev.stopPropagation()}
                  className="rounded-xs text-ink decoration-ink-3 underline-offset-2 hover:underline"
                >
                  {e.text}
                </a>
              ) : (
                <span className="text-ink">{e.text}</span>
              )}
              <span className="mt-0.5 block text-ink-3">
                {e.source}
                {e.time ? ` · ${ago(e.time)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
