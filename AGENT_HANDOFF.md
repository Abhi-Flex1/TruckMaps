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

## Current UX (Latest)
- App language: Italian
- Major redesign completed (custom map HUD style)
- Top free-search bar removed from UI
- Active navigation header (`turn-banner`) now includes maneuver symbol + instruction + distance
- Bottom control panel:
  - modes: `Naviga / Limiti / Segnali`
  - top black handle now toggles hide/show on press (no swipe)
  - restore pill appears when hidden; press to restore
- Floating control:
  - old `Segui` and `Voce` chips removed
  - replaced with single circular recenter arrow button (`recenter-orb`) above bottom panel
- Voice flow:
  - after route calculation, app asks user whether to enable voice guidance for that route
  - separate always-visible voice toggle removed

## Route Input UX (Autocomplete)
- Start and destination fields in `Naviga` mode now have autocomplete dropdowns
- Suggestions come from Nominatim (Italy-bounded)
- Debounced requests with stale-response protection via request ids
- Selecting a suggestion fills the field and closes suggestions

## Routing and Safety Logic (Current)
- Route candidates fetched from OSRM alternatives (`alternatives=3`, `steps=true`)
- Start/destination snapped to road via OSRM nearest
- Restriction data fetched from Overpass in route envelope
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
- Restriction-route proximity threshold tightened (~18m) to reduce false positives
- Route scoring balances:
  - hard conflict penalties
  - soft conflict penalties
  - clearance to restrictions
  - preference for autostrada-like steps (`Axx`, `autostrada`, `raccordo`)
- Important: route is no longer fully blocked when no perfectly safe candidate exists.
  - Best candidate is still shown with warnings.
  - Navigation start is not blocked solely due to warnings.

## Perceived Routing Speed Improvements
- App now applies a preliminary route immediately after OSRM response (before Overpass analysis finishes)
- Truck-restriction analysis runs asynchronously in background
- Route/warnings are refined when restriction analysis completes (with timeout guard)
- This reduces waiting time before user sees a route

## Navigation Engine (Current)
- GPS tracking via `watchPosition`
- Step progression from nearest maneuver point
- Italian instruction generation per maneuver
- Top banner shows current instruction + icon
- Voice prompts near next maneuver (if enabled)
- Off-route detection by route polyline distance
- Auto reroute when off-route with cooldown

## Map Layer and Markers
- Basemap: OSM raster tiles
- Route rendering: white casing + blue core line
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
  - central orchestration: route request pipeline, restriction scoring, navigation state, voice prompt flow, mode UI
- `src/components/MapView.jsx`
  - map init, basemap source/layer, route drawing, endpoint markers, user dot, follow camera
- `src/components/TruckSettings.jsx`
  - truck dimensions form
- `src/components/MarkerModal.jsx`
  - add marker modal
- `src/services/routing.js`
  - geocoding, autocomplete, snapping, route candidates, Overpass restrictions
- `src/services/storage.js`
  - localStorage persistence for markers/settings
- `src/index.css`
  - full visual system, layout, transitions/animations, bottom panel and nav banner styles
- `src/main.jsx`
  - app bootstrap + SW registration/unregistration behavior

## Recent Major Changes (Chronological)
1. Initial MVP (React/Vite + map + routing + truck settings + markers)
2. Reliability improvements (geocode scoring, road snap, retries)
3. Truck restriction analysis and candidate scoring
4. Italian localization + active navigation + reroute + voice
5. PWA migration (removed Capacitor docs/workflow, added manifest/SW/icons)
6. Fix for stale SW behavior causing blank screens in local/dev
7. Full UI overhaul with animated HUD + redesigned bottom panel
8. Removed top search bar and old floating `Segui/Voce` buttons
9. Added circular recenter arrow control
10. Added post-route voice enable prompt
11. Added bottom-field autocomplete
12. Relaxed hard-block behavior and tuned scoring/proximity to reduce false "no truck roads" outcomes
13. Added autostrada preference in route selection
14. Introduced fast-first route rendering with async restriction refinement

## Known Constraints / Limitations
- Public APIs can be slow or unavailable (OSRM/Nominatim/Overpass)
- OSRM driving profile is not a dedicated commercial truck profile
- Overpass geometric matching remains heuristic (still possible false positives/negatives)
- SW/PWA behavior needs HTTPS in production for install prompt reliability
- In this coding environment, `node`/`npm` were unavailable, so recent changes were not runtime-tested here

## Immediate Next Steps (Recommended)
1. Add explicit multi-route UI (show 2-3 alternatives with risk badges) instead of auto-pick only.
2. Improve restriction precision by mapping route segments to OSM way IDs where feasible.
3. Add deterministic warning breakdown per selected route (hard vs soft reasons).
4. Add tests for:
   - autocomplete dropdown interactions
   - fast-first route + async refinement behavior
   - panel toggle (press handle and restore pill)
   - SW localhost unregister path
5. Add optional `beforeinstallprompt` install button for clearer Android install UX.

## Extra Notes for Next Agent
- `App.jsx` is still the central integration point and is large; edit carefully.
- If map appears blank, verify SW state first (especially non-localhost caches).
- Keep Italian UI copy consistent unless explicitly asked otherwise.
