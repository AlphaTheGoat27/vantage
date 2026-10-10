"use client";

import { ArrowUpDown, ChevronsUpDown, X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { usd } from "@/lib/format";
import type { LonLat } from "@/lib/geo";
import { PORTS } from "@/lib/places";
import type { ShipmentInput } from "@/lib/types";
import Disclosure from "./ui/Disclosure";
import Switch from "./ui/Switch";

export type VoyageFormState = Omit<ShipmentInput, "extraHazards" | "departure">;

export const PRESETS: { label: string; o: string; d: string; cargo: string; value: number; critical: boolean }[] = [
  { label: "Shanghai to Rotterdam, semiconductors", o: "CNSHA", d: "NLRTM", cargo: "Semiconductors", value: 85e6, critical: true },
  { label: "Port Klang to Hamburg, medical gloves", o: "MYPKG", d: "DEHAM", cargo: "Medical gloves", value: 18e6, critical: false },
  { label: "Jebel Ali to Rotterdam, petrochemicals", o: "AEJEA", d: "NLRTM", cargo: "Petrochemicals", value: 40e6, critical: false },
  { label: "Houston to Shanghai, LNG equipment", o: "USHOU", d: "CNSHA", cargo: "LNG equipment", value: 60e6, critical: true },
  { label: "Busan to Los Angeles, EV batteries", o: "KRPUS", d: "USLAX", cargo: "EV batteries", value: 70e6, critical: true },
];

const SORTED_PORTS = [...PORTS].sort((a, b) => a.name.localeCompare(b.name));
export const portName = (id: string) => PORTS.find((p) => p.id === id)?.name ?? id;

const ICON = { size: 15, strokeWidth: 1.75 } as const;

type Props = {
  form: VoyageFormState;
  onChange: (next: VoyageFormState) => void;
  /** a preset was chosen: the parent fills the form and runs the plan */
  onPreset: (index: number) => void;
  onSubmit: () => void;
  planning: boolean;
  strikes: LonLat[];
  onRemoveStrike: (index: number) => void;
  onClearStrikes: () => void;
};

export default function VoyageForm({ form, onChange, onPreset, onSubmit, planning, strikes, onRemoveStrike, onClearStrikes }: Props) {
  const id = useId();
  const set = (patch: Partial<VoyageFormState>) => onChange({ ...form, ...patch });
  const samePort = form.originId === form.destinationId;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!samePort && !planning) onSubmit();
      }}
    >
      <select
        aria-label="Example voyages"
        className="input text-ink-2"
        value=""
        onChange={(e) => {
          const i = Number(e.target.value);
          if (e.target.value !== "" && PRESETS[i]) onPreset(i);
        }}
      >
        <option value="" disabled>
          Example voyages
        </option>
        {PRESETS.map((p, i) => (
          <option key={p.label} value={i}>
            {p.label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        <div className="group-inset min-w-0 flex-1">
          <PortRow label="From" value={form.originId} onChange={(v) => set({ originId: v })} />
          <PortRow label="To" value={form.destinationId} onChange={(v) => set({ destinationId: v })} />
        </div>
        <button
          type="button"
          className="btn-plain h-9 w-9 shrink-0 p-0"
          aria-label="Swap origin and destination"
          title="Swap origin and destination"
          onClick={() => set({ originId: form.destinationId, destinationId: form.originId })}
        >
          <ArrowUpDown {...ICON} />
        </button>
      </div>
      {samePort && <p className="text-caption text-orange">Choose two different ports.</p>}

      <div className="grid grid-cols-[1fr_7.5rem] gap-2">
        <Field label="Cargo" htmlFor={`${id}-cargo`}>
          <input id={`${id}-cargo`} className="input" value={form.cargo} onChange={(e) => set({ cargo: e.target.value })} />
        </Field>
        <Field label="Value (USD M)" htmlFor={`${id}-value`}>
          <input
            id={`${id}-value`}
            className="input num"
            type="number"
            inputMode="decimal"
            min={0}
            value={form.cargoValueUsd / 1e6}
            onChange={(e) => set({ cargoValueUsd: Number(e.target.value) * 1e6 })}
          />
        </Field>
      </div>

      <div className="group-inset px-3 py-2.5">
        <div className="flex items-center gap-3">
          <label htmlFor={`${id}-critical`} className="flex-1 text-callout text-ink">
            Critical shipment
          </label>
          <Switch id={`${id}-critical`} checked={form.critical} onChange={(v) => set({ critical: v })} size="sm" />
        </div>
        <p className="mt-1 text-caption text-ink-3">Lower risk tolerance; a disruption costs 25% of cargo value instead of 15%.</p>
      </div>

      <Disclosure title="Vessel" trailing={`${form.speedKnots} kn · ${usd(form.dailyCostUsd)}/day`}>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Speed (kn)" htmlFor={`${id}-speed`}>
            <input
              id={`${id}-speed`}
              className="input num"
              type="number"
              inputMode="decimal"
              min={6}
              max={25}
              value={form.speedKnots}
              onChange={(e) => set({ speedKnots: Number(e.target.value) })}
            />
          </Field>
          <Field label="Cost/day (USD k)" htmlFor={`${id}-daily`}>
            <input
              id={`${id}-daily`}
              className="input num"
              type="number"
              inputMode="decimal"
              min={1}
              value={form.dailyCostUsd / 1000}
              onChange={(e) => set({ dailyCostUsd: Number(e.target.value) * 1000 })}
            />
          </Field>
          <Field label="Hull (USD M)" htmlFor={`${id}-hull`}>
            <input
              id={`${id}-hull`}
              className="input num"
              type="number"
              inputMode="decimal"
              min={0}
              value={form.hullValueUsd / 1e6}
              onChange={(e) => set({ hullValueUsd: Number(e.target.value) * 1e6 })}
            />
          </Field>
        </div>
      </Disclosure>

      {strikes.length > 0 && <StrikeChips strikes={strikes} onRemove={onRemoveStrike} onClear={onClearStrikes} />}

      <button type="submit" className="btn-primary w-full" disabled={planning || samePort}>
        {planning ? "Assessing…" : "Assess Route"}
      </button>
    </form>
  );
}

function PortRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative flex h-10 items-center gap-2 pl-3 pr-2">
      <span className="w-9 shrink-0 text-callout text-ink-3">{label}</span>
      <select
        className="h-8 min-w-0 flex-1 cursor-pointer appearance-none truncate rounded-sm bg-transparent pr-6 text-callout text-ink outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {SORTED_PORTS.map((p) => (
          <option key={p.id} value={p.id} className="bg-elevated-2 text-ink">
            {p.name}, {p.country}
          </option>
        ))}
      </select>
      <ChevronsUpDown aria-hidden size={14} strokeWidth={1.75} className="pointer-events-none absolute right-3 text-ink-3" />
    </label>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="truncate text-caption text-ink-2">
        {label}
      </label>
      {children}
    </div>
  );
}

const coord = ([lon, lat]: LonLat) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;

/** Simulated strikes as removable chips. */
export function StrikeChips({ strikes, onRemove, onClear }: { strikes: LonLat[]; onRemove: (i: number) => void; onClear: () => void }) {
  return (
    <div role="group" aria-label="Simulated strikes" className="flex flex-wrap items-center gap-1.5">
      {strikes.map((s, i) => (
        <span key={`${s[0]},${s[1]},${i}`} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-pink/15 pl-2.5 pr-1 text-caption text-ink">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-pink" />
          Strike {i + 1}
          <span className="font-mono text-micro text-ink-2">{coord(s)}</span>
          <button
            type="button"
            aria-label={`Remove strike ${i + 1}`}
            className="grid h-5 w-5 place-items-center rounded-full text-ink-2 hover:bg-pink/25 hover:text-ink"
            onClick={() => onRemove(i)}
          >
            <X size={12} strokeWidth={2} />
          </button>
        </span>
      ))}
      <button type="button" className="btn-plain h-7 text-caption" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
