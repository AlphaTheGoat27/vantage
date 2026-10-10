"""Feature + label construction for the Vantage disruption model.

Data: IMF PortWatch daily transit counts per chokepoint (data/raw/portwatch_daily.csv).
Everything here is causal: a feature at day t only uses data up to and including t.
Labels look forward on purpose (they are the thing we predict) and are never used as features.

The same feature definitions are re-implemented in lib/model.ts for the live app;
`ml/export_model.py` writes a parity fixture so the two stay identical (see lib/model.test.mjs).
"""
from __future__ import annotations

import pathlib

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "portwatch_daily.csv"

MIN_BASELINE = 5.0       # skip near-empty chokepoints (Bering, Magellan...): ratios are meaningless there
DROP = 0.30              # a "disruption" = 7-day mean >= 30% below the pre-event baseline...
RUN = 7                  # ...sustained for 7 straight days
NORMAL_R7 = 0.85         # "normal state": 7d mean within 15% of baseline
GAP = 30                 # events need 30 clean days before them to count as a fresh onset

REGIONS = {
    "Bab el-Mandeb Strait": "redsea", "Suez Canal": "redsea",
    "Strait of Hormuz": "gulf",
    "Bosporus Strait": "blacksea", "Kerch Strait": "blacksea",
    "Gibraltar Strait": "europe", "Dover Strait": "europe", "Oresund Strait": "europe",
    "Malacca Strait": "seasia", "Sunda Strait": "seasia", "Lombok Strait": "seasia", "Makassar Strait": "seasia",
    "Mindoro Strait": "seasia", "Balabac Strait": "seasia", "Ombai Strait": "seasia", "Torres Strait": "seasia",
    "Taiwan Strait": "easia", "Luzon Strait": "easia", "Korea Strait": "easia", "Bohai Strait": "easia", "Tsugaru Strait": "easia",
    "Panama Canal": "americas", "Yucatan Channel": "americas", "Mona Passage": "americas", "Windward Passage": "americas", "Magellan Strait": "americas",
    "Cape of Good Hope": "africa", "Bering Strait": "arctic",
}

FEATURES = [
    "r1", "r3", "r7", "r14", "r28", "rz7", "slope7", "slope14", "accel", "vol28", "min_r7_30", "days_low14",
    "drawdown60", "tanker_share7", "tanker_share_chg", "container_share_chg", "bulk_share_chg",
    "cape_r7", "cape_slope14", "peer_r7", "global_r7", "global_frac_low", "log_baseline", "miss28", "doy_sin", "doy_cos",
    "news_log", "news_surge",
]

NEWS = ROOT / "data" / "news_weekly.csv"
# chokepoint -> Google News watch zones (same zone queries as lib/places.ts); no zone => feature is NaN
NEWS_ZONES = {
    "Bab el-Mandeb Strait": ["red-sea"], "Suez Canal": ["suez", "red-sea"], "Strait of Hormuz": ["hormuz"],
    "Bosporus Strait": ["black-sea"], "Kerch Strait": ["black-sea"], "Malacca Strait": ["malacca"], "Sunda Strait": ["malacca"],
    "Taiwan Strait": ["taiwan-strait"], "Luzon Strait": ["taiwan-strait"], "Balabac Strait": ["south-china-sea"],
    "Mindoro Strait": ["south-china-sea"], "Panama Canal": ["panama"], "Oresund Strait": ["baltic"],
}
NEWS_BASE_WEEKS = 8


def load(path: pathlib.Path = RAW) -> pd.DataFrame:
    d = pd.read_csv(path, parse_dates=["date"])
    return d.drop_duplicates(["portid", "date"]).sort_values(["portname", "date"])


def _slope(win: np.ndarray) -> float:
    if np.isnan(win).sum() > len(win) // 3:
        return np.nan
    i = np.arange(len(win), dtype=float)
    ok = ~np.isnan(win)
    ic = i[ok] - i[ok].mean()
    return float((ic * (win[ok] - win[ok].mean())).sum() / (ic**2).sum())


