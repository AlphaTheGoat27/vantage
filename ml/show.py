import json, sys
kind = sys.argv[1]
m = json.load(open(f"out/metrics_{kind}.json"))
for H in ("H7", "H14"):
    r = m[H]; print("=====", kind, H, "test rows", r["test_rows"])
    for k in ("naive", "naive15", "app", "vantage"):
        a = r[k]["all_days"]; e = r[k]["early_warning_stratum"]; ev = r[k]["events"]
        print(f"{k:8s} ALL p={a['precision']:.3f} r={a['recall']:.3f} f1={a['f1']:.3f} far={a['false_alarm_rate']:.4f} | EW tp={e['tp']} fp={e['fp']} fn={e['fn']} | events det {ev['detected']}/{ev['events']} early {ev['warned_early']} medLead={ev['median_lead_days']} | falseEp/yr={ev['false_alerts_per_chokepoint_year']:.2f} ({ev['false_alert_episodes']}/{ev['alert_episodes']})")
    print({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r["probability"].items()})
