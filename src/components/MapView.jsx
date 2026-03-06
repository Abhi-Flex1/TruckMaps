import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MARKER_TYPES } from "../services/storage";

const EMPTY_ROUTE = {
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [] }
};

function MapView({
  markers,
  routeGeometry,
  routeEndpoints,
  truckRestrictions,
  userLocation,
  followUser,
  markMode,
  onMapTap,
  onMapReady,
  onFollowDisabled
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRefs = useRef([]);
  const routeMarkerRefs = useRef([]);
  const userMarkerRef = useRef(null);
  const accuracySourceReadyRef = useRef(false);
  const markModeRef = useRef(markMode);
  const onFollowDisabledRef = useRef(onFollowDisabled);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const restrictionsGeoJson = useMemo(
    () => ({
      type: "FeatureCollection",
      features: (truckRestrictions || [])
        .filter((restriction) => Array.isArray(restriction.geometry) && restriction.geometry.length > 0)
        .flatMap((restriction) => {
          const coords = restriction.geometry.map((point) => [point.lon, point.lat]);
          const firstPoint = restriction.geometry[0];
          const lineFeature =
            coords.length >= 2
              ? [
                  {
                    type: "Feature",
                    properties: { id: restriction.id, kind: "line" },
                    geometry: {
                      type: "LineString",
                      coordinates: coords
                    }
                  }
                ]
              : [];
          const pointFeature = firstPoint
            ? [
                {
                  type: "Feature",
                  properties: { id: restriction.id, kind: "point" },
                  geometry: {
                    type: "Point",
                    coordinates: [firstPoint.lon, firstPoint.lat]
                  }
                }
              ]
            : [];
          return [...lineFeature, ...pointFeature];
        })
    }),
    [truckRestrictions]
  );

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
      map.addSource("truck-restrictions", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: []
        }
      });
      map.addLayer({
        id: "truck-restrictions-line",
        type: "line",
        source: "truck-restrictions",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#ff2b2b",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            2.2,
            14,
            5.4
          ],
          "line-opacity": 0.78
        }
      });
      map.addLayer({
        id: "truck-restrictions-point",
        type: "circle",
        source: "truck-restrictions",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            3.4,
            14,
            7.6
          ],
          "circle-color": "#ff2b2b",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.2,
          "circle-opacity": 0.88
        }
      });

      map.addSource("user-accuracy", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: []
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
    if (!map || !isMapLoaded) return;
    const source = map.getSource("truck-restrictions");
    if (!source) return;
    source.setData(restrictionsGeoJson);
  }, [isMapLoaded, restrictionsGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];

    markers.features.forEach((feature) => {
      if (feature.geometry?.type !== "Point") return;
      const [lon, lat] = feature.geometry.coordinates;
      const type = feature.properties?.type || "caution";

      const el = document.createElement("button");
      el.className = "map-marker";
      el.style.backgroundColor = MARKER_TYPES[type]?.color || "#666";
      el.title = feature.properties?.note || MARKER_TYPES[type]?.label || type;

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .addTo(map);

      markerRefs.current.push(marker);
    });
  }, [markers]);

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

    if (followUser) {
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

export default MapView;
