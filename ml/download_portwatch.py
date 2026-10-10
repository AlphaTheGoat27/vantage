"""Download the full IMF PortWatch daily chokepoint transit history (free, no key).

Writes data/raw/portwatch_daily.csv (git-ignored) and a small committed sample.
Stdlib only: python ml/download_portwatch.py
"""
import csv, json, pathlib, time, urllib.parse, urllib.request

BASE = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services"
ROOT = pathlib.Path(__file__).resolve().parent.parent
FIELDS = ["date", "portid", "portname", "n_container", "n_dry_bulk", "n_general_cargo", "n_roro", "n_tanker", "n_cargo", "n_total", "capacity"]


def get(url, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "vantage-backtest"}), timeout=60) as r:
                return json.load(r)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def main():
    rows, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"where": "1=1", "outFields": ",".join(FIELDS), "orderByFields": "ObjectId", "resultOffset": offset, "resultRecordCount": 1000, "f": "json"})
        page = get(f"{BASE}/Daily_Chokepoints_Data/FeatureServer/0/query?{q}")
        feats = [f["attributes"] for f in page.get("features", [])]
        rows += feats
        offset += len(feats)
        print(f"\r{len(rows)} rows", end="", flush=True)
        if not feats or not page.get("exceededTransferLimit"):
            break
    for r in rows:  # epoch ms -> ISO date
        r["date"] = __import__("datetime").datetime.utcfromtimestamp(r["date"] / 1000).strftime("%Y-%m-%d") if isinstance(r["date"], (int, float)) else r["date"]
    rows.sort(key=lambda r: (r["portid"], r["date"]))
    (ROOT / "data/raw").mkdir(parents=True, exist_ok=True)
    for path, subset in ((ROOT / "data/raw/portwatch_daily.csv", rows), (ROOT / "data/sample/portwatch_sample.csv", [r for r in rows if r["portname"] in ("Bab el-Mandeb Strait", "Suez Canal") and "2023-09-01" <= r["date"] <= "2024-03-31"])):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
            w.writeheader(); w.writerows(subset)
    print(f"\nwrote {len(rows)} rows, {rows[0]['date']}..{rows[-1]['date']}")


if __name__ == "__main__":
    main()
