"use client";

import { X } from "lucide-react";
import type { Ship } from "@/lib/ais";
import { ago } from "@/lib/format";
import { SHIP_COLORS } from "./colors";

const CLASS_LABEL: Record<Ship["cls"], string> = {
  cargo: "Cargo ship",
  tanker: "Tanker",
  passenger: "Passenger ship",
  fishing: "Fishing vessel",
  other: "Other vessel",
  unknown: "Vessel, type unknown",
};

const coord = (lat: number, lon: number) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;

/**
 * The selected live ship. `floating` sits over the globe in its own material; `inline` sits inside the sheet.
 * Esc handling lives with the owner of the selection (Dashboard).
 */
export default function ShipCard({ ship, onClose, variant = "floating" }: { ship: Ship; onClose: () => void; variant?: "floating" | "inline" }) {
  const name = ship.name?.trim();
  return (
    <section aria-label="Selected ship" className={variant === "floating" ? "material w-full rounded-2xl p-3.5 shadow-2xl" : "group-inset p-3.5"}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_8px_currentColor]" style={{ background: SHIP_COLORS[ship.cls] ?? SHIP_COLORS.unknown, color: SHIP_COLORS[ship.cls] ?? SHIP_COLORS.unknown }} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body font-semibold text-ink">{name || `MMSI ${ship.mmsi}`}</h2>
          <p className="truncate text-caption text-ink-3">
            {CLASS_LABEL[ship.cls]}
            {name && <span className="num"> · MMSI {ship.mmsi}</span>}
          </p>
        </div>
        <button type="button" aria-label="Close ship details" className="btn-plain -mr-1 -mt-1 h-7 w-7 rounded-full shrink-0 p-0 text-ink-2 hover:text-white" onClick={onClose}>
          <X size={15} strokeWidth={2} />
        </button>
      </div>
      <dl className="mt-2.5 grid grid-cols-3 gap-2">
        <Item label="Speed" value={`${ship.sog.toFixed(1)} kn`} />
        <Item label="Course" value={`${Math.round(ship.cog)}°`} />
        <Item label="Position" value={ship.at ? ago(ship.at) : "n/a"} />
      </dl>
      <dl className="mt-2 space-y-1 text-caption">
        <div className="flex gap-2">
          <dt className="w-[4.5rem] shrink-0 text-ink-3">Destination</dt>
          <dd className="min-w-0 truncate text-ink-2">{ship.destination?.trim() || "Not reported"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[4.5rem] shrink-0 text-ink-3">At</dt>
          <dd className="font-mono text-micro leading-4 text-ink-2">{coord(ship.lat, ship.lon)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-micro text-ink-3">{label}</dt>
      <dd className="num truncate text-callout font-medium text-ink">{value}</dd>
    </div>
  );
}
