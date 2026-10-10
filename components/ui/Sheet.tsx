"use client";

import { animate, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";

export type Detent = "peek" | "half" | "full";
const ORDER: Detent[] = ["peek", "half", "full"];

/** gap kept above the sheet at the full detent, so the map controls stay reachable */
const TOP_GAP = 64;
/** material drawn below the screen edge, so a bounce or rubber-band never shows a gap under the sheet */
const OVERDRAW = 240;
/** movement before a press becomes a drag (hysteresis) */
const SLOP = 8;

const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const useViewportHeight = () => useSyncExternalStore(subscribeResize, () => window.innerHeight, () => 800);

/** progressive resistance past a boundary */
const rubberband = (over: number, dim: number, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
/** where a flick would come to rest (UIScrollView-style deceleration) */
const project = (v: number, rate = 0.998) => ((v / 1000) * rate) / (1 - rate);

type Gesture = { startClient: number; startY: number; samples: { t: number; p: number }[] };

type Props = {
  detent: Detent;
  onDetentChange: (d: Detent) => void;
  /** always visible: grabber row is added above it */
  header: ReactNode;
  /** scrolls only at the full detent */
  children: ReactNode;
  /** visible height at the peek detent, px */
  peekHeight?: number;
  label: string;
};

/**
 * Bottom sheet with three detents. Dragged 1:1 with pointer events (rubber-band past the ends); on release the
 * momentum-projected position picks the detent and a spring carries the release velocity into it.
 */
export default function Sheet({ detent, onDetentChange, header, children, peekHeight = 128, label }: Props) {
  const vh = useViewportHeight();
  const reduce = useReducedMotion();
  const fullH = Math.max(peekHeight + 80, vh - TOP_GAP);
  const halfOffset = Math.min(fullH - peekHeight - 40, Math.max(0, fullH - Math.round(vh * 0.5)));
  const offsets: Record<Detent, number> = { full: 0, half: halfOffset, peek: fullH - peekHeight };

  const y = useMotionValue(offsets[detent]);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const target = useRef(Number.NaN);
  const rootRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x0: number; y0: number; g: Gesture | null } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);

  // latest values for the native listeners and gesture callbacks
  const live = useRef({ offsets, detent, fullH, onDetentChange });
  useEffect(() => {
    live.current = { offsets, detent, fullH, onDetentChange };
  });

  const animTo = useCallback(
    (to: number, velocity = 0) => {
      anim.current?.stop();
      target.current = to;
      if (reduce) {
        y.set(to);
        return;
      }
      // critically damped by default; a little bounce only when a flick carried momentum
      anim.current = animate(y, to, { type: "spring", bounce: Math.abs(velocity) > 700 ? 0.15 : 0, duration: 0.35, velocity });
    },
    [reduce, y],
  );

  // follow the controlled detent and viewport resizes
  const to = offsets[detent];
  useEffect(() => {
    if (dragging) return;
    if (Number.isNaN(target.current)) {
      target.current = to;
      y.set(to);
      return;
    }
    if (Math.abs(target.current - to) > 0.5) animTo(to);
  }, [to, dragging, animTo, y]);

  // content returns to the top when the sheet leaves the full detent
  useEffect(() => {
    if (detent !== "full" && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [detent]);

  const begin = useCallback(
    (clientY: number): Gesture => {
      anim.current?.stop();
      setDragging(true);
      return { startClient: clientY, startY: y.get(), samples: [{ t: performance.now(), p: clientY }] };
    },
    [y],
  );

  const track = useCallback(
    (g: Gesture, clientY: number) => {
      const { offsets: o, fullH: h } = live.current;
      const raw = g.startY + clientY - g.startClient;
      const max = o.peek;
      y.set(raw < 0 ? -rubberband(-raw, h) : raw > max ? max + rubberband(raw - max, h) : raw);
      const now = performance.now();
      g.samples.push({ t: now, p: clientY });
      while (g.samples.length > 2 && now - g.samples[0].t > 100) g.samples.shift();
    },
    [y],
  );

  const release = useCallback(
    (g: Gesture) => {
      const { offsets: o, detent: current, onDetentChange: change } = live.current;
      const now = performance.now();
      const recent = g.samples.filter((s) => now - s.t <= 100);
      let v = 0;
      if (recent.length >= 2) {
        const a = recent[0];
        const b = recent[recent.length - 1];
        const dt = (b.t - a.t) / 1000;
        if (dt > 0) v = (b.p - a.p) / dt;
      }
      const projected = y.get() + project(v);
      let best: Detent = "peek";
      for (const d of ORDER) if (Math.abs(o[d] - projected) < Math.abs(o[best] - projected)) best = d;
      animTo(o[best], v);
      setDragging(false);
      if (best !== current) change(best);
    },
    [animTo, y],
  );

  // ---- pointer path: header always, body when the sheet is not at the full detent
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, select, textarea")) return;
    if (detent === "full" && bodyRef.current?.contains(t)) return; // native scroll; the touch path handles pull-down
    pointer.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, g: null };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.g) {
      const dy = e.clientY - p.y0;
      const dx = e.clientX - p.x0;
      if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) {
        pointer.current = null;
        return;
      }
      if (Math.abs(dy) < SLOP) return;
      rootRef.current?.setPointerCapture(e.pointerId);
      p.g = begin(p.y0);
    }
    track(p.g, e.clientY);
  };
  const onPointerEnd = (e: PointerEvent<HTMLElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    pointer.current = null;
    if (!p.g) return;
    // the press became a drag: swallow the click it would otherwise fire
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    release(p.g);
  };
  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // ---- touch path: at the full detent, pulling down while the content is at its top drags the sheet
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    let tracking = false;
    let x0 = 0;
    let y0 = 0;
    let g: Gesture | null = null;
    const onStart = (e: TouchEvent) => {
      g = null;
      const t = e.touches[0];
      tracking = live.current.detent === "full" && e.touches.length === 1 && el.scrollTop <= 0 && !(e.target as HTMLElement).closest("input, select, textarea");
      if (t) {
        x0 = t.clientX;
        y0 = t.clientY;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - y0;
      const dx = t.clientX - x0;
      if (!g) {
        if (dy <= 0 || el.scrollTop > 0) {
          tracking = false; // scrolling the content: leave it native
          return;
        }
        if (e.cancelable) e.preventDefault();
        if (dy < SLOP) return;
        if (Math.abs(dx) > dy) {
          tracking = false;
          return;
        }
        g = begin(y0);
      }
      if (e.cancelable) e.preventDefault();
      track(g, t.clientY);
    };
    const onEnd = () => {
      if (g) release(g);
      g = null;
      tracking = false;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [begin, track, release]);

  // ---- keyboard: the grabber is a button (activate to step up, arrows to move)
  const i = ORDER.indexOf(detent);
  const onGrabberKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = e.key === "ArrowUp" ? Math.min(2, i + 1) : e.key === "ArrowDown" ? Math.max(0, i - 1) : -1;
    if (next < 0) return;
    e.preventDefault();
    onDetentChange(ORDER[next]);
  };

  const full = detent === "full";
  return (
    <motion.section
      ref={rootRef}
      aria-label={label}
      className="material fixed inset-x-0 z-20 flex flex-col rounded-t-2xl"
      style={{ y, bottom: -OVERDRAW, height: fullH + OVERDRAW, paddingBottom: OVERDRAW }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={onClickCapture}
    >
      <div className="shrink-0 px-4" style={{ touchAction: "none" }}>
        <button
          type="button"
          aria-label={full ? "Collapse panel" : "Expand panel"}
          onClick={() => onDetentChange(full ? "peek" : ORDER[i + 1])}
          onKeyDown={onGrabberKey}
          className="mx-auto flex h-5 w-16 items-center justify-center rounded-full"
        >
          <span aria-hidden className="h-[5px] w-9 rounded-full bg-fill" />
        </button>
        {header}
      </div>
      <div
        ref={bodyRef}
        className="min-h-0 flex-1 px-4"
        style={{
          overflowY: full && !dragging ? "auto" : "hidden",
          touchAction: full ? "pan-y" : "none",
          overscrollBehavior: "contain",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
        }}
      >
        {children}
      </div>
    </motion.section>
  );
}
