# AGENT_HANDOFF.md

## Purpose
This document is a full handoff for another coding agent to continue work quickly.
It captures the current architecture, behavior, key files, recent major changes, constraints, and recommended next steps.

## Project Identity
- Name: `truck-maps-italy`
- Type: React + Vite web app with PWA install support
- Scope: Italy-only truck navigation support, no backend
- Data model: local-only state (`localStorage`) plus live public API data

## Tech Stack
- React 19 + Vite
- MapLibre GL JS
- OpenStreetMap raster tiles (`tile.openstreetmap.org`)
- OSRM public API (routing + nearest)
- Nominatim (geocoding + autocomplete)
- Overpass API (truck restriction tags)
- Web APIs:
  - Geolocation (`watchPosition`)
  - Speech Synthesis (`SpeechSynthesis`, Italian voice)
  - Service Worker + Web App Manifest (PWA)

## Run / Build
- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`

## PWA Setup (Current)
- Manifest: `public/manifest.webmanifest`
- Service worker: `public/sw.js`
- Icons: `public/icons/icon-192.png`, `public/icons/icon-512.png`
- SW registration: `src/main.jsx`
  - On localhost/127.0.0.1/::1, existing service workers are unregistered to avoid stale-cache blank screen during dev.
  - On non-localhost, SW is registered normally.
- `index.html` includes:
  - manifest link
  - theme color
  - apple touch icon/web-app meta tags
  - viewport set to `width=device-width, initial-scale=1.0, viewport-fit=cover`

## Current UX (Latest)
- App language: Italian
- Top `Navigator Pro` HUD bar has been removed.
- Active navigation header (`turn-banner`) includes maneuver symbol + instruction + distance.
- Bottom control panel:
  - modes: `Naviga / Limiti / Segnali`
  - top handle toggles hide/show on press
  - restore pill appears when hidden
- Floating control:
  - single circular recenter button (`recenter-orb`)
  - recenter now forces immediate camera `easeTo` each tap (not only follow-state toggle)
- Voice flow:
  - pressing `Avvia navigazione` opens a modal popup
  - user chooses `Si, avvia con voce` or `No, avvia senza voce`
  - navigation starts only after this choice
- Route warnings UI has been removed (no warning panel or warning text shown).
- Truck restriction red indicators are loaded country-wide (Italy) in background and are visible even without active navigation.
  - plus viewport-priority fetch on map load/move for immediate local visibility while country preload continues.

## Route Input UX (Autocomplete)
- Start and destination fields in `Naviga` mode have autocomplete dropdowns.
- Suggestions come from Nominatim (Italy-bounded).
- Debounced requests with stale-response protection via request IDs.
- Selecting a suggestion fills the field and closes suggestions.

## Routing and Safety Logic (Current)
- Route candidates fetched from OSRM alternatives (`alternatives=3`, `steps=true`).
- Start/destination snapped to road via OSRM nearest.
- Restriction data fetched from Overpass in route envelope.
- Restriction tags considered:
  - `hgv=no`
  - `goods=no`
  - `motor_vehicle=no`
  - `access=no`
  - `vehicle=no`
  - `maxheight`, `maxheight:physical`
  - `maxaxleload`
  - `maxweight`
  - `maxlength`
- Truck defaults when fields are empty:
  - height: `4.0m`
  - weight: `18t`
  - length: `12m`

### Safety Scoring Behavior
- Hard restrictions:
  - `hgv=no`, `goods=no`, `motor_vehicle=no`, and dimension/weight over-limits
- Soft restrictions:
  - `access=no`, `vehicle=no`
- Restriction-route proximity threshold ~18m.
- Route scoring balances:
  - hard conflict penalties
  - soft conflict penalties
  - clearance to restrictions
  - preference for autostrada-like steps (`Axx`, `autostrada`, `raccordo`)
- Important current behavior:
  - app always applies the best-scored candidate
  - warning surfaces/messages are intentionally hidden in UI

## Perceived Routing Speed Improvements
- App applies a preliminary route immediately after OSRM response (before Overpass analysis finishes).
- Restriction analysis runs asynchronously in background.
- Route is refined when restriction analysis completes (with timeout guard).

## Navigation Engine (Current)
- GPS tracking via `watchPosition`
- Step progression from nearest maneuver point
- Italian instruction generation per maneuver
- Voice prompts near next maneuver (if enabled)
- Off-route detection by route polyline distance
- Auto reroute when off-route with cooldown

## Map Layer and Markers
- Basemap: OSM raster tiles
- Route rendering: white casing + blue core line
- New overlay: truck-restriction geometry rendered in red across Italy (route-independent preload)
  - line layer for restricted road ways
  - point layer for restriction anchors
- Endpoint markers: `S` / `D`
- User marker: blue dot + pulse + accuracy circle
- Marker data persisted in localStorage
- Marker types localized:
  - Da evitare
  - Attenzione
  - Ponte basso
  - Strada stretta
  - Strada consigliata

## Key Files and Responsibilities
- `src/App.jsx`
  - central orchestration: route request pipeline, restriction scoring, country-wide restriction preload, navigation state, voice prompt modal flow, recenter handling, mode UI
- `src/components/MapView.jsx`
  - map init, basemap source/layer, route drawing, truck restriction overlay drawing, endpoint markers, user dot, follow camera
- `src/components/TruckSettings.jsx`
  - truck dimensions form
- `src/components/MarkerModal.jsx`
  - add marker modal
- `src/services/routing.js`
  - geocoding, autocomplete, snapping, route candidates, Overpass restrictions
- `src/services/storage.js`
  - localStorage persistence for markers/settings
- `src/index.css`
  - full visual system (now monochrome iOS-like), layout, transitions/animations
- `src/main.jsx`
  - app bootstrap + SW registration/unregistration behavior

## Detailed Session Changelog (All Changes Made)
1. Replaced `src/index.css` visual system with a full redesign (new gradients, controls, cards, modal, motion system, responsive behavior).
2. Updated `index.html` viewport meta to include `viewport-fit=cover`.
3. Enforced `font-size: 16px` on inputs/selects/textarea to prevent mobile zoom-on-focus.
4. Restructured `App.jsx` layout (navigate panel split into main form + side insight card; updated pane composition).
5. Changed voice UX: removed inline voice card and added start-navigation modal popup flow.
6. Added explicit start helpers in `App.jsx`: `beginNavigation` and `confirmVoiceAndStart`.
7. Removed in-panel warnings display and warning state usage from `App.jsx`.
8. Changed route hint copy to neutral non-warning messaging (`Ottimizzazione in corso`, `Percorso ottimizzato`).
9. Fixed recenter reliability by adding `handleRecenter` that always triggers immediate `map.easeTo(...)` when possible.
10. Added truck restriction map overlay support:
   - `App.jsx` stores `mapRestrictions` and passes to map.
   - `MapView.jsx` adds `truck-restrictions` GeoJSON source.
   - `MapView.jsx` adds red line and red point layers and updates them reactively.
   - `App.jsx` preloads restrictions for all Italy via chunked tiled Overpass requests.
   - `App.jsx` also fetches restriction data for the current viewport on load and `moveend` for immediate visibility and merges results with country preload cache.
11. Converted theme to monochrome iOS-like styling in `src/index.css`:
   - switched font stack to SF/Apple system stack
   - replaced colorful palette with grayscale tokens
   - updated HUD/panel/buttons/cards/modals/chips/controls to monochrome glass style
   - updated orb and pulse/shadow colors to grayscale variants
12. Removed top HUD bar from `App.jsx` that displayed `Truck Maps Italia / Navigator Pro / status`.

## Known Constraints / Limitations
- Public APIs can be slow or unavailable (OSRM/Nominatim/Overpass).
- OSRM driving profile is not a dedicated commercial truck profile.
- Overpass geometric matching remains heuristic (still possible false positives/negatives).
- SW/PWA behavior needs HTTPS in production for install prompt reliability.
- In this coding environment, `node`/`npm` were unavailable, so runtime build/test validation could not be executed.
- `src/index.css` still contains some unused selectors for removed HUD/warnings (`.top-hud`, `.hud-*`, `.alert-stack*`), safe to clean up later.

## Immediate Next Steps (Recommended)
1. Remove dead CSS selectors related to removed HUD/warning UI.
2. Add toggle to show/hide restriction overlay (currently always shown when available).
3. Add explicit multi-route UI (visual alternatives instead of auto-pick only).
4. Add tests for:
   - voice-start modal flow
   - recenter button behavior (force camera recenter)
   - restriction overlay render/update lifecycle
   - panel hide/show + restore pill
5. Validate UI on real iOS Safari and Android Chrome after installing `npm` locally.

## Extra Notes for Next Agent
- `App.jsx` remains the central integration file and is large; edit carefully.
- Map restriction overlay expects Overpass geometry array format from `routing.js`.
- If map appears blank, verify service worker state/caches first (especially outside localhost).
- Keep Italian UI copy consistent unless explicitly requested otherwise.
