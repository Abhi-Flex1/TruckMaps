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

## Add Capacitor (Android)

```bash
npm install @capacitor/core @capacitor/cli
npx cap init
npx cap add android
npm run build
npx cap copy
npx cap open android
```

When `npx cap init` asks for values:
- App name: `Truck Maps Italy`
- App ID example: `com.example.truckmapsitaly`
- Web assets directory: `dist`
