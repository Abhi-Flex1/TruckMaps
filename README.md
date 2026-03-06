# Truck Maps Italy (MVP)

Minimal React + Vite truck-focused map app for Italy using:
- MapLibre GL JS
- OpenStreetMap raster tiles
- OSRM public API (routing)
- Local browser storage only (no backend)

## Install and run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Progressive Web App (Android Install)

- PWA manifest: `public/manifest.webmanifest`
- Service worker: `public/sw.js`
- Icons: `public/icons/icon-192.png`, `public/icons/icon-512.png`
- Service worker registration: `src/main.jsx`

To get the Android Chrome install prompt:
1. Deploy on HTTPS.
2. Open the site in Chrome on Android.
3. Use enough engagement (or menu > `Install app`) to trigger install.

App updates are delivered from the website automatically when users reload and the new web build is available.