def series_features(g: pd.DataFrame) -> pd.DataFrame:
    """Per-chokepoint features. g: rows of one chokepoint with a daily index."""
    idx = pd.date_range(g["date"].min(), g["date"].max(), freq="D")
    g = g.set_index("date").reindex(idx)
    x = g["n_total"].astype(float)                       # NaN = missing day (kept explicit)
    # winsorise glitches: cap at 3x the trailing 8-week median, floor at 0
    cap = 3.0 * x.rolling(56, min_periods=14).median()
    xw = x.clip(lower=0).where(x.isna(), x.clip(lower=0).clip(upper=cap.fillna(np.inf)))

    base = xw.shift(7).rolling(91, min_periods=60).median()          # robust 90-day baseline, ending 7 days ago
    mad = (xw - base).abs().shift(7).rolling(91, min_periods=60).median()
    m = lambda k: xw.rolling(k, min_periods=max(1, min(k, int(k * 0.7)))).mean()
    out = pd.DataFrame(index=idx)
    out["base"] = base
    out["x"] = x
    for k, name in ((1, "r1"), (3, "r3"), (7, "r7"), (14, "r14"), (28, "r28")):
        out[name] = (m(k) / base).clip(0, 3)
    out["m7"] = m(7)
    out["rz7"] = ((m(7) - base) / (1.4826 * mad / np.sqrt(7) + 0.02 * base + 1e-9)).clip(-20, 20)
    rel = xw / base
    out["slope7"] = rel.rolling(7, min_periods=5).apply(_slope, raw=True).clip(-0.5, 0.5)
    out["slope14"] = rel.rolling(14, min_periods=10).apply(_slope, raw=True).clip(-0.5, 0.5)
    out["accel"] = out["r3"] - out["r14"]
    out["vol28"] = ((xw - xw.rolling(28, min_periods=14).median()).abs().rolling(28, min_periods=14).median() / base).clip(0, 3)
    out["min_r7_30"] = out["r7"].rolling(30, min_periods=15).min()
    out["days_low14"] = (rel < 0.8).astype(float).where(rel.notna()).rolling(14, min_periods=7).sum()
    out["drawdown60"] = (1 - out["m7"] / out["m7"].rolling(60, min_periods=30).max()).clip(0, 1)
    for col, name in (("n_tanker", "tanker"), ("n_container", "container"), ("n_dry_bulk", "bulk")):
        sh = (g[col].rolling(7, min_periods=5).sum() / g["n_total"].rolling(7, min_periods=5).sum())
        bs = sh.shift(7).rolling(91, min_periods=60).median()
        out[f"{name}_share7"] = sh
        out[f"{name}_share_chg"] = (sh - bs).clip(-0.5, 0.5)
    out["log_baseline"] = np.log1p(base)
    out["miss28"] = x.isna().astype(float).rolling(28, min_periods=1).mean()
    doy = idx.dayofyear.values
    out["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    out["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)

    # --- forward-looking labels (never features) ---
    M = out["m7"].rolling(RUN).max().shift(-(RUN - 1))        # M[s] = max m7 over s..s+6  (low if the whole run is low)
    out["_M"] = M
    for H in (7, 14):
        K = M.shift(-1)
        low_min = K.rolling(H).min().shift(-(H - 1))          # min over s in t+1..t+H
        lab = (low_min < (1 - DROP) * base).astype(float)
        lab[low_min.isna() | base.isna()] = np.nan
        out[f"y{H}"] = lab
    # next-7-day level for the forecast model: mean of the 7 days after t, relative to baseline
    out["fut7"] = (xw.rolling(7, min_periods=5).mean().shift(-7) / base).clip(0, 3)
    # event onsets: first day of a sustained-low run after >= GAP clean days
    low = (M < (1 - DROP) * base.shift(1)).fillna(False)
    onset = low & ~low.shift(1, fill_value=False) & (low.shift(1, fill_value=False).rolling(GAP, min_periods=1).sum().shift(1).fillna(0) == 0)
    out["onset"] = onset.astype(float)
    # app's current scoring input: mean 7d vs mean of the 90 days before (lib/signals.ts trafficSignal)
    mean7 = x.rolling(7, min_periods=5).mean()
    mean90 = x.shift(7).rolling(90, min_periods=60).mean()
    out["app_change_pct"] = (mean7 - mean90) / mean90 * 100
    out["app_baseline"] = mean90
    return out


