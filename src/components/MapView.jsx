import { memo, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const EMPTY_ROUTE = {
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [] }
};

function metersBetween(a, b) {
  const dLat = (b.lat - a.lat) * 110540;
  const dLon = (b.lon - a.lon) * (111320 * Math.cos((a.lat * Math.PI) / 180));
  return Math.hypot(dLat, dLon);
}

function MapView({
  markers,
  routeGeometry,
  routeEndpoints,
  userLocation,
  followUser,
  markMode,
  onMapTap,
  onMapReady,
  onFollowDisabled
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const routeMarkerRefs = useRef([]);
  const userMarkerRef = useRef(null);
  const accuracySourceReadyRef = useRef(false);
  const markersSourceReadyRef = useRef(false);
  const markModeRef = useRef(markMode);
  const onFollowDisabledRef = useRef(onFollowDisabled);
  const lastFollowStateRef = useRef(null);
  const lastFollowTsRef = useRef(0);
  const lastAccuracyKeyRef = useRef("");
  const [isMapLoaded, setIsMapLoaded] = useState(false);

  useEffect(() => {
    markModeRef.current = markMode;
  }, [markMode]);

  useEffect(() => {
    onFollowDisabledRef.current = onFollowDisabled;
  }, [onFollowDisabled]);

  useEffect(() => {
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap contributors"
          }
        },
        layers: [
          {
            id: "basemap",
            type: "raster",
            source: "osm"
          }
        ]
      },
      center: [12.5674, 41.8719],
      zoom: 5.2
    });

    map.on("load", () => {
      // Route source/layer is managed once and only the GeoJSON data changes later.
      map.addSource("route", {
        type: "geojson",
        data: EMPTY_ROUTE
      });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#ffffff",
          "line-width": 11,
          "line-opacity": 0.95
        }
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#0071e3",
          "line-width": 7.5,
          "line-opacity": 0.9
        }
      });
      map.addSource("user-accuracy", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: []
        }
      });
      map.addSource("user-markers", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: []
        },
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 48
      });
      map.addLayer({
        id: "user-markers-clusters",
        type: "circle",
        source: "user-markers",
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": [
            "step",
            ["get", "point_count"],
            14,
            10,
            18,
            30,
            24
          ],
          "circle-color": "#30343a",
          "circle-stroke-width": 1.4,
          "circle-stroke-color": "#ffffff"
        }
      });
      map.addLayer({
        id: "user-markers-cluster-count",
        type: "symbol",
        source: "user-markers",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"]
        },
        paint: {
          "text-color": "#ffffff"
        }
      });
      map.addLayer({
        id: "user-markers-circle",
        type: "circle",
        source: "user-markers",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 6,
          "circle-stroke-width": 1.3,
          "circle-stroke-color": "#ffffff",
          "circle-color": [
            "match",
            ["get", "type"],
            "avoid", "#e53935",
            "caution", "#fb8c00",
            "low bridge", "#8e24aa",
            "narrow road", "#3949ab",
            "good truck road", "#43a047",
            "#666666"
          ]
        }
      });
      map.addLayer({
        id: "user-accuracy-fill",
        type: "fill",
        source: "user-accuracy",
        paint: {
          "fill-color": "#3f8cff",
          "fill-opacity": 0.12
        }
      });
      map.addLayer({
        id: "user-accuracy-line",
        type: "line",
        source: "user-accuracy",
        paint: {
          "line-color": "#3f8cff",
          "line-width": 1.5,
          "line-opacity": 0.36
        }
      });
      accuracySourceReadyRef.current = true;
      markersSourceReadyRef.current = true;
      setIsMapLoaded(true);
    });

    map.on("click", (event) => {
      if (!markModeRef.current) return;
      onMapTap({ lon: event.lngLat.lng, lat: event.lngLat.lat });
    });

    map.on("dragstart", () => {
      const disableFollow = onFollowDisabledRef.current;
      if (disableFollow) disableFollow();
    });

    mapRef.current = map;
    onMapReady(map);

    return () => {
      map.remove();
    };
  }, [onMapReady, onMapTap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded) return;
    const source = map.getSource("route");
    if (!source) return;

    const data = routeGeometry
      ? {
          type: "Feature",
          properties: {},
          geometry: routeGeometry
        }
      : EMPTY_ROUTE;

    source.setData(data);
  }, [isMapLoaded, routeGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded || !markersSourceReadyRef.current) return;
    const source = map.getSource("user-markers");
    if (!source) return;
    source.setData(markers);
  }, [isMapLoaded, markers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    routeMarkerRefs.current.forEach((marker) => marker.remove());
    routeMarkerRefs.current = [];
    if (!routeEndpoints?.start || !routeEndpoints?.destination) return;

    const startEl = document.createElement("div");
    startEl.className = "route-endpoint start";
    startEl.textContent = "S";
    const destinationEl = document.createElement("div");
    destinationEl.className = "route-endpoint destination";
    destinationEl.textContent = "D";

    const startMarker = new maplibregl.Marker({ element: startEl })
      .setLngLat([routeEndpoints.start.lon, routeEndpoints.start.lat])
      .addTo(map);
    const destinationMarker = new maplibregl.Marker({ element: destinationEl })
      .setLngLat([routeEndpoints.destination.lon, routeEndpoints.destination.lat])
      .addTo(map);

    routeMarkerRefs.current.push(startMarker, destinationMarker);
  }, [routeEndpoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded || !userLocation) return;

    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "user-blue-dot";
      el.innerHTML = '<span class="user-blue-dot-core"></span><span class="user-blue-dot-pulse"></span>';
      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([userLocation.lon, userLocation.lat])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([userLocation.lon, userLocation.lat]);
    }

    if (accuracySourceReadyRef.current) {
      const accuracyMeters = Math.min(Math.max(userLocation.accuracy || 16, 8), 80);
      const accuracyKey = [
        userLocation.lon.toFixed(5),
        userLocation.lat.toFixed(5),
        Math.round(accuracyMeters)
      ].join(":");
      if (accuracyKey === lastAccuracyKeyRef.current) {
        // Skip source updates when effective circle does not change.
      } else {
        lastAccuracyKeyRef.current = accuracyKey;
      const circle = {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            Array.from({ length: 42 }, (_, i) => {
              const bearing = (i / 41) * Math.PI * 2;
              const dx = accuracyMeters * Math.cos(bearing);
              const dy = accuracyMeters * Math.sin(bearing);
              const dLat = dy / 110540;
              const dLon = dx / (111320 * Math.cos((userLocation.lat * Math.PI) / 180));
              return [userLocation.lon + dLon, userLocation.lat + dLat];
            })
          ]
        }
      };
      const accuracySource = map.getSource("user-accuracy");
      if (accuracySource) {
        accuracySource.setData({
          type: "FeatureCollection",
          features: [circle]
        });
      }
      }
    }

    if (followUser) {
      const now = Date.now();
      const minIntervalMs = 550;
      const previous = lastFollowStateRef.current;
      const movedMeters = previous
        ? metersBetween(
            { lat: previous.lat, lon: previous.lon },
            { lat: userLocation.lat, lon: userLocation.lon }
          )
        : Infinity;
      const headingDelta = previous
        ? Math.abs((userLocation.heading ?? previous.heading ?? 0) - (previous.heading ?? 0))
        : 999;
      const shouldSkip =
        previous &&
        now - lastFollowTsRef.current < minIntervalMs &&
        movedMeters < 5 &&
        headingDelta < 12;
      if (shouldSkip) return;

      lastFollowStateRef.current = {
        lat: userLocation.lat,
        lon: userLocation.lon,
        heading: Number.isFinite(userLocation.heading) ? userLocation.heading : null
      };
      lastFollowTsRef.current = now;
      map.easeTo({
        center: [userLocation.lon, userLocation.lat],
        duration: 650,
        zoom: Math.max(map.getZoom(), 15.5),
        bearing: Number.isFinite(userLocation.heading) ? userLocation.heading : map.getBearing(),
        pitch: 50
      });
    }
  }, [followUser, isMapLoaded, userLocation]);

  return <div ref={mapContainerRef} className={markMode ? "map mark-mode" : "map"} />;
}

export default memo(MapView);
