# ARIEN Twin Studio

Browser digital twin of rooftop PV for [ARIEN](https://arien.base44.app/): a CesiumJS 3D world (Cesium ion or Google Photorealistic 3D Tiles), Open-Meteo weather, the five physics irradiance pathways from the thesis plus the panel thermal model, cell-level shading, simulation from real time to 1 day per second, and volumetric weather visuals. No Pixel Streaming: it runs on each visitor's GPU.

**Live site:** https://madarapremawardhana.github.io/arien-twin/ (planner: `…/#design`, dashboard: `…/#dashboard`)

**Web app around it** (landing pages, accounts, a twin per user): https://madarapremawardhana.github.io/arien-twin/web/ — source and notes in [`web/`](web/README.md).

## Shading: per-cell line traces

Every cell of every panel is traced toward the sun, the browser version of the thesis's per-cell `LineTraceByChannel` (`ArienPhysics.traceCells`). Channels:

- **Placed objects**, in three groups: **Obstacles** (walls, chimneys, poles), **Foliage** (trees, conifers, hedges) and **Buildings** (drawn buildings and simple blocks). Walls, buildings, chimneys, poles and tree trunks block; a tree or hedge canopy passes its **transparency** (0% = solid, as in the thesis); several canopies multiply.
- **Arrays snap to roofs.** Drop or place an array on a pitched roof and it takes that roof face's pitch and facing and mounts flush (0.1 m above it, rows touching along the slope, each row higher up the slope). On a drawn building the plane is the exact roof face; on 3D tiles it is fitted to 3×3 surface samples around the array (accepted when they fit one plane within 12 cm, and the surface is at least 1.5 m above the site's ground). On a flat roof the array keeps its tilt and facing and stands on the roof; dropped back on the ground it is racked again. Changing tilt or facing by hand turns a flush array into a racked one; *Snap to the roof here* re-snaps, and the *Snap to the roof's angle* box turns it off per array. Only roof faces the camera can see can be dropped on.
- **Drawn buildings** (Objects → Buildings → *Draw a building*): set the floors and roof, click each corner of the floor area on the ground, then *Finish* (Enter, or click the first corner; Backspace removes the last corner, Esc cancels). Any simple outline works, L-shapes included.
  - Walls rise to the eaves (floors × floor height, 2.8 m by default). The roof is flat, gable, hip or mono-pitch, with a pitch (35°, 30°, 15° by default) and a ridge along the long or short side. On non-rectangular plans the roof planes follow the plan's bounding rectangle.
  - The 3D model and the shading traces use the same wall and roof triangles. *Match floors to the 3D tiles* sets the number of floors from the tiles; *Redraw the floor area* keeps the settings.
- **Other panels**: row-to-row shading, opaque.
- **3D tiles**: buildings, terrain and trees in the tiles, through the traced skyline of each panel (Shading → Trace skyline).

A cell keeps the share of direct sun its trace lets through; with **4 rays per cell** (2×2) a cell can be partly covered. The panel's direct sun is the cell average; diffuse light is not shaded. The same traces run at every step of the 7-day forecast (15 minutes), the period run and the 12-month yield (hourly). Each run also computes the unshaded output, and charges the difference to whatever each cell's trace hit, weighted by the blocked direct sun.

