"""Weekly headline counts per watch zone from Google News RSS (free, no key).

Uses the SAME zone queries as the live app (lib/places.ts WATCH_ZONES) so the model is trained on the
signal it will see in production. One request per zone-week with `after:`/`before:` date operators.
Counts are capped at ~100 by the feed, which we treat as "100+" (saturation is part of the signal).
Resumable: re-run to fill gaps.  python ml/download_news.py
"""
import csv, pathlib, re, time, urllib.parse, urllib.request, threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "news_weekly.csv"
SHIP = '(ship OR vessel OR tanker OR shipping OR cargo OR "container ship")'
ZONES = {
    "red-sea": f'("Red Sea" OR "Bab el-Mandeb" OR Houthi) {SHIP}',
    "hormuz": f'("Strait of Hormuz" OR "Gulf of Oman" OR "Persian Gulf") {SHIP}',
    "black-sea": f'("Black Sea" OR Odesa OR Novorossiysk) {SHIP}',
    "malacca": f'("Singapore Strait" OR "Strait of Malacca" OR "Malacca Strait") {SHIP}',
    "south-china-sea": '("South China Sea" OR "Scarborough" OR "Second Thomas") (coast guard OR clash OR military OR ship OR vessel)',
    "taiwan-strait": '("Taiwan Strait") (drills OR blockade OR military OR exercise OR ship OR vessel)',
    "panama": '("Panama Canal") (delays OR restrictions OR drought OR earthquake OR transits OR queue)',
    "suez": '("Suez Canal") (transits OR diversion OR closure OR traffic OR attack)',
    "baltic": '("Baltic Sea") (sabotage OR cable OR "shadow fleet" OR drone OR navy)',
}
START, END = date(2018, 10, 1), date(2026, 10, 12)
lock = threading.Lock()


def count(q, a, b, tries=6):
    u = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": f"{q} after:{a} before:{b}", "hl": "en-US", "gl": "US", "ceid": "US:en"})
    for i in range(tries):
        try:
            t = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read().decode("utf-8", "ignore")
            return len(re.findall("<item>", t))
        except Exception:
            time.sleep(3 * (i + 1))
    return None


def main():
    done = set()
    if OUT.exists():
        with open(OUT) as f:
            done = {(r["zone"], r["week_start"]) for r in csv.DictReader(f)}
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text("zone,week_start,n\n")
    jobs = []
    d = START
    while d < END:
        for z in ZONES:
            if (z, d.isoformat()) not in done:
                jobs.append((z, d))
        d += timedelta(days=7)
    if __import__("os").environ.get("REVERSE"):
        jobs.reverse()
    print(len(jobs), "requests to go", flush=True)

    def work(j):
        z, d = j
        n = count(ZONES[z], d, d + timedelta(days=7))
        time.sleep(0.4)
        if n is not None:
            with lock, open(OUT, "a") as f:
                f.write(f"{z},{d.isoformat()},{n}\n")
        return n

    with ThreadPoolExecutor(4) as ex:
        for i, _ in enumerate(ex.map(work, jobs)):
            if i % 200 == 0:
                print(i, "/", len(jobs), flush=True)


if __name__ == "__main__":
    main()
