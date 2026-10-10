"""Reproduce everything with one command (fixed seed 42):  python ml/run_all.py [--skip-news] [--skip-lgbm]

  1. download IMF PortWatch daily chokepoint transits   -> data/raw/portwatch_daily.csv   (~2 min, free, no key)
  2. download weekly Google News headline counts         -> data/news_weekly.csv           (~1 h first time, resumable; committed copy is used if present)
  3. walk-forward backtest (logit + optionally lgbm)     -> ml/out/*.json|pkl
  4. 7-day forecast with prediction intervals            -> ml/out/forecast_metrics.json
  5. export the production model + parity fixture        -> lib/data/vantage-model.json, lib/data/model-fixture.json
  6. distil metrics for the app                          -> lib/data/backtest-summary.json
  7. copy small results to ml/results and draw charts    -> slides/*.png  (Red Sea charts need: npx tsx scripts/case-study-redsea.mts)
"""
import pathlib, shutil, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
OUT, RESULTS = HERE / "out", HERE / "results"


def run(*args):
    print("\n$", " ".join(args), flush=True)
    subprocess.run([sys.executable, *args], cwd=HERE, check=True)


def main():
    skip_news, skip_lgbm = "--skip-news" in sys.argv, "--skip-lgbm" in sys.argv
    if not (HERE.parent / "data" / "raw" / "portwatch_daily.csv").exists():
        run("download_portwatch.py")
    if not skip_news:
        run("download_news.py")
    run("backtest.py", "logit" if skip_lgbm else "both")
    run("forecast.py")
    run("export_model.py", "logit")
    run("summary.py", "logit")
    RESULTS.mkdir(exist_ok=True)
    for f in ("metrics_logit.json", "metrics_lgbm.json", "forecast_metrics.json", "redsea_case.json"):
        if (OUT / f).exists():
            shutil.copy(OUT / f, RESULTS / f)
    run("make_charts.py")


if __name__ == "__main__":
    main()
