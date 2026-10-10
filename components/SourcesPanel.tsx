"use client";

import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import type { AisSnapshot } from "@/lib/ais";
import type { SignalsResponse, SourceStatus } from "@/lib/types";
import backtest from "@/lib/data/backtest-summary.json";
import { ago } from "@/lib/format";
import { SYS } from "./colors";

type Props = { signals: SignalsResponse | null; ais: AisSnapshot | null };

export default function SourcesPanel({ signals, ais }: Props) {
  return (
    <div className="space-y-6">
      {signals?.demo && (
        <div className="group-inset flex gap-2.5 px-3 py-2.5" role="note">
          <FlaskConical size={16} strokeWidth={1.75} className="mt-px shrink-0" style={{ color: SYS.yellow }} aria-hidden />
          <div className="min-w-0">
            <p className="text-callout font-semibold text-ink">Demo scenario: {signals.demo.scenario}</p>
            <p className="mt-0.5 text-caption text-ink-2">{signals.demo.note}</p>
          </div>
        </div>
      )}

      <Section title={signals?.demo ? "Sources (replaced by the scenario)" : "Live sources"} aside={signals ? `Updated ${ago(signals.generatedAt)}` : undefined}>
        {signals ? (
          <ul className="group-inset">
            {signals.sources.map((s) => (
              <SourceRow key={s.name} s={s} demo={Boolean(signals.demo)} />
            ))}
          </ul>
        ) : (
          <p className="group-inset px-3 py-3 text-callout text-ink-2">Waiting for the first live fetch.</p>
        )}
      </Section>

      <Section title="Ships (AIS)" aside={ais?.ok && ais.sampledAt ? `Sampled ${ago(ais.sampledAt)}` : undefined}>
        <AisBlock ais={ais} />
      </Section>

      {signals?.filtering && (
        <Section title="False-alarm filtering">
          <Filtering f={signals.filtering} />
        </Section>
      )}

      {signals?.model && (
        <Section title="Trained model">
          <ul className="group-inset">
            <Row label="Status">
              <span className="inline-flex items-center gap-1.5">
                <Dot color={signals.model.ok ? SYS.green : SYS.orange} />
                {signals.model.ok ? "Active" : "Unavailable"}
              </span>
            </Row>
            <Row label="Trained through">{signals.model.trainedThrough}</Row>
            <Row label="Horizon">
              <span className="num">{signals.model.horizonDays} days</span>
            </Row>
            <Row label="Features as of">{signals.model.asOf ?? "n/a"}</Row>
            <li className="px-3 py-2.5 text-caption text-ink-2">
              Predicts a sustained 30%+ traffic collapse at a chokepoint within {signals.model.horizonDays} days.
              {signals.model.note && <span className="mt-1 block" style={{ color: SYS.orange }}>{signals.model.note}</span>}
            </li>
          </ul>
        </Section>
      )}

      <Section title="Measured accuracy (walk-forward backtest)">
        <Backtest />
      </Section>

      <Section title="Also used">
        <ul className="group-inset">
          <Fact name="Open-Meteo Marine">Wave forecast per route, at the day the ship arrives.</Fact>
          <Fact name="Eurostat MARNET">Sea-lane network the routes are planned and validated on.</Fact>
          <Fact name="OpenStreetMap and Esri">Map imagery.</Fact>
          <Fact name="Google Gemini">Categorizing, reasoning and explanations.</Fact>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="text-caption font-medium text-ink-3">{title}</h3>
        {aside && <span className="text-caption text-ink-3">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-callout">
      <span className="text-ink-2">{label}</span>
      <span className="min-w-0 truncate text-right text-ink">{children}</span>
    </li>
  );
}

function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <li className="px-3 py-2">
      <p className="text-callout text-ink">{name}</p>
      <p className="mt-0.5 text-caption text-ink-3">{children}</p>
    </li>
  );
}

function SourceRow({ s, demo }: { s: SourceStatus; demo: boolean }) {
  const state = !s.ok ? "down" : s.fallback ? "snapshot" : "live";
  const color = demo ? SYS.gray :state === "down" ? SYS.red : state === "snapshot" ? SYS.yellow : SYS.green;
  const word = demo ? "Scenario" : state === "down" ? "Down" : state === "snapshot" ? (s.snapshotAt ? `Snapshot, ${ago(s.snapshotAt)}` : "Snapshot") : "Live";
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2 text-callout">
        <Dot color={color} />
        <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 truncate rounded-xs text-ink decoration-ink-3 underline-offset-2 hover:underline">
          {s.name}
        </a>
        <span className="shrink-0 text-caption text-ink-3">{word}</span>
        <span className="num ml-auto shrink-0 text-ink-2">{s.count}</span>
      </div>
      {s.note && <p className="mt-0.5 pl-4 text-caption text-ink-3">{s.note}</p>}
    </li>
  );
}

