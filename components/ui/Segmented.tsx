"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

type Option<T extends string> = { value: T; label: ReactNode; ariaLabel?: string };

type Props<T extends string> = {
  options: readonly Option<T>[];
  value: T;
  onChange: (v: T) => void;
  /** accessible name of the group */
  label: string;
  /**
   * "tabs": role=tablist with roving focus and arrow keys; tab ids are `${idBase}-tab-${value}` and
   * they control `${idBase}-panel-${value}`. "pressed": a group of aria-pressed buttons.
   */
  mode?: "tabs" | "pressed";
  idBase?: string;
  className?: string;
};

/** Apple segmented control, styled by the .segmented class in globals.css. */
export default function Segmented<T extends string>({ options, value, onChange, label, mode = "pressed", idBase = "seg", className = "" }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = mode === "tabs";

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (!tabs) return;
    const n = options.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role={tabs ? "tablist" : "group"} aria-label={label} className={`segmented ${className}`}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            aria-label={o.ariaLabel}
            {...(tabs
              ? { role: "tab", id: `${idBase}-tab-${o.value}`, "aria-controls": `${idBase}-panel-${o.value}`, "aria-selected": on, tabIndex: on ? 0 : -1 }
              : { "aria-pressed": on })}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
