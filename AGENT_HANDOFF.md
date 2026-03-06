# AGENT_HANDOFF.md

## Purpose
This document is a full handoff for another coding agent to continue work quickly.
It describes the app architecture, implemented behavior, key files, recent major changes, current constraints, and recommended next steps.

## Project Identity
- Name: `truck-maps-italy`
- Type: React + Vite web app (also intended for Capacitor Android packaging)
- Scope: Italy-only truck navigation support, no backend
- Data model: all local (localStorage), plus live data from public APIs

## Tech Stack
- React 19 + Vite
- MapLibre GL JS
- OpenStreetMap raster tiles
- OSRM public API (routing + nearest)
- Nominatim (search/geocoding)
- Overpass API (truck restriction tags)
- Web APIs:
  - Geolocation (`watchPosition`)
  - Speech Synthesis (`SpeechSynthesis`, Italian voice)
  - Optional vibration (`navigator.vibrate`)

## Run / Build
- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`

## Current UX (Latest)
- App language: Italian
- Minimal Apple Maps-inspired visual style maintained
- Live map with:
  - custom user blue dot
  - animated pulse
  - accuracy circle
  - follow-mode camera updates while moving
- Bottom panel:
  - hide/show via swipe gesture only (gray grabber line)
  - no explicit hide/show button
  - when hidden, collapsed grabber appears for swipe-up restore
- Navigation start behavior:
  - pressing `Avvia` auto-hides bottom panel
  - top navigation header appears and stays visible (cannot be hidden during active nav)
  - header shows active instruction + distance to next maneuver

## User Modes
- `Naviga`
- `Limiti`
- `Segnali`

These are inside the bottom sheet when visible.

## Truck Safety Logic (Current)
- Safety is prioritized over speed.
- Route candidates fetched from OSRM alternatives.
- Overpass restrictions fetched for route envelope.
- Restriction tags currently considered include:
  - `hgv=no`
  - `goods=no`
  - `access=no`
  - `vehicle=no`
  - `motor_vehicle=no`
  - `maxheight`
  - `maxheight:physical`
  - `maxweight`
  - `maxaxleload`
  - `maxlength`
- Truck defaults used when user does not fill all fields:
  - height: `4.0m`
  - weight: `18t`
  - length: `12m`
- Route selection:
  - candidates analyzed for hard truck conflicts
  - only fully safe candidates (`hardCount === 0`) are allowed
  - if no safe candidate exists: route is blocked and navigation cannot start
- Navigation guard:
  - `Avvia` is blocked if route is not fully truck-safe

## Navigation Engine (Current)
- Active GPS tracking via `watchPosition`
- Step progression computed from nearest maneuver point
- Voice prompts in Italian near upcoming maneuvers
- Off-route detection by distance from route polyline
- Auto reroute when sufficiently off route (cooldown applied)

## Marker / Local Data
- Marker GeoJSON stored in localStorage
- Truck settings stored in localStorage
- Marker types localized in Italian:
  - Da evitare
  - Attenzione
  - Ponte basso
  - Strada stretta
  - Strada consigliata

## Key Files and Responsibilities
- `src/App.jsx`
  - App orchestration, routing pipeline, truck-safety selection, navigation state, voice, mode flow
- `src/components/MapView.jsx`
  - Map initialization, route drawing, endpoint markers, live user dot + follow camera
- `src/components/MarkerModal.jsx`
  - Marker add modal (Italian)
- `src/components/TruckSettings.jsx`
  - Truck dimensions form (Italian)
- `src/services/routing.js`
  - Geocoding, route candidates, snap-to-road, Overpass restriction fetch
- `src/services/storage.js`
  - localStorage persistence and marker types
- `src/index.css`
  - full app styling, swipe grabber, floating controls, nav header, blue dot animation

## Handoff History (Major Change Timeline)
1. Created full MVP from empty workspace (React/Vite, map, markers, settings, routing).
2. Added Capacitor-ready setup docs and build flow.
3. Improved route reliability (geocode scoring, snap-to-road, retries).
4. Added truck-aware alternative selection with Overpass restrictions.
5. Added Italian localization and navigation UI.
6. Added active navigation with GPS, step updates, voice prompts, rerouting.
7. Redesigned to minimal mode-based flow (`Naviga/Limiti/Segnali`) with live follow map.
8. Added strict safety-first ranking and then hard safety block when no safe route exists.
9. Replaced bottom hide button with swipe gray grabber gesture.
10. Added persistent top navigation header + auto-hide bottom panel on start.

## Known Constraints / Limitations
- Public APIs are used; accuracy and availability depend on external services.
- OSRM is not a dedicated commercial truck router; restrictions are approximated using Overpass tags + route proximity heuristics.
- No live proprietary incident feed (unlike Apple/Google production systems).
- Bundle size warning still present in build (MapLibre + app logic), not currently code-split.

## Immediate Next Steps (Recommended)
1. Improve restriction matching precision:
   - map OSRM step/edge names to OSM way IDs where possible
   - reduce geometric false positives/false negatives
2. Add deterministic route rejection UI with explicit reason list per candidate.
3. Add one-time onboarding tooltip for swipe gesture discoverability.
4. Add E2E tests for:
   - no-safe-route block
   - bottom sheet swipe behavior
   - nav header persistence during active navigation
5. Optional: introduce code-splitting to reduce first-load JS.

## Extra Notes for Next Agent
- There is also an `AI.md` file summarizing prior milestones.
- Prefer editing `App.jsx` carefully; it currently centralizes most behavior.
- If changing gesture behavior, keep both mouse and touch handlers.
- Maintain Italian language consistency unless explicitly requested otherwise.
