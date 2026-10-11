"use client";

import { motion, useReducedMotion } from "motion/react";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** accessible name when no <label htmlFor> points at the switch */
  label?: string;
  id?: string;
  disabled?: boolean;
  size?: "sm" | "md";
};

const SIZES = {
  sm: { w: 36, h: 22, knob: 18 },
  md: { w: 46, h: 28, knob: 24 },
} as const;

/** iOS-style on/off switch: a button with role="switch"; the thumb travels on a critically damped spring. */
export default function Switch({ checked, onChange, label, id, disabled, size = "md" }: Props) {
  const reduce = useReducedMotion();
  const s = SIZES[size];
  const pad = (s.h - s.knob) / 2;
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 rounded-full border transition-all duration-200 ease-out disabled:opacity-40 ${
        checked
          ? "bg-green border-green/70 shadow-[0_0_10px_rgba(52,199,89,0.4),inset_0_1px_1px_rgba(255,255,255,0.4)]"
          : "bg-white/10 border-white/15 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]"
      }`}
      style={{ width: s.w, height: s.h, WebkitTapHighlightColor: "transparent" }}
    >
      <motion.span
        aria-hidden
        className="absolute rounded-full bg-white"
        style={{ top: pad, left: pad, width: s.knob, height: s.knob, boxShadow: "0 2px 8px rgba(0, 0, 0, 0.35), inset 0 1px 0.5px rgba(255, 255, 255, 0.9)" }}
        initial={false}
        animate={{ x: checked ? s.w - s.knob - pad * 2 : 0 }}
        transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0, duration: 0.3 }}
      />
    </button>
  );
}
