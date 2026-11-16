# ARIEN web app

The website around the digital twin: landing pages, accounts, and the pages that host each user's twin and dashboard.
It is a rebuild of the Base44 site (arien.base44.app, captured 16 Nov 2026) as plain static files that any web host can serve.

Live: https://madarapremawardhana.github.io/arien-twin/web/

## What it does

- **Same look.** The pages, styles and copy of the Base44 site: landing page (search, 48-hour preview, globe), plans, contact, accuracy, legal pages, log in, register, password reset.
- **Sky theme by place and time.** The colours are dawn, day, dusk or night from the sun's height where the user is.
  - The place comes from, in order: the user's last saved site, their last search, the device's location (asked for on the landing page, as on the original), otherwise the clock.
  - Below -6° the sky is night and above 6° it is day. Between them it is dawn before solar noon and dusk after.
  - Settings can pin "Always day" or "Always night". The theme is re-checked every 5 minutes.
- **Accounts.** Sign-up (with the emailed code), log in, Google sign-in and password reset use the ARIEN Base44 app's API. These are the same accounts and saved sites as on arien.base44.app.
- **A twin for each user.** "Open Digital Twin" (`twin/`) and "Dashboard" (`dashboard/`) embed the twin at `#design` and `#dashboard`.
  - The twin keeps the user's project in their account through the page around it. Save, open, delete, plan limits and results all go through this page.
  - The twin is never sent the token, password or email. Note: on GitHub Pages the twin and this site share one origin, so that separation is by code only. On separate domains (for example `app.` and `twin.`) the browser enforces it.
  - Switching between the two changes only the twin's address fragment, so the twin does not reload.
  - With no site asked for, the twin opens the project the user last worked on.
  - `twin/?lat=…&lng=…&q=…` starts a new design at that place.

## Google sign-in

Base44 only returns a Google sign-in to its own app's address. Any other return address ends in `"Domain is not valid"`, and Base44 has no setting to allow more (an open request on its feedback board, checked 16 Nov 2026).

So "Continue with Google" returns to a relay page in the Base44 app (`ssoRelay` in `config.js`, `https://arien.base44.app/sso-return`). That page sends the browser on to this site's home page with the session in the address fragment. This site's first script stores it, removes it from the address and goes to the page the user was heading for.

The relay page must exist in the Base44 app. Prompt for Base44's AI chat:

```
Add a public page at /sso-return (no header, no footer, no login required). It hands a finished sign-in to our own frontend.
On load, read the access token: first the access_token URL parameter if present, otherwise localStorage.getItem('base44_access_token').
- If there is a token: window.location.replace('https://madarapremawardhana.github.io/arien-twin/web/#access_token=' + encodeURIComponent(token)).
  The destination is this fixed constant. Never read it from the URL or anywhere else.
- If there is no token: show "Sign-in did not complete." with a link "Back to Arien" to https://madarapremawardhana.github.io/arien-twin/web/login/.
Never display or log the token. While redirecting, show only "Signing you in…".
```

If this site moves to another address, change the constant in that page to the new home page.

## Contact emails

The contact form, the Pro waitlist and academic applications are emailed to `contactEmail` in `config.js`, through the Base44 app's built-in sender (`Core.SendEmail`), and still saved as records in Base44.

- The built-in sender only delivers to people who have signed up to the app, so `contactEmail` must be a registered user of the ARIEN app.
- Emails come from `no-reply@base44-apps.com` and use about one Base44 integration credit each.
- The address is readable in the site's source, and the sender accepts calls from signed-out visitors (the form is public), so the inbox can be spammed. A Base44 workflow or backend function triggered by new records would keep the address private.

## Settings

`config.js` holds the app id, the account service address and the twin's address. Nothing in it is secret.

If the site moves to its own domain, add that origin to `PARENTS` in the twin's `src/account.js` and rebuild the twin, or the twin will not talk to the new page.

## Build

```
npm install         # once: esbuild, three, leaflet, suncalc
python3 build.py    # src/ -> index.html, <page>/index.html, assets/
```

The built files are committed, because GitHub Pages serves the repository as it is. Links are relative, so the folder works from any path or domain.

```
src/pages/       page bodies (HTML)
src/partials/    header, footer, logo mark
src/css/         captured.css (the Base44 site's styles), extra.css (additions)
src/globe/       ARIEN's three.js Earth: day/night shader and textures (used by src/js/globe.js)
src/js/          app.js (entry), theme.js, api.js, nav.js, home.js, forecast.js, globe.js, minimap.js,
                 plans.js, contact.js, notify.js, authpages.js, twinhost.js, settings.js, modal.js, core.js
config.js        settings (served as is)
build.py         templates + esbuild
test/            web_check.py: headless check with the account service mocked
```

## Test

From the repository root, with the twin's test dependencies (`ARIEN_DEPS`, see the main README):

```
ARIEN_DEPS=node_modules python3 web/test/web_check.py /tmp/web
```

60 checks cover: the theme by clock and by place, search and preview, sign-up, log-in and return, saving from the twin into the account, the one-site plan limit, the dashboard switch without a reload, settings, plans, contact, a second user's isolation, and phone layout.

## Differences from the Base44 site

- **Designer and dashboard are the twin.** Base44's own `/design`, `/forecast` and `/reports` pages are not rebuilt.
- **Preview physics.** The landing preview uses the same model and constants as the Base44 preview, with two corrections. Both need PV Science sign-off:
  - The panel normal follows the stated tilt. The Base44 code builds the normal as if the panel were tilted 90° minus the tilt. For a 35° south-facing panel at 52°N on a clear day, that reads about 20% high in November and about 14% low in June (a simple clear-sky comparison, 16 Nov 2026). The same function feeds the Base44 designer's yearly yield.
  - Hours are treated in the site's own time zone.
- **Settings** has display name, sky theme, plan and sign-out only.
- **Sign-out** clears this browser's session and does not call the account service.
- **Legal pages** still say "[To be completed]", as on the original.

## Still to check with a real account

- Google sign-in end to end, once the relay page above is added to the Base44 app.
- The password-reset email: its link opens the reset page on arien.base44.app.
- Row-level security on SolarSite in Base44 (read, update and delete only by the creator). This page also refuses ids that are not in the user's own list, but the server rule is what protects the data.
- The one-site limit for the Household plan is enforced by this page, as it was on Base44, not by the server.

## Third-party

three.js (MIT), Leaflet (BSD-2-Clause), SunCalc (BSD-2-Clause); licence notices are in `assets/chunks/*.LEGAL.txt`.
The globe is ARIEN's own three.js Earth (`src/globe`). Its textures are from the three.js examples; the unused clouds texture is not shipped.
Fonts come from Google Fonts. Map tiles and place search come from OpenStreetMap (Nominatim: light use only). Weather comes from Open-Meteo (free API: non-commercial).
