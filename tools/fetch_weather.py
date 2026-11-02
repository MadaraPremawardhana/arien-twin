"""Fetch the site's weather from Open-Meteo and write the cache files the website reads.

Run by .github/workflows/weather-cache.yml. Uses only the standard library.
  python3 tools/fetch_weather.py <out_dir>

Writes (each the raw Open-Meteo JSON plus "arien_cached_at"):
  forecast.json    yesterday, today and the next 7 days        (every run)
  historical.json  archived forecasts for the last 92 days      (every 6 hours, or when missing)
  previous.json    forecasts issued 1-4 days ahead, last 45 days (every 6 hours, or when missing)
  year.json        ERA5 reanalysis for the 365 days ending 6 days ago, for yield estimates (daily, or when missing)
A file that cannot be fetched keeps its previous copy.
"""
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Thesis variables only (temperature and wind for the thermal model, cloud cover for the cloud models,
# GHI and diffuse for RW-GHI/HDKR, weather code and wind direction for the overview).
VARS = ["temperature_2m", "cloud_cover", "wind_speed_10m", "wind_direction_10m", "weather_code",
        "shortwave_radiation", "diffuse_radiation"]
LEADS = [1, 2, 3, 4]
DEFAULT_SITE = {"lat": 51.99564350977578, "lon": -0.9906258867252853}
UA = f"arien-twin weather cache (https://github.com/{os.environ.get('GITHUB_REPOSITORY', 'arien-twin')})"


def site():
    try:
        cfg = json.loads(Path("config.json").read_text())
        s = cfg.get("site") or {}
        return {"lat": float(s["lat"]), "lon": float(s["lon"])}
    except Exception:
        return DEFAULT_SITE


def get(url, tries=6):
    delay = 8
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode())
                if data.get("error"):
                    raise RuntimeError(data.get("reason", "Open-Meteo error"))
                return data
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as e:
            code = getattr(e, "code", None)
            print(f"  attempt {attempt}/{tries} failed: {code or ''} {e}", flush=True)
            if code is not None and code not in (429, 500, 502, 503, 504):
                raise
            if attempt == tries:
                raise
            time.sleep(delay + random.uniform(0, delay / 2))
            delay = min(delay * 2, 120)


def common(s):
    return {"latitude": f"{s['lat']:.5f}", "longitude": f"{s['lon']:.5f}", "timezone": "auto",
            "timeformat": "unixtime", "wind_speed_unit": "ms"}


def write(out, name, data):
    data["arien_cached_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    (out / name).write_text(json.dumps(data, separators=(",", ":")))
    print(f"  wrote {name} ({len(data.get('hourly', {}).get('time', []))} hours)", flush=True)


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "out")
    out.mkdir(parents=True, exist_ok=True)
    s = site()
    now = datetime.now(timezone.utc)
    slow_due = os.environ.get("GITHUB_EVENT_NAME") != "schedule" or now.hour % 6 == 0
    ok = True
    print(f"Site {s['lat']:.4f}, {s['lon']:.4f}", flush=True)

    jobs = [("forecast.json", "https://api.open-meteo.com/v1/forecast",
             {**common(s), "hourly": ",".join(VARS), "past_days": 2, "forecast_days": 7})]
    end = (now - timedelta(days=1)).date()
    if slow_due or not (out / "historical.json").exists():
        jobs.append(("historical.json", "https://historical-forecast-api.open-meteo.com/v1/forecast",
                     {**common(s), "hourly": ",".join(VARS), "start_date": str(end - timedelta(days=91)), "end_date": str(end)}))
    if slow_due or not (out / "previous.json").exists():
        hourly = ",".join(f"{v}_previous_day{n}" for n in LEADS for v in VARS)
        jobs.append(("previous.json", "https://previous-runs-api.open-meteo.com/v1/forecast",
                     {**common(s), "hourly": hourly, "start_date": str(end - timedelta(days=44)), "end_date": str(end)}))

    if (now.hour == 1 and os.environ.get("GITHUB_EVENT_NAME") == "schedule") or os.environ.get("GITHUB_EVENT_NAME") != "schedule" \
            or not (out / "year.json").exists():
        y_end = (now - timedelta(days=6)).date()
        jobs.append(("year.json", "https://archive-api.open-meteo.com/v1/archive",
                     {**common(s), "hourly": ",".join(VARS), "start_date": str(y_end - timedelta(days=364)), "end_date": str(y_end)}))

    for name, host, params in jobs:
        print(f"Fetching {name}", flush=True)
        try:
            write(out, name, get(f"{host}?{urllib.parse.urlencode(params)}"))
        except Exception as e:  # keep the previous copy
            ok = False
            print(f"  kept the previous {name}: {e}", flush=True)
        time.sleep(2)

    meta = {"site": s, "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "files": sorted(p.name for p in out.glob("*.json") if p.name != "meta.json"), "variables": VARS, "leads": LEADS}
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    return 0 if (out / "forecast.json").exists() else (0 if ok else 1)


if __name__ == "__main__":
    sys.exit(main())