- **Shading → Line traces to the sun** (or **T**, or the HUD's **Traces** chip) draws the traces: green clear, red to the hit point on an object, amber through a canopy, orange another panel, violet the 3D tiles. A readout shows how many cells are shaded now and what takes the light.
- Changing an object, its transparency or the trace settings re-runs the 7-day forecast by itself. The Dashboard's **Shading from objects** card gives kWh lost per cause for the next 7 days and for a year; today's chart shows output with and without shading; the PDF report lists the causes.

## Dashboard and site report

**Dashboard** (rail, below Meta) summarises a simulated design. After **Simulate in 3D →** the camera frames the design from in front and a year of yield runs in the background, so the dashboard is ready when you open it.

- **My sites** comes first: every saved site (in the ARIEN account when signed in, otherwise this browser), the open one marked *Open now*, each with Edit design, Open in 3D and delete. **New site** starts an empty design in the Design view with the place search ready; if the open design has unsaved changes it first offers *Save, then start new*, *Start new without saving* or *Cancel*.
- **Overview**: system capacity, panel count, estimated annual production (after system losses), annual savings split into bill savings (solar used at home × import price) and export income (exported kWh × SEG rate), CO₂ reduction, payback, lifetime return, and battery storage (none yet; a preview shows what a 5 kWh battery would change; `ArienFinance.selfConsumption` already accepts a battery for when batteries are designed).
- **Today's forecast**: solar power through today against typical home use and cloud cover, with the 7-day totals.
- **Recommendations**: for homes without a battery, the best window today and on the next two days for a washing machine, dishwasher, tumble dryer, EV top-up and immersion heater, and how much of each run solar covers.
- **Financial overview**: 5, 10, 15 or 20 years: yearly bill savings and export income, running total after the installed cost, net position and return; year-by-year table.
- **Monthly production**, **Assumptions** (editable, saved with the site) and **Reports**.
- **Report**: a five-page A4 PDF watermarked "Generated by Arien": satellite map with the layout, an engineering plan to scale (dimensions, north arrow, scale bar, array schedule, title block), system specification, monthly yield, 7-day forecast, financial summary and every assumption with its source. Each page's footer gives the generated date and the weather sources.

### Finance assumptions (UK defaults, checked 3 Nov 2026)

| Assumption | Default | Source |
|---|---|---|
| Import price | 26.32 p/kWh | Ofgem price cap, 1 Oct–31 Dec 2026, GB average, direct debit |
| Export (SEG) | 12 p/kWh | Typical customer rate (Octopus, British Gas, OVO, ScottishPower), Sunsave table 26 Oct 2026 |
| Import price rise | 2% a year | Assumption: about the Bank of England CPI target |
| Household use | 2,500 kWh a year | Ofgem medium TDCV from 1 Jul 2026 |
| Share used at home | simulated | Hourly match to a typical household profile; UK field average 37% (McKenna et al. 2018) |
| System losses | 14% | PVGIS standard example |
| Panel ageing | 1% year 1, 0.4%/yr after | JinkoSolar Tiger Neo / LONGi Hi-MO 6 warranties |
| Installed cost | £1,900/kWp ≤ 4 kWp, £1,600 to 10 kWp, £1,200 above | DESNZ cost data (median about £1,800–1,900/kW domestic) and 2026 price guides; 0% VAT until 31 Mar 2027 |
| Inverter | £1,000 in year 12 | UK fitted £600–2,000, life 10–15 years (Q3 2026) |
| Carbon | 0.13096 kg CO₂e/kWh | DESNZ 2026 GHG conversion factors, UK electricity |

Energy figures shown to people (planner cards, Analysis, Dashboard, report) are after system losses; the 3D view's live power is the DC physics.

## Design planner (2D)

**Design** at the top of the rail opens a satellite map for roughing out a layout. The panels are the same arrays the 3D twin simulates.

- **Search address or postcode**: UK postcodes go to postcodes.io, addresses and places to OpenStreetMap Nominatim, then Open-Meteo. Coordinates (`51.99, -0.99`) work too. With Google 3D tiles shown, search uses Google's geocoder (through Cesium ion, or the Geocoding API on your Google key), as Google's terms require.
- **Tools**: *Place* (one panel per click; drag to move, right-click to remove), *Rectangle* and *Freehand* (draw a roof area; it fills with rows of panels and re-fills when settings change), *Object* (obstacles and foliage with a height; for a building, set floors and roof, then click each corner of its floor area and press Enter or click the first corner). Keys 1–4 switch tools; Delete removes the selection.
- **Left panel**: site name (blank = automatic name), panel model, tilt, azimuth, array summary with the annual shading loss, and Advanced (flush on roof or racked rows, portrait/landscape, row spacing, gaps, edge setback, mount height). Settings apply to the selected group, or to the whole design when nothing is selected.
- **Simulate in 3D →** settles the panels onto the roofs in the 3D tiles, frames them, then runs the period. **Forecast** and **Est. yield** are here and on the twin's HUD. The side panel of period results is now called **Analysis**.
- **Design kit**: *Analyse* sizes a roof area (panels, kWp and kWh a year from this site's last 12 months of weather). The request box understands short instructions such as "10 panels in London, south-facing", "5 kWp of Aiko panels in MK18 1EG", "east-west 16 panels", "add a tree 9 m south, 12 m tall", "estimate yield", "save as Garage roof". It is rules-based and runs in the browser; no AI service is called.

### Panel library (`src/panels.js`)

| Panel | Power | Efficiency | Size (m) | Pmax coefficient |
|---|---|---|---|---|
| LONGi Hi-MO 6 Explorer LR5-54HTH-430M | 430 W | 22.0% | 1.722 × 1.134 | −0.29 %/°C |
| LONGi Hi-MO X10 Explorer LR7-54HVH-485M | 485 W | 23.8% | 1.800 × 1.134 | −0.26 %/°C |
| AIKO Neostar 2P A460-MAH54Mw | 460 W | 23.1% | 1.757 × 1.134 | −0.26 %/°C |
| JinkoSolar Tiger Neo JKM440N-54HL4R-B | 440 W | 22.0% | 1.762 × 1.134 | −0.29 %/°C |
| JA Solar DeepBlue 4.0 Pro JAM54D40-450/LR | 450 W | 22.5% | 1.762 × 1.134 | −0.29 %/°C |
| Trina Vertex S+ TSM-440NEG9R.28 | 440 W | 22.0% | 1.762 × 1.134 | −0.30 %/°C |
| Qcells Q.TRON BLK M-G2+ 430 | 430 W | 22.0% | 1.722 × 1.134 | −0.30 %/°C |
| REC Alpha Pure-R 430 | 430 W | 22.3% | 1.730 × 1.118 | −0.24 %/°C |
| Maxeon 7 SPR-MAX7-445-PT | 445 W | 24.1% | 1.787 × 1.035 | −0.27 %/°C |
| JinkoSolar Tiger Neo JKM580N-72HL4-V (commercial) | 580 W | 22.5% | 2.278 × 1.134 | −0.29 %/°C |

Values are STC from the manufacturers' datasheets (sources in `src/panels.js`). The twin computes power as efficiency × panel area × plane-of-array irradiance, corrected with the Pmax temperature coefficient, so each model's datasheet efficiency sets its yield. Editing a value by hand turns the array into a custom panel.

### Saved sites, forecast and yield

- **Site → Saved sites** and the planner's **Save** keep named designs in this browser. A blank name becomes, for example, "Buckingham 5.16 kWp south-facing". To share a design use the admin publish or **Save scene**. Inside the ARIEN web app they go to the user's account instead (next section).
- **Forecast**: next 7 days, daily kWh, live model.
- **Est. yield**: hourly physics over ERA5 reanalysis for the last 12 months (365 days ending 6 days ago), with every compared model, monthly kWh, kWh/kWp and the weather-based shading loss. No inverter, cable or soiling losses. The planner's shading figure before that is a clear-sky estimate (21st of each month, Kasten with no cloud).

## ARIEN account (inside the web app)

When the twin runs inside the ARIEN web app, saved sites and results belong to the signed-in user, on every device. The web app is the `web/` frontend in this repository (`twin/` and `dashboard/` pages) or the Base44 site (`/twin`, `/digital-twin`); both keep sites in the same `SolarSite` records. `src/account.js` handles it:

- The twin sends a `hello` to its parent page, only to the origins in `PARENTS` (this GitHub Pages origin for `web/`, and `https://arien.base44.app`). The page answers with the user's first name, plan and site list. It does every read and write under the account's access rules, so no password, token or email reaches the twin.
- **Save** writes the twin's full scene (`twin_scene`), its fresh results (`twin_results`) and the plain fields the web app reads. Plain fields include panel count, kWp, tilt, azimuth, tariffs, install cost, `annual_kwh_cached`, and objects as footprints with heights (a drawn building's label carries its floors and roof, so it comes back as the same building). A matching name updates that site. On a plan with a site limit (Household: 1), a new name offers to replace the saved site or open Plans.
- Forecast and yield runs on the open site are kept with it, unless the design has changed since it was saved.
- Sites drawn in the web designer open in the twin. Panels are grouped into rows, the web panel models map to the panel library, obstructions become buildings, trees, walls and so on, and tariffs carry over. If a site was changed in the web designer after the twin saved it, the twin rebuilds it from the web layout.
- Sites saved only in this browser are offered once for copying into the account.
- Opened on its own, or framed by any other site, the twin keeps using this browser's storage and doesn't wait for an answer.
- The host page switches between the designer and the dashboard by changing only the address fragment (`#design`, `#dashboard`), and the twin tells it when the user switches inside the twin. `?lat=…&lon=…&q=…` starts a new design at that place.
- The web app uses the message `id` both to pair replies and as the site id, so the twin sends one request at a time and matches replies on type and site id.

## Put the Cesium ion key in the site ("hardcode" it)

The site reads its keys from `config.json` at the repository root, so the key lives in that one file rather than in the code.

1. In Cesium ion (cesium.com/ion → Access Tokens) create a token with only the `assets:read` scope, only the assets the site uses (1 World Terrain, 2 Bing imagery, 96188 OSM Buildings, 2275207 Google Photorealistic), and **Allowed URLs** = `https://madarapremawardhana.github.io`. Use the domain without the `/arien-twin/` path: browsers send only the domain as the referrer to other sites, so a path-restricted token is refused.
2. On GitHub open `config.json` → pencil (Edit) and add the token under `world`:
   ```json
   "world": { "src": "ion", "ionToken": "eyJhbGciOi…" },
   ```
   Keep `"autoConnect": true`. **Commit changes.** GitHub Pages republishes in about a minute (browsers may cache for up to 10).
3. Visitors now go straight to the 3D world (see **Start-up** below). `…/arien-twin/#setup` still opens the connect screen.

The published site has a token in `config.json` now (Cesium ion terrain + OSM Buildings).

### Start-up

With `"autoConnect": true` and a key in `config.json` (or `"src": "none"`), the page shows only the ARIEN logo and a spinner, loads the 3D world, then loads the Open-Meteo forecast for the next 7 days. The connect screen is not shown.

- If Cesium ion refuses the token (wrong Allowed URLs, revoked, out of quota), the page opens on the map instead and says why in a warning.
- If the forecast does not load, the twin still opens; a warning points to the Weather panel.
- Visitors change the world, keys or weather later under **World → Connect**, or the Weather panel. `…/#setup` opens the connect screen first.

The admin panel does the same: tick **Include keys** and press **Publish settings**. Anyone can read a key that a web page uses, which is why step 1 restricts it; rotate it now and then (new token, publish, delete the old one).

## Weather

Only the variables the thesis models use are requested: `temperature_2m`, `cloud_cover`, `wind_speed_10m`, `wind_direction_10m`, `weather_code`, `shortwave_radiation`, `diffuse_radiation` (precipitation and snow are derived from the weather code for the visuals). Open-Meteo's free API drops requests at busy times, mostly around the full hour (HTTP 503 "The service is overloaded"), so the site reads a copy first:

- `.github/workflows/weather-cache.yml` runs at :23 past each hour and when `config.json` changes. It writes `forecast.json`, `historical.json` (92 days), `previous.json` (forecasts issued 1–4 days ahead, 45 days) and `year.json` (ERA5, 365 days, daily) to the `weather-data` branch.
- The page uses that copy for the published site when it covers the request (fresh: 3 hours for forecasts, 30 hours otherwise), otherwise calls Open-Meteo with two retries, and falls back to an older copy before giving up.
- Other places, earlier dates and leads beyond 4 days go to Open-Meteo directly.

## Admin setup (all in the browser)

1. **Lock the keys to this site** before publishing them:
   - **Cesium ion** (cesium.com/ion → Access Tokens): a token with `assets:read`, only the assets you use (World Terrain 1, Bing imagery 2, OSM Buildings 96188, Google Photorealistic 2275207), and **Allowed URLs** = `https://madarapremawardhana.github.io` (domain only; a path-restricted token is refused).
   - **Google Maps Platform** (if used): restrict the key to the **Map Tiles API**, website restriction `https://madarapremawardhana.github.io/*`, and a daily quota.
2. Open the site. On the connect screen paste the token → **Load 3D world** → **Load weather**.
3. Place arrays and objects and choose models. Objects are real-size models with three levels of detail (close-up textured, mid, far); **Objects → Measure in the 3D view** and **Match height to the 3D tiles** size them against the photorealistic tiles.
4. **World → Site settings for visitors (admin)** (or open `…/arien-twin/#admin`). Create a fine-grained GitHub token (GitHub → Settings → Developer settings → Fine-grained tokens) with access to **this repository only** and **Contents: Read and write**. Paste it in the panel, tick what to publish, press **Publish settings**. This commits `config.json`.
5. Visitors then get your site, arrays, objects, models and world, and connect automatically. GitHub Pages caches for up to 10 minutes.

Published keys are readable by visitors' browsers, which is why step 1 restricts them. Do not publish an Open-Meteo commercial key: it cannot be limited to one website. `…/#setup` skips auto-connect so you can test with other keys.

## Development

```
python3 build.py              # src/* → index.html
node test/physics.test.js     # physics and weather unit tests
node test/account.test.js     # account bridge: conversions and the message channel
# headless browser checks (need: npm install cesium@1.146.0 three@0.147.0 chart.js@4.4.1)
ARIEN_DEPS=node_modules python3 test/run_browser.py /tmp/shots full
ARIEN_DEPS=node_modules python3 test/admin_check.py /tmp/admin
ARIEN_DEPS=node_modules python3 test/quiet_start_check.py /tmp/quiet  # start-up without the connect screen
ARIEN_DEPS=node_modules python3 test/account_check.py /tmp/account     # inside a copy of the web app's /twin page
ARIEN_DEPS=node_modules python3 test/diag_check.py
ARIEN_DEPS=node_modules python3 test/planner_check.py /tmp/planner   # needs leaflet@1.9.4 too
ARIEN_DEPS=node_modules python3 test/models_check.py /tmp/models
ARIEN_DEPS=node_modules python3 test/dashboard_check.py /tmp/dash      # needs jspdf@2.5.1 too
ARIEN_DEPS=node_modules python3 test/shading_check.py /tmp/shading
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

All in `src/physics.js`, unit-tested in `test/physics.test.js` (276 checks, including sun position against NOAA values, the weather cache, the panel library, geocoding, saved sites, the finance model and the line traces).

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
| Shading | Beam only; line trace per cell (or 2×2 per cell) to the sun against other panels, placed objects and drawn buildings (canopy transparency, multiplied through several canopies) and the 3D-tile skyline; losses charged per cause | No bypass-diode or mismatch model; diffuse not shaded; multiplying canopy transparencies is our rule (the thesis treats canopies as solid) |
| Seasonal rule | Summer (Jun–Aug) → RW-GHI, spring (Mar–May) → HDKR, autumn/winter → K–N; flipped for the southern hemisphere | From the company brief |
| **USM-1** (experimental) | Unified Sky Model, Premawardhana (Nov 2026), Section 4 and Table 1 (nine global coefficients). See below | Not part of the seasonal rule; not validated on ground data |

### USM-1 (experimental)

Pick it under **Models** as the live model or in the comparison; it is labelled *experimental* everywhere, including reports.

- **Inputs** (fetched only while USM-1 is in use, in requests of their own so they can never break the main weather load):
  - Open-Meteo: cloud cover low, mid and high, precipitation, surface pressure and 2 m relative humidity (one request), snow depth (one request);
  - CAMS aerosol optical depth at 550 nm from Open-Meteo's air-quality API (one request).
  - The hourly weather cache (`tools/fetch_weather.py`) adds the same columns to `forecast.json`, `historical.json` and `year.json`, so those load without extra calls. `previous.json` does not carry them.
  - Fallbacks, listed under the model list when used: pressure from the site's elevation, humidity 75%, no snow, aerosol 0.1. A CSV upload has no cloud layers, so USM-1 is unavailable there.
- **Per hour** (`physics.usm1Hour`, hour ending at each Open-Meteo time stamp):
  - instantaneous inputs averaged over the start and end of the hour; precipitation is the hour's total;
  - six sub-steps; NOAA/Meeus sun position and earth–sun distance, E0n = 1361.1/r²; Kasten–Young air mass;
  - precipitable water from temperature and humidity (Gueymard 1994), ozone from van Heuklon (1979), aerosol to 380 and 500 nm with Ångström 1.3;
  - Bird–Hulstrom clear sky (eqs. 6–13), three cloud layers with precipitation thickening (eqs. 14–16), snow multiple reflection (eq. 17), layer beam (eq. 18);
  - coefficients from Table 1: k_L 0.534, k_M 0.668, k_H 0.154, a 0.409, a_P 2.35, P_0 0.70 mm/h, α_s 0.71, κ 1.39, exponent on c_H 2.
- **In the twin:** the hour means of global and diffuse are turned into instants like the API radiation (clearness and diffuse fraction at the half hour), then go onto the panels with HDKR and the hour's ground albedo (0.2, rising to 0.71 with 5 cm of snow). The beam part is what cell shading blocks.
- **Checked against** pvlib 0.16.1 (the paper's own verification library) and a second implementation written from the paper in Python (`tools/usm1_reference.py`, fixtures in `test/fixtures/usm1_reference.json`): cos zenith within 1e-4 of SPA, Bird within 5e-5 (the paper's aerosol coefficient 0.2758 against pvlib's 0.27583), eight test hours (sunrise, rain, snow, dust at altitude, southern hemisphere, night) within 0.4%.
- **On real weather** (Buckingham, from the cache built on 19 Nov 2026; hours with the sun above 5°), against each weather source's own irradiance (the paper's Reference 1):
  - ERA5, 14 Nov 2025 – 13 Nov 2026, 3,933 hours: nRMSE 17.6%, MBE −0.1 W/m². By sky: clear 5.2%, few 11.3%, broken 15.2%, overcast 29.5% (paper, 44 sites: 5.0%, 10.5%, 16.8%, 30.3%; temperate 19.1%).
  - Archived forecasts (Open-Meteo best match), 19 Aug – 18 Nov 2026, 938 hours: nRMSE 31.0%, MBE +27 W/m². The paper notes that the coefficients belong to the weather source; they were fitted on ERA5, IFS and ICON.
- **Choices the paper leaves open** (for PV Science): sub-steps at the midpoints of six 10-minute slices; geometric zenith without refraction; precipitable water floored at 0.1 cm as in pvlib; van Heuklon's longitude term coded as in Wilson's implementation.

## Layout

```
src/physics.js     solar geometry, 5 models + USM-1 (experimental), thermal, ray casting, metrics (no DOM)
src/weather.js     Open-Meteo URLs and parsing, weather cache, CSV import, interpolation
src/panels.js      panel library from datasheets
src/places.js      place, address and postcode search; automatic names; saved sites (this browser)
src/account.js     ARIEN account bridge (inside arien.base44.app): messages, scene <-> SolarSite record, results
src/planner.js     2D Design planner (Leaflet), roof-area filling, Design kit
src/finance.js     household profile, self-consumption (battery-ready), cash flows, payback, recommendations
src/charts.js      shared Chart.js styling
src/dashboard.js   Dashboard tab
src/report.js      PDF site report (jsPDF, loaded on first use)
src/models.js      object models (trees, hedges, walls, chimneys, buildings, drawn buildings, poles) at 3 levels of detail, exported as glTF
src/app.js         Cesium world, arrays/objects, simulation loop, visuals, UI
src/template.html  markup; src/style.css styles
build.py           inlines everything into index.html (what GitHub Pages serves)
test/physics.test.js   node test/physics.test.js
test/account.test.js   node test/account.test.js
test/account_check.py  the twin inside a copy of the web app's /twin page (handler as published 10 Nov 2026)
test/run_browser.py    headless Chrome check with mocked CDN, tiles and weather
test/models_check.py   renders every object at each level of detail
test/sites_check.py      My sites first on the dashboard, New site (save first, discard), open site marked
test/usm1_check.py       USM-1: listed as experimental, inputs on demand, live power, period run, yield
test/roof_snap_check.py  arrays dropped on gable, flat and ground surfaces; snap toggle and button
test/buildings_check.py  object groups, drawing buildings in 3D and on the map, floors and roof, save and reopen
tools/fetch_weather.py fills the weather-data branch (run by the workflow)
```

## Known limits

- Tested headless (SwiftShader) with mocked map tiles, weather and GitHub API. Real Cesium ion and Google tiles, real Open-Meteo responses and a real settings publish still need a run on real hardware.
- 3D-tile shading uses Cesium's ray picking, which only sees tiles currently rendered; the tool flies to a top-down view first. Distant hills outside that view are missed.
- Above ~24,000 cells the view draws whole panels instead of cells; physics still runs per cell.
- Open-Meteo's free API is non-commercial only. Commercial use needs a paid plan, and historical endpoints need the Professional tier.
- Google Photorealistic tiles: search then uses Google's geocoder. With your own Google key, enable the Geocoding API on it.
- The planner's satellite layer is Esri World Imagery. Esri's terms require an ArcGIS account and API key for commercial apps; OpenStreetMap Nominatim allows light use only (1 request a second, no autocomplete). Both need replacing or licensing before a commercial launch.
- Flush roof rows are placed on one plane in the planner (each row higher than the one in front). On the 3D tiles each row is dropped onto the roof under it.
- Est. yield uses coarser shading cells (3 × 6 per panel) and reuses shading for sun positions within about 1.5°; energy differed from a full-cell run without reuse by 0.07–0.17% in three test scenes (open roof, tall tree close by, racked rows).