function AisBlock({ ais }: { ais: AisSnapshot | null }) {
  if (!ais) return <p className="group-inset px-3 py-3 text-callout text-ink-2">Checking for live ships…</p>;
  if (!ais.configured)
    return (
      <div className="group-inset space-y-1 px-3 py-2.5">
        <p className="flex items-center gap-2 text-callout text-ink">
          <Dot color={SYS.gray} />
          Not configured
        </p>
        <p className="text-caption text-ink-2">
          Live ships need a free{" "}
          <a href="https://aisstream.io" target="_blank" rel="noreferrer" className="rounded-xs text-link underline-offset-2 hover:underline">
            AISStream.io
          </a>{" "}
          key, set on the server as <code className="font-mono text-ink">AISSTREAM_API_KEY</code>. Everything else works without it.
        </p>
      </div>
    );
  if (!ais.ok)
    return (
      <div className="group-inset space-y-1 px-3 py-2.5">
        <p className="flex items-center gap-2 text-callout text-ink">
          <Dot color={SYS.orange} />
          Configured, but no sample this time
        </p>
        {ais.note && <p className="text-caption text-ink-2">{ais.note}</p>}
      </div>
    );

  const zonesWithShips = ais.regions.filter((r) => r.ships > 0).length;
  const flagged = ais.regions.filter((r) => r.anomalies.length);
  return (
    <ul className="group-inset">
      <Row label="Status">
        <span className="inline-flex items-center gap-1.5">
          <Dot color={SYS.green} />
          Live
        </span>
      </Row>
      <Row label="Ships sampled">
        <span className="num">{ais.shipCount.toLocaleString()}</span>
      </Row>
      {ais.seconds !== undefined && (
        <Row label="Sample window">
          <span className="num">{ais.seconds} s</span>
        </Row>
      )}
      <Row label="Watch zones with ships">
        <span className="num">{zonesWithShips}</span>
      </Row>
      <Row label="Zones with anomalies">
        <span className="num" style={flagged.length ? { color: SYS.orange } : undefined}>
          {flagged.length}
        </span>
      </Row>
      {flagged.map((r) => (
        <li key={r.id} className="px-3 py-2">
          <p className="text-callout text-ink">{r.name}</p>
          <ul className="mt-0.5 space-y-0.5 text-caption text-ink-2">
            {r.anomalies.map((a, i) => (
              <li key={i}>{a.detail}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Filtering({ f }: { f: NonNullable<SignalsResponse["filtering"]> }) {
  return (
    <ul className="group-inset">
      <Row label="Signals screened">
        <span className="num">{f.screened}</span>
      </Row>
      <Row label="Flagged">
        <span className="num" style={{ color: SYS.orange }}>
          {f.flagged}
        </span>
      </Row>
      <Row label="Dismissed as not a real threat to ships">
        <span className="num" style={{ color: SYS.green }}>
          {f.dismissed.length}
        </span>
      </Row>
      {f.dismissed.map((d) => (
        <li key={d.id} className="px-3 py-2">
          <p className="text-callout text-ink">{d.title}</p>
          <p className="mt-0.5 text-caption text-ink-3">{d.reason}</p>
        </li>
      ))}
    </ul>
  );
}

type Sys = { label: string; precision: number; recall: number; f1: number; falseAlarmRate: number; events: number; detected: number; warnedEarly: number; medianLeadDays: number; falseAlertsPerYear: number };

const TH = "px-2 pb-1.5 pt-2 align-bottom font-normal text-ink-3";
const TD = "num whitespace-nowrap px-2 py-1.5 text-right";

function Backtest() {
  const h = backtest.H14;
  const rows = ["vantage", "app", "naive15", "naive"].map((k) => (h.systems as unknown as Record<string, Sys>)[k]);
  const p = h.probability;
  return (
    <div className="space-y-2">
      <p className="px-1 text-caption text-ink-2">
        IMF PortWatch daily transits at 28 chokepoints, quarterly retraining from {backtest.foldsFrom} to Oct 2026, no future leakage. Task: will a chokepoint lose 30%+ of its traffic for a week within 14 days? Lead time is measured against the first day traffic visibly falls.
      </p>
      <div className="group-inset">
        <div className="overflow-x-auto rounded-lg focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)]" tabIndex={0} role="region" aria-label="Backtest results by system">
          <table className="w-full min-w-[300px] border-collapse text-caption">
            <thead>
              <tr>
                <th scope="col" className={`${TH} pl-3 text-left`}>
                  System
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Prec.
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Recall
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  False-alarm
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Warned early
                </th>
                <th scope="col" className={`${TH} pr-3 text-right`}>
                  False alerts/yr
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ours = r.label.startsWith("Vantage");
                return (
                  <tr key={r.label} className={`border-t border-hairline ${ours ? "font-medium text-link" : "text-ink-2"}`}>
                    <th scope="row" className={`py-1.5 pl-3 pr-2 text-left align-top ${ours ? "font-medium" : "font-normal"}`}>
                      {r.label}
                    </th>
                    <td className={TD}>{(r.precision * 100).toFixed(0)}%</td>
                    <td className={TD}>{(r.recall * 100).toFixed(0)}%</td>
                    <td className={TD}>{(r.falseAlarmRate * 100).toFixed(1)}%</td>
                    <td className={TD}>
                      {r.warnedEarly}/{r.events}
                    </td>
                    <td className={`${TD} pr-3`}>{r.falseAlertsPerYear.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="num px-1 text-caption text-ink-3">
        Model probability: ROC-AUC {p.roc_auc.toFixed(2)}, PR-AUC {p.pr_auc.toFixed(3)} ({p.pr_auc_lift.toFixed(0)}× the {(p.base_rate * 100).toFixed(1)}% base rate), Brier skill {(p.brier_skill * 100).toFixed(1)}%. Full report: ml/README.md.
      </p>
    </div>
  );
}
