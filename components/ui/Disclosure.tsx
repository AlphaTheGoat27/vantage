"use client";

import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useState, type ReactNode } from "react";

type Props = {
  title: ReactNode;
  /** quiet secondary text on the right of the header (a count, a summary) */
  trailing?: ReactNode;
  defaultOpen?: boolean;
  /** controlled mode: pass both to open the disclosure from outside */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** id on the section, so another control can scroll to it */
  anchorId?: string;
  children: ReactNode;
  className?: string;
};

const SPRING = { type: "spring", bounce: 0, duration: 0.35 } as const;

/** A disclosure row: the header toggles the content, which opens with a spring on its height. */
export default function Disclosure({ title, trailing, defaultOpen = false, open: openProp, onOpenChange, anchorId, children, className = "" }: Props) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (fn: (o: boolean) => boolean) => {
    const next = fn(open);
    setOpenState(next);
    onOpenChange?.(next);
  };
  const reduce = useReducedMotion();
  const id = useId();
  return (
    <section id={anchorId} className={className}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-10 w-full items-center gap-2 rounded-md py-2 text-left text-callout font-semibold text-ink"
        >
          <span className="min-w-0 flex-1">{title}</span>
          {trailing !== undefined && <span className="num shrink-0 text-caption font-normal text-ink-3">{trailing}</span>}
          <motion.span
            aria-hidden
            className="grid shrink-0 place-items-center text-ink-3"
            initial={false}
            animate={{ rotate: open ? 90 : 0 }}
            transition={reduce ? { duration: 0 } : SPRING}
          >
            <ChevronRight size={16} strokeWidth={1.75} />
          </motion.span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            id={id}
            className="overflow-hidden"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0.15 } : SPRING}
          >
            <div className="pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
