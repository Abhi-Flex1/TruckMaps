# AGENT_HANDOFF.md

## Purpose
This handoff captures the current implementation after a performance-focused rewrite.
It is intended to let the next agent continue quickly without reverse-engineering the app.

## Project Identity
- Name: `truck-maps-italy`
- Type: React + Vite PWA
- Scope: Italy-only truck navigation assistant (frontend-only)
- Data model: localStorage + public map/routing/geocoding APIs

## Current Status (As Of This Handoff)
- Red restriction overlays/lines are fully removed from map rendering.
- Truck restrictions are still used in route scoring logic (not drawn on map).
- Core architecture was refactored from a monolithic `App.jsx` into modules/hooks.
- Build is passing locally with `npm run build`.

## Stack
- React 19 + Vite 7
- MapLibre GL JS
- OSM raster tiles (`tile.openstreetmap.org`)
- OSRM public API (route + nearest)
- Nominatim (geocode + autocomplete)
- Overpass API (restriction tags for route safety scoring)
- Browser APIs:
  - Geolocation (`watchPosition`)
  - Speech synthesis (`SpeechSynthesis`)
  - Service Worker + Web App Manifest

## Run / Build
- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`

## Architectural Rewrite Summary

### Before
- `src/App.jsx` contained:
  - geometry math
  - navigation step logic
  - truck restriction scoring
  - geolocation and autocomplete side effects
  - UI orchestration

### After
- `src/App.jsx` now orchestrates state/UI and delegates logic to reusable modules.
- New modules:
  - `src/lib/geo.js`
    - `haversineMeters`, route distance helpers, bbox helpers
  - `src/lib/navigation.js`
    - instruction generation, step symbols, truck normalization, candidate scoring, next-step resolution
  - `src/hooks/useDebouncedPlaces.js`
    - debounced/stale-safe autocomplete flow
  - `src/hooks/useUserLocation.js`
    - geolocation watcher lifecycle

## Performance Changes
1. App-level code splitting:
- `MapView` is lazy-loaded via `React.lazy` + `Suspense`.
- Effect: initial entry chunk is much smaller; heavy map bundle loads when needed.

2. Reduced parent re-render pressure:
- `MapView` exported with `memo(...)`.
- Stable callbacks introduced for follow toggle and other handlers.

3. Side effects moved into hooks/modules:
- Better separation lowered `App.jsx` complexity and reduced unnecessary effect churn.

4. Metrics from current build:
- Main chunk now around `~219 KB` (was previously over `1.2 MB` monolith bundle).
- Map chunk now isolated (~`1.0 MB`) and deferred.

## Key Files (Current Responsibilities)
- `src/App.jsx`
  - app orchestration, route request lifecycle, navigation controls, mode panels, modal flow
- `src/components/MapView.jsx`
  - map init/render, route drawing, endpoint markers, user location dot, follow-camera behavior
- `src/components/TruckSettings.jsx`
  - truck profile form (height/weight/length)
- `src/components/MarkerModal.jsx`
  - marker creation modal
- `src/services/routing.js`
  - geocode/autocomplete/snap/route-candidate fetch + Overpass restriction fetch
- `src/services/storage.js`
  - localStorage read/write for markers + truck settings
- `src/lib/geo.js`
  - geometry/math utilities
- `src/lib/navigation.js`
  - route analysis/navigation instruction utilities
- `src/hooks/useDebouncedPlaces.js`
  - debounced autocomplete hook
- `src/hooks/useUserLocation.js`
  - geolocation hook
- `src/main.jsx`
  - app bootstrap + SW registration/unregistration behavior

## UX Behavior (Current)
- Italian UI
- Modes: `Naviga`, `Limiti`, `Segnali`
- Voice start confirmation modal still present
- Route is applied quickly first, then refined after Overpass scoring completes
- Route warnings remain hidden in UI (safety affects scoring, not warning panels)
- No red truck restriction overlays on map

## Known Constraints
- Public APIs (OSRM/Nominatim/Overpass) are rate-limited and can timeout.
- OSRM profile is general driving, not a commercial truck engine.
- Overpass matching is heuristic and can be noisy.
- PWA behavior can serve stale assets outside localhost (service worker cache).

## Validation Performed
- `npm run build` completed successfully after rewrite.
- Bundle output confirms map code splitting and reduced main chunk size.

## Recommended Next Steps
1. Add unit tests for pure logic in `src/lib/navigation.js` and `src/lib/geo.js`.
2. Add integration tests for voice-start flow and reroute cooldown behavior.
3. Consider dynamic import for Overpass-heavy logic to further reduce map chunk cost.
4. Remove `src/components/RoutePanel.jsx` if confirmed unused.
5. Consider worker/off-main-thread analysis for route scoring if route alternatives increase.

## Notes For Next Agent
- Prefer extending logic in `lib/` and `hooks/` rather than re-expanding `App.jsx`.
- Keep copy in Italian unless asked otherwise.
- If app seems stale in production, verify service-worker cache state first.
