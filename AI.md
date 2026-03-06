# AI.md

## Project Summary
This app was built as a React + Vite + MapLibre truck map MVP for Italy, with local storage and no backend, then progressively upgraded with truck-aware routing, Italian UX, active navigation, voice prompts, and a simplified flow.

## Stack and Base Setup
- React + Vite project scaffolded from scratch.
- Map rendering with `maplibre-gl`.
- OpenStreetMap raster tiles (`tile.openstreetmap.org`).
- Local persistence via `localStorage`:
  - truck settings
  - marker GeoJSON (`FeatureCollection`)
- OSRM public API integration for routing.
- Nominatim geocoding integration for place search and route endpoints.

## Core MVP Features Implemented
- Full-screen Italy-centered map.
- Top search bar (places in Italy).
- Route planning from start to destination.
- Route polyline rendering on map.
- Truck settings panel (height, weight, length) saved locally.
- Map mark mode with modal:
  - marker types: avoid, caution, low bridge, narrow road, good truck road
  - optional note
- Saved markers panel with delete.
- Marker color mapping by type.
- Warnings when route passes near avoid/caution markers (~200m).

## Routing and Accuracy Upgrades
- Geocoding quality improvements:
  - Italy-bounded query behavior
  - scoring/ranking of multiple Nominatim candidates
- Endpoint snapping to drivable roads via OSRM `nearest`.
- Routing reliability:
  - timeout handling
  - retry for transient API failures
- Multiple OSRM alternatives enabled and evaluated.
- Overpass API added to fetch truck restrictions in route area:
  - `hgv=no`
  - `motor_vehicle=no`
  - `maxheight`
  - `maxweight`
  - `maxlength`
- Candidate route scoring added:
  - penalize truck-restricted segments
  - choose safest available route automatically
- Auto route recalculation when truck dimensions are changed.

## Navigation Features Added
- Step-by-step maneuver data from OSRM (`steps=true`) integrated.
- Italian maneuver text generation (turns, roundabouts, ramps, continue, arrive).
- Active navigation state:
  - current next instruction
  - distance to next maneuver
- Off-route detection based on distance from route polyline.
- Automatic rerouting trigger when deviating from route.
- Voice guidance using Web Speech API (`SpeechSynthesis`, `it-IT`).
- Voice toggle ON/OFF.

## GPS / Live Map Behavior
- Continuous geolocation tracking via `navigator.geolocation.watchPosition`.
- Live user state includes position, accuracy, heading, speed.
- Custom blue user dot marker on map.
- Animated pulse and accuracy circle around user location.
- Follow mode:
  - camera actively follows user position and heading
  - map drag disables follow
  - “Segui me” button re-enables follow immediately

## UI / UX Redesign Evolution
- Full app localization to Italian labels/messages.
- Major visual redesign inspired by Apple Maps style:
  - glassmorphism cards
  - soft gradients
  - compact controls
  - readable hierarchy
- Press/tap feedback:
  - button press animation
  - optional haptic vibration (`navigator.vibrate`) where supported
- App flow simplified for fast onboarding (<2 minutes goal):
  - mode switcher: `Naviga / Limiti / Segnali`
  - guided quick flow in navigation mode
  - reduced friction controls for GPS start, invert route, recenter, voice

## Component and Service Changes
- `src/components/MapView.jsx`
  - route rendering
  - endpoint markers
  - custom user blue dot + accuracy circle
  - follow mode logic
- `src/components/RoutePanel.jsx`
  - evolved into Italian route/nav control panel with step preview
- `src/components/MarkerModal.jsx`
  - Italian UI text and updated actions
- `src/components/TruckSettings.jsx`
  - Italian UI text and save flow
- `src/services/routing.js`
  - geocoding enhancements
  - road snapping
  - alternative route fetching
  - truck restriction retrieval from Overpass
  - richer step metadata for navigation
- `src/services/storage.js`
  - Italian marker labels
- `src/App.jsx`
  - orchestrates routing, truck scoring, navigation, rerouting, follow mode, voice, and simplified app flow
- `src/index.css`
  - complete visual and interaction redesign, including blue dot animation and minimal layout structure

## Build / Validation Status
- Production builds were run multiple times during changes.
- Current project builds successfully with:
  - `npm run build`

## Known Limitations
- Routing still depends on free/public APIs (OSRM + Nominatim + Overpass).
- Not equivalent to enterprise-grade Apple/Google live systems:
  - no proprietary real-time traffic/closure feeds
  - no dedicated commercial truck-routing backend
- Accuracy is improved significantly but still constrained by source data and public API availability.
