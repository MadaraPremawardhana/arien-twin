# ARIEN Twin Studio

Browser digital twin of rooftop PV for [ARIEN](https://arien.base44.app/): a CesiumJS 3D world (Cesium ion or Google Photorealistic 3D Tiles), Open-Meteo weather, the five physics irradiance pathways from the thesis plus the panel thermal model, cell-level shading, simulation from real time to 1 day per second, and volumetric weather visuals. No Pixel Streaming: it runs on each visitor's GPU.

**Live site:** https://madarapremawardhana.github.io/arien-twin/

## Admin setup (all in the browser)

1. **Lock the keys to this site** before publishing them:
   - **Cesium ion** (cesium.com/ion → Access Tokens): a token with `assets:read`, only the assets you use (World Terrain 1, Bing imagery 2, OSM Buildings 96188, Google Photorealistic 2275207), and **Allowed URLs** = `https://madarapremawardhana.github.io/arien-twin/`.
   - **Google Maps Platform** (if used): restrict the key to the **Map Tiles API**, website restriction `https://madarapremawardhana.github.io/*`, and a daily quota.
2. Open the site. On the connect screen paste the token → **Load 3D world** → **Load weather**.
3. Place arrays and obstacles and choose models.
4. **World → Site settings for visitors (admin)** (or open `…/arien-twin/#admin`). Create a fine-grained GitHub token (GitHub → Settings → Developer settings → Fine-grained tokens) with access to **this repository only** and **Contents: Read and write**. Paste it in the panel, tick what to publish, press **Publish settings**. This commits `config.json`.
5. Visitors then get your site, arrays, obstacles, models and world, and connect automatically. GitHub Pages caches for up to 10 minutes.

Published keys are readable by visitors' browsers, which is why step 1 restricts them. Do not publish an Open-Meteo commercial key: it cannot be limited to one website. `…/#setup` skips auto-connect so you can test with other keys.

## Development

```
python3 build.py              # src/* → index.html
node test/physics.test.js     # physics and weather unit tests
# headless browser checks (need: npm install cesium@1.146.0 three@0.147.0 chart.js@4.4.1)
ARIEN_DEPS=node_modules python3 test/run_browser.py /tmp/shots full
ARIEN_DEPS=node_modules python3 test/admin_check.py /tmp/admin
ARIEN_DEPS=node_modules python3 test/diag_check.py
```

Edit files in `src/`, run `build.py`, commit both `src/` and `index.html`.

## What maps to the UE prototype

| UE5 prototype (screenshot) | Browser version |
|---|---|
| Set Recorder: location name / lat-lon | **Site**: Open-Meteo place search or coordinates |
| Time perspective: current / forecast 7 days / historical | **Weather**: Now, Next 7 days, Historical (archived forecast model or ERA5) |
| Historical forecasts: start, end, N days ago | **Weather → Past forecast**: Previous Runs API, lead N = 1–7 days |
| Upload CSV | **Weather → CSV**; optional `measured_kw` column scores the models |
| Customise solar panel(s): area, efficiency, temp. coefficient, location XYZ, rotation XYZ, panel count or farm length×width | **Arrays**: panel W×L, efficiency, %/°C, cells across×down (default 6×18 = 108), position E/N/height, tilt + azimuth, rows×panels or "fill an area" |
| Select irradiance model / run all numerical models | **Models**: live model + compare set; "Run all physics models" |
| LSTM / ANN / GRU / Bi-LSTM | Shown, locked: need trained model files (ONNX or TF.js) |
| Meta-learning mode | Locked panel; the thesis seasonal rule is available as a model |
| Fast-forward simulation | Time bar speeds (real time → 1 day/s) and **Fast-forward period** (15-min steps, all selected models) |
| Response overview | **Dashboard → Weather now** (K and °C, wind, direction, cloud, precipitation, sun elevation, GHI) |
| Total power kW, ON/OFF visuals, Show dashboard | HUD (top right), Visuals and Dashboard chips |

## Physics: what is implemented and what needs the PV Science project

All in `src/physics.js`, unit-tested in `test/physics.test.js` (65 checks, including sun position against NOAA values).

| Part | Implementation | Status |
|---|---|---|
| Sun position, E0, declination, equation of time | Spencer/Iqbal as listed in Bálint et al. (2019, HJIC 47(1)) | Matches NOAA within 0.3° in tests |
| Kasten (German) | Bálint et al. 2019 eqs. 22–23 (after Kasten 1989), A_d 0.7, B_d 0.027, a_d 0.72, b_d 3.2, q 0.93; Linke T_m = 3.0 chosen within the paper's 1.8–4 | Check T_m against thesis |
| Bálint (Hungarian) | Eq. 21 form G = (I_n sin α + a)(1 + b₁N^b₂); split into beam/diffuse with the Kasten direct formula | **a, b₁, b₂ are placeholders** (not in the paper); reads ~30% high in tests |
| Karamov–Naumov | Kasten–Czeplak cloud correction and diffuse fraction; clear sky 910·sin α − 30 | **Clear-sky term simplified**: Karamov (2017) uses Iqbal's model |
| HDKR | Duffie & Beckman eq. 2.16.7 on Open-Meteo GHI/DHI, albedo 0.2 | Standard |
| Real-World GHI | Open-Meteo GHI/DNI/DHI, isotropic transposition | Check against thesis transposition |
| Hourly → instantaneous | Open-Meteo radiation is a backward hourly mean; converted to clearness index and diffuse fraction at the half hour, then rebuilt from the instantaneous sun | Implementation assumption |
| Thermal | Bálint, Fodor, Magyar (2019) ODE, solved exactly per step; h = 5.7 + 3.8·v; heat capacity 9,600 J/m²K; efficiency −0.35 %/°C default | h(v) and heat capacity are assumptions |
| Shading | Beam only, per cell; rays to the sun against other panels (row-to-row) and placed obstacles; 3D tiles via traced skyline per panel or per array | No bypass-diode or mismatch model; diffuse not shaded |
| Seasonal rule | Summer (Jun–Aug) → RW-GHI, spring (Mar–May) → HDKR, autumn/winter → K–N; flipped for the southern hemisphere | From the company brief |

## Layout

```
src/physics.js     solar geometry, 5 models, thermal, ray casting, metrics (no DOM)
src/weather.js     Open-Meteo URLs and parsing, CSV import, interpolation
src/app.js         Cesium world, arrays/obstacles, simulation loop, visuals, UI
src/template.html  markup; src/style.css styles
build.py           inlines everything into index.html (what GitHub Pages serves)
test/physics.test.js   node test/physics.test.js
test/run_browser.py    headless Chrome check with mocked CDN, tiles and weather
```

## Known limits

- Tested headless (SwiftShader) with mocked map tiles, weather and GitHub API. Real Cesium ion and Google tiles, real Open-Meteo responses and a real settings publish still need a run on real hardware.
- 3D-tile shading uses Cesium's ray picking, which only sees tiles currently rendered; the tool flies to a top-down view first. Distant hills outside that view are missed.
- Above ~24,000 cells the view draws whole panels instead of cells; physics still runs per cell.
- Open-Meteo's free API is non-commercial only. Commercial use needs a paid plan, and historical endpoints need the Professional tier.
- Google Photorealistic tiles: place-name search is disabled while they are shown (Google requires its own geocoder).