def build(df: pd.DataFrame | None = None) -> pd.DataFrame:
    df = load() if df is None else df
    frames = []
    for name, g in df.groupby("portname"):
        f = series_features(g)
        f["portname"] = name
        f["region"] = REGIONS.get(name, "other")
        frames.append(f)
    ft = pd.concat(frames).rename_axis("date").reset_index()
    ft["valid"] = ft["base"] >= MIN_BASELINE
    ft["valid"] = ft["valid"].astype(bool)

    # cross-chokepoint context (all causal, built from the other chokepoints on the same day)
    r7 = ft.pivot(index="date", columns="portname", values="r7").where(ft.pivot(index="date", columns="portname", values="valid"))
    rr = ft.pivot(index="date", columns="portname", values="r7")
    cape = ft[ft.portname == "Cape of Good Hope"].set_index("date")
    ft["cape_r7"] = ft["date"].map(cape["r7"])
    ft["cape_slope14"] = ft["date"].map(cape["slope14"])
    n_valid = r7.notna().sum(axis=1)
    glob_sum = r7.sum(axis=1)
    low_sum = (r7 < 0.85).astype(float).where(r7.notna()).sum(axis=1)
    own = ft["r7"].where(ft["valid"])
    own_n = own.notna().astype(int)
    d = ft["date"]
    ft["global_r7"] = ((d.map(glob_sum) - own.fillna(0)) / (d.map(n_valid) - own_n).replace(0, np.nan))
    ft["global_frac_low"] = ((d.map(low_sum) - (own < 0.85).astype(float)) / (d.map(n_valid) - own_n).replace(0, np.nan))
    reg_mean = {}
    for reg in ft["region"].unique():
        cols = [c for c in rr.columns if REGIONS.get(c, "other") == reg]
        reg_mean[reg] = rr[cols]
    pv = np.full(len(ft), np.nan)
    for reg, mat in reg_mean.items():
        sel = (ft["region"] == reg).values
        sub = ft[sel]
        tot = mat.sum(axis=1, min_count=1)
        cnt = mat.notna().sum(axis=1)
        s = sub["date"].map(tot) - sub["r7"].fillna(0)
        c = sub["date"].map(cnt) - sub["r7"].notna().astype(int)
        pv[sel] = (s / c.replace(0, np.nan)).values
    ft["peer_r7"] = pv
    ft = add_news(ft)
    ft[FEATURES] = ft[FEATURES].astype(float)
    return ft


def add_news(ft: pd.DataFrame) -> pd.DataFrame:
    """Causal weekly headline-surge features. A Monday-aligned week is usable once it has fully ended."""
    ft = ft.copy()
    ft["news_log"] = np.nan
    ft["news_surge"] = np.nan
    if not NEWS.exists():
        return ft
    w = pd.read_csv(NEWS, parse_dates=["week_start"])
    per_zone = {}
    for z, g in w.groupby("zone"):
        g = g.drop_duplicates("week_start").set_index("week_start").sort_index()["n"].astype(float)
        base = g.shift(1).rolling(NEWS_BASE_WEEKS, min_periods=4).median()
        df = pd.DataFrame({"log": np.log1p(g), "surge": ((g + 1) / (base + 1)).clip(0, 10)})
        df["avail"] = df.index + pd.Timedelta(days=7)
        per_zone[z] = df.reset_index(drop=True).sort_values("avail")
    for name, zones in NEWS_ZONES.items():
        sel = ft["portname"] == name
        days = ft.loc[sel, ["date"]].sort_values("date")
        parts = []
        for z in zones:
            if z in per_zone:
                m = pd.merge_asof(days, per_zone[z], left_on="date", right_on="avail")
                m.index = days.index
                parts.append(m[["log", "surge"]])
        if parts:
            ft.loc[days.index, "news_log"] = pd.concat([p["log"] for p in parts], axis=1).max(axis=1)
            ft.loc[days.index, "news_surge"] = pd.concat([p["surge"] for p in parts], axis=1).max(axis=1)
    return ft
