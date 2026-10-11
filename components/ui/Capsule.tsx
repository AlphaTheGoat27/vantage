import { FlaskConical } from "lucide-react";
import type { ReactNode } from "react";

const TONES = {
  // neutral crystal fill, so yellow stays reserved for risk and hazards
  demo: "bg-white/10 border border-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]",
  accent: "bg-blue/20 border border-blue/40 text-blue shadow-[0_0_8px_rgba(0,122,255,0.3)]",
  neutral: "bg-white/6 border border-white/10 text-ink-2",
} as const;

/** A small rounded crystal status label. The demo tone carries a flask icon so it reads as "scenario", not as a warning. */
export default function Capsule({ tone = "neutral", title, children }: { tone?: keyof typeof TONES; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex h-[20px] shrink-0 items-center gap-1 rounded-full px-2.5 text-micro font-medium backdrop-blur-md ${TONES[tone]}`}>
      {tone === "demo" && <FlaskConical aria-hidden size={11} strokeWidth={2} className="-ml-0.5 shrink-0 text-ink-2" />}
      {children}
    </span>
  );
}
