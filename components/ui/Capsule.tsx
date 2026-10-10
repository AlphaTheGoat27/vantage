import { FlaskConical } from "lucide-react";
import type { ReactNode } from "react";

const TONES = {
  // neutral fill, so yellow stays reserved for risk and hazards
  demo: "bg-fill text-ink",
  accent: "bg-accent/25 text-ink",
  neutral: "bg-fill text-ink-2",
} as const;

/** A small rounded status label. The demo tone carries a flask icon so it reads as "scenario", not as a warning. */
export default function Capsule({ tone = "neutral", title, children }: { tone?: keyof typeof TONES; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-2 text-micro font-semibold ${TONES[tone]}`}>
      {tone === "demo" && <FlaskConical aria-hidden size={11} strokeWidth={2} className="-ml-0.5 shrink-0 text-ink-2" />}
      {children}
    </span>
  );
}
