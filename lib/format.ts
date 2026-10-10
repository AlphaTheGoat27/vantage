/** Shared UI formatters. */

export const usd = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;
};

export const ago = (iso?: string) => {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const h = ms / 3600_000;
  return h < 1 / 60 ? "just now" : h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
};

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

export const signed = (n: number, digits = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}`;
