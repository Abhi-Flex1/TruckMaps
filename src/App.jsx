import { useCallback, useEffect, useRef, useState } from "react";
import MapView from "./components/MapView";
import MarkerModal from "./components/MarkerModal";
import TruckSettings from "./components/TruckSettings";
import {
  autocompletePlaces,
  fetchRouteCandidates,
  fetchTruckRestrictionsForBBox,
  geocodePlace
} from "./services/routing";
import {
  MARKER_TYPES,
  addMarker,
  loadMarkers,
  loadTruckSettings,
  removeMarkerById,
  saveTruckSettings
} from "./services/storage";

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function projectToWebMercator(point) {
  const x = (point.lon * 20037508.34) / 180;
  const y =
    Math.log(Math.tan(((90 + point.lat) * Math.PI) / 360)) / (Math.PI / 180);
  return { x, y: (y * 20037508.34) / 180 };
}

function pointToSegmentMeters(point, start, end) {
  const p = projectToWebMercator(point);
  const a = projectToWebMercator(start);
  const b = projectToWebMercator(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))
  );
  const projection = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(p.x - projection.x, p.y - projection.y);
}

function minDistanceToRouteMeters(point, routeCoordinates) {
  if (routeCoordinates.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < routeCoordinates.length - 1; i += 1) {
    const segmentDistance = pointToSegmentMeters(
      point,
      { lon: routeCoordinates[i][0], lat: routeCoordinates[i][1] },
      { lon: routeCoordinates[i + 1][0], lat: routeCoordinates[i + 1][1] }
    );
    min = Math.min(min, segmentDistance);
  }
  return min;
}

function italianInstructionForStep(step) {
  const type = step?.maneuver?.type || "";
  const modifier = step?.maneuver?.modifier || "";
  const via = step?.name ? ` su ${step.name}` : "";
  if (type === "depart") return `Parti${via}`;
  if (type === "arrive") return "Sei arrivato a destinazione";
  if (type === "roundabout") return `Alla rotonda prendi l'uscita${via}`;
  if (type === "turn") {
    if (modifier === "left") return `Svolta a sinistra${via}`;
    if (modifier === "right") return `Svolta a destra${via}`;
    if (modifier === "slight left") return `Tieni leggermente a sinistra${via}`;
    if (modifier === "slight right") return `Tieni leggermente a destra${via}`;
    if (modifier === "sharp left") return `Svolta decisa a sinistra${via}`;
    if (modifier === "sharp right") return `Svolta decisa a destra${via}`;
    if (modifier === "uturn") return `Inversione a U${via}`;
  }
  if (type === "new name" || type === "continue") return `Continua${via}`;
  if (type === "merge") return `Immettiti${via}`;
  if (type === "on ramp") return `Prendi la rampa${via}`;
  if (type === "off ramp") return `Esci${via}`;
  return `Prosegui${via}`;
}

function stepSymbol(step) {
  const type = step?.maneuver?.type || "";
  const modifier = step?.maneuver?.modifier || "";
  if (type === "depart") return "↑";
  if (type === "arrive") return "◎";
  if (type === "roundabout") return "⟳";
  if (type === "turn") {
    if (modifier === "left" || modifier === "slight left" || modifier === "sharp left") return "↰";
    if (modifier === "right" || modifier === "slight right" || modifier === "sharp right") return "↱";
    if (modifier === "uturn") return "↺";
  }
  if (type === "merge") return "⇢";
  if (type === "on ramp") return "⤴";
  if (type === "off ramp") return "⤵";
  return "↑";
}

function parseRestrictionValue(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().replace(",", ".");
  const match = normalized.match(/(\d+(\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]);
}

function normalizeTruck(truckSettings) {
  return {
    // Conservative defaults help avoid unsafe roads when user did not fill all values.
    height: parseRestrictionValue(truckSettings.height) ?? 4.0,
    weight: parseRestrictionValue(truckSettings.weight) ?? 18,
    length: parseRestrictionValue(truckSettings.length) ?? 12
  };
}

function getGeometryBBox(geometryCoords) {
  let minLon = geometryCoords[0][0];
  let maxLon = geometryCoords[0][0];
  let minLat = geometryCoords[0][1];
  let maxLat = geometryCoords[0][1];
  geometryCoords.forEach(([lon, lat]) => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  });
  return { minLon, maxLon, minLat, maxLat };
}

function expandBBox(bbox, paddingDeg = 0.06) {
  return {
    south: bbox.minLat - paddingDeg,
    west: bbox.minLon - paddingDeg,
    north: bbox.maxLat + paddingDeg,
    east: bbox.maxLon + paddingDeg
  };
}

const ITALY_BBOX = {
  south: 36.4,
  west: 6.6,
  north: 47.2,
  east: 18.8
};

function createBboxTiles(bbox, tileSizeDeg = 2.0) {
  const tiles = [];
  for (let south = bbox.south; south < bbox.north; south += tileSizeDeg) {
    const north = Math.min(south + tileSizeDeg, bbox.north);
    for (let west = bbox.west; west < bbox.east; west += tileSizeDeg) {
      const east = Math.min(west + tileSizeDeg, bbox.east);
      tiles.push({ south, west, north, east });
    }
  }
  return tiles;
}

function routeNearRestriction(routeCoordinates, restrictionGeometry) {
  return restrictionGeometry.some(
    (point) => minDistanceToRouteMeters(point, routeCoordinates) <= 18
  );
}

function evaluateRestriction(tags, truck) {
  if (tags.hgv === "no" || tags.goods === "no" || tags.motor_vehicle === "no") {
    return { severity: "hard", reason: "tratto stradale vietato ai camion" };
  }
  if (tags.access === "no" || tags.vehicle === "no") {
    return { severity: "soft", reason: "possibile limitazione accesso veicoli" };
  }
  const maxHeight = parseRestrictionValue(tags.maxheight ?? tags["maxheight:physical"]);
  if (maxHeight && truck.height && truck.height > maxHeight) {
    return { severity: "hard", reason: `altezza ${truck.height}m > ${maxHeight}m` };
  }
  const maxAxleLoad = parseRestrictionValue(tags.maxaxleload);
  if (maxAxleLoad && truck.weight && truck.weight > maxAxleLoad) {
    return { severity: "hard", reason: `carico asse ${truck.weight}t > ${maxAxleLoad}t` };
  }
  const maxWeight = parseRestrictionValue(tags.maxweight);
  if (maxWeight && truck.weight && truck.weight > maxWeight) {
    return { severity: "hard", reason: `peso ${truck.weight}t > ${maxWeight}t` };
  }
  const maxLength = parseRestrictionValue(tags.maxlength);
  if (maxLength && truck.length && truck.length > maxLength) {
    return { severity: "hard", reason: `lunghezza ${truck.length}m > ${maxLength}m` };
  }
  return null;
}

function isAutostradaStep(step) {
  const name = (step?.name || "").toLowerCase();
  return /\ba\d+\b/.test(name) || name.includes("autostrada") || name.includes("raccordo");
}

function analyzeCandidate(candidate, restrictions, truck) {
  const warnings = [];
  let hardCount = 0;
  let softCount = 0;
  let closestRestrictionMeters = Infinity;
  restrictions.forEach((restriction) => {
    const evaluation = evaluateRestriction(restriction.tags, truck);
    if (!evaluation) return;
    const distanceToRestriction = restriction.geometry.reduce((minDistance, point) => {
      const distance = minDistanceToRouteMeters(point, candidate.geometry.coordinates);
      return Math.min(minDistance, distance);
    }, Infinity);

    closestRestrictionMeters = Math.min(closestRestrictionMeters, distanceToRestriction);
    if (distanceToRestriction <= 18 || routeNearRestriction(candidate.geometry.coordinates, restriction.geometry)) {
      if (evaluation.severity === "hard") {
        hardCount += 1;
        warnings.push(`Limite camion: ${evaluation.reason}`);
      } else {
        softCount += 1;
        warnings.push(`Attenzione: ${evaluation.reason}`);
      }
    }
  });
  const autostradaSteps = candidate.steps.filter((step) => isAutostradaStep(step)).length;
  return {
    ...candidate,
    hardCount,
    softCount,
    autostradaSteps,
    warnings,
    closestRestrictionMeters,
    // Prefer safer routes, then routes that keep major highways when possible.
    score:
      hardCount * 300000 +
      softCount * 40000 +
      Math.max(0, 160 - Math.min(closestRestrictionMeters, 160)) * 900 -
      autostradaSteps * 2500 +
      candidate.durationSeconds,
    steps: candidate.steps.map((step) => ({
      ...step,
      instruction: italianInstructionForStep(step)
    }))
  };
}

function findNextStep(routeInfo, userLocation, currentStepIndex) {
  if (!routeInfo?.steps?.length || !userLocation) return null;
  let idx = Math.max(0, currentStepIndex);
  while (idx < routeInfo.steps.length - 1) {
    const loc = routeInfo.steps[idx]?.maneuver?.location;
    if (!loc) break;
    const distance = haversineMeters(userLocation, { lon: loc[0], lat: loc[1] });
    if (distance > 22) break;
    idx += 1;
  }
  const step = routeInfo.steps[idx];
  if (!step?.maneuver?.location) return null;
  const stepDistance = haversineMeters(userLocation, {
    lon: step.maneuver.location[0],
    lat: step.maneuver.location[1]
  });
  return { index: idx, instruction: step.instruction, distanceMeters: stepDistance, step };
}

function App() {
  const [mapObject, setMapObject] = useState(null);
  const [markers, setMarkers] = useState(loadMarkers);
  const [mapTapLocation, setMapTapLocation] = useState(null);
  const [activeMode, setActiveMode] = useState("navigate");
  const [bottomPanelVisible, setBottomPanelVisible] = useState(true);
  const [markMode, setMarkMode] = useState(false);
  const [followUser, setFollowUser] = useState(true);
  const [routeForm, setRouteForm] = useState({ start: "", destination: "" });
  const [startSuggestions, setStartSuggestions] = useState([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [routeHint, setRouteHint] = useState("1) Inserisci destinazione  2) Calcola  3) Avvia navigazione");
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeGeometry, setRouteGeometry] = useState(null);
  const [routeEndpoints, setRouteEndpoints] = useState(null);
  const [truckSettings, setTruckSettings] = useState(loadTruckSettings);
  const [userLocation, setUserLocation] = useState(null);
  const [navigationActive, setNavigationActive] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [showVoicePrompt, setShowVoicePrompt] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [currentInstruction, setCurrentInstruction] = useState("");
  const [distanceToNextStepMeters, setDistanceToNextStepMeters] = useState(0);
  const [routingCache, setRoutingCache] = useState(null);
  const [mapRestrictions, setMapRestrictions] = useState([]);
  const lastRerouteTsRef = useRef(0);
  const spokenStepKeyRef = useRef("");
  const startAutocompleteIdRef = useRef(0);
  const destinationAutocompleteIdRef = useRef(0);
  const mapRestrictionsRequestIdRef = useRef(0);
  const restrictionIndexRef = useRef(new Map());
  const countryPreloadStartedRef = useRef(false);

  const mergeMapRestrictions = useCallback((incomingRestrictions) => {
    if (!incomingRestrictions?.length) return;
    const next = new Map(restrictionIndexRef.current);
    incomingRestrictions.forEach((restriction) => {
      if (!restriction?.id) return;
      next.set(restriction.id, restriction);
    });
    restrictionIndexRef.current = next;
    setMapRestrictions(Array.from(next.values()));
  }, []);

  const speak = (text) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "it-IT";
    u.rate = 1;
    window.speechSynthesis.speak(u);
  };

  const fitMapToRoute = (geometry) => {
    if (!mapObject || !geometry?.coordinates?.length) return;
    const bbox = getGeometryBBox(geometry.coordinates);
    mapObject.fitBounds(
      [
        [bbox.minLon, bbox.minLat],
        [bbox.maxLon, bbox.maxLat]
      ],
      { padding: 52, duration: 900 }
    );
  };

  const chooseAndApplyRoute = (cacheData, isRecalculation = false, finalAnalysis = true) => {
    const truck = normalizeTruck(truckSettings);
    const analyzed = cacheData.candidates.map((candidate) =>
      analyzeCandidate(candidate, cacheData.restrictions, truck)
    );
    const best = [...analyzed].sort((a, b) => a.score - b.score)[0];
    if (!best) return;

    setRouteInfo(best);
    setRouteGeometry(best.geometry);
    setRouteEndpoints({
      start: cacheData.snappedStart,
      destination: cacheData.snappedDestination
    });
    if (!finalAnalysis) {
      setRouteHint("Percorso trovato. Ottimizzazione in corso...");
      setRouteError("");
    } else if (isRecalculation) {
      setRouteHint("Percorso ottimizzato.");
      setRouteError("");
    } else {
      setRouteHint("Percorso pronto.");
      setRouteError("");
    }
    setCurrentStepIndex(0);
    setCurrentInstruction(best.steps?.[0]?.instruction || "");
    spokenStepKeyRef.current = "";
    fitMapToRoute(best.geometry);
  };

  const buildTruckAwareRoute = async (startPlace, destinationPlace) => {
    const routeData = await fetchRouteCandidates(startPlace, destinationPlace);
    const quickCache = { ...routeData, restrictions: [], startPlace, destinationPlace };
    setRoutingCache(quickCache);
    chooseAndApplyRoute(quickCache, false, false);

    let mergedBBox = getGeometryBBox(routeData.candidates[0].geometry.coordinates);
    routeData.candidates.slice(1).forEach((candidate) => {
      const box = getGeometryBBox(candidate.geometry.coordinates);
      mergedBBox = {
        minLon: Math.min(mergedBBox.minLon, box.minLon),
        maxLon: Math.max(mergedBBox.maxLon, box.maxLon),
        minLat: Math.min(mergedBBox.minLat, box.minLat),
        maxLat: Math.max(mergedBBox.maxLat, box.maxLat)
      };
    });
    const resolveRestrictions = async () => {
      let restrictions = [];
      try {
        restrictions = await Promise.race([
          fetchTruckRestrictionsForBBox(expandBBox(mergedBBox)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Restriction timeout")), 9000)
          )
        ]);
      } catch {
        restrictions = [];
      }
      const cacheData = { ...routeData, restrictions, startPlace, destinationPlace };
      setRoutingCache(cacheData);
      if (restrictions.length) {
        mergeMapRestrictions(restrictions);
      }
      chooseAndApplyRoute(cacheData, true, true);
    };

    void resolveRestrictions();
  };

  const handleRouteRequest = async () => {
    setRouteLoading(true);
    setRouteError("");
    try {
      const startValue = routeForm.start.trim().toLowerCase();
      const startPlace =
        (!startValue || startValue === "mia posizione") && userLocation
          ? { lon: userLocation.lon, lat: userLocation.lat, name: "Mia posizione" }
          : await geocodePlace(routeForm.start.trim());
      const destinationPlace = await geocodePlace(routeForm.destination.trim());
      if (!startPlace || !destinationPlace) {
        setRouteError("Inserisci partenza/destinazione valide in Italia.");
        return;
      }
      if (haversineMeters(startPlace, destinationPlace) < 20) {
        setRouteError("Partenza e destinazione troppo vicine.");
        return;
      }
      await buildTruckAwareRoute(startPlace, destinationPlace);
    } catch (error) {
      setRouteError(error.message || "Errore calcolo percorso.");
    } finally {
      setRouteLoading(false);
    }
  };

  useEffect(() => {
    if (!mapObject || countryPreloadStartedRef.current) return undefined;
    countryPreloadStartedRef.current = true;
    let cancelled = false;
    const ITALY_TILE_SIZE_DEG = 2.0;
    const ITALY_BATCH_SIZE = 2;
    const ITALY_BATCH_DELAY_MS = 180;

    const preloadItalyRestrictions = async () => {
      const tiles = createBboxTiles(ITALY_BBOX, ITALY_TILE_SIZE_DEG);
      for (let i = 0; i < tiles.length; i += ITALY_BATCH_SIZE) {
        const batch = tiles.slice(i, i + ITALY_BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (tile) => {
            try {
              return await fetchTruckRestrictionsForBBox(tile);
            } catch {
              return [];
            }
          })
        );
        if (cancelled) return;
        mergeMapRestrictions(results.flat());
        if (i + ITALY_BATCH_SIZE < tiles.length) {
          await new Promise((resolve) => setTimeout(resolve, ITALY_BATCH_DELAY_MS));
          if (cancelled) return;
        }
      }
    };

    void preloadItalyRestrictions();
    return () => {
      cancelled = true;
    };
  }, [mapObject, mergeMapRestrictions]);

  useEffect(() => {
    if (!mapObject) return undefined;
    let cancelled = false;
    let debounceId = null;
    const MAX_VIEWPORT_SPAN_DEG = 0.35;

    const loadViewportRestrictions = async () => {
      const requestId = Date.now();
      mapRestrictionsRequestIdRef.current = requestId;
      const bounds = mapObject.getBounds();
      const center = mapObject.getCenter();
      const latSpan = Math.min(bounds.getNorth() - bounds.getSouth(), MAX_VIEWPORT_SPAN_DEG);
      const lonSpan = Math.min(bounds.getEast() - bounds.getWest(), MAX_VIEWPORT_SPAN_DEG);
      const halfLat = latSpan / 2;
      const halfLon = lonSpan / 2;
      const bbox = {
        south: center.lat - halfLat,
        west: center.lng - halfLon,
        north: center.lat + halfLat,
        east: center.lng + halfLon
      };

      try {
        const restrictions = await fetchTruckRestrictionsForBBox(bbox);
        if (cancelled || mapRestrictionsRequestIdRef.current !== requestId) return;
        mergeMapRestrictions(restrictions);
      } catch {
        // Keep currently displayed restrictions if Overpass is temporarily unavailable.
      }
    };

    const handleMoveEnd = () => {
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        void loadViewportRestrictions();
      }, 280);
    };

    mapObject.on("moveend", handleMoveEnd);
    void loadViewportRestrictions();

    return () => {
      cancelled = true;
      mapObject.off("moveend", handleMoveEnd);
      if (debounceId) clearTimeout(debounceId);
    };
  }, [mapObject, mergeMapRestrictions]);

  useEffect(() => {
    if (!routingCache) return;
    chooseAndApplyRoute(routingCache, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckSettings.height, truckSettings.weight, truckSettings.length]);

  useEffect(() => {
    const query = routeForm.start.trim();
    if (!query || query.toLowerCase() === "mia posizione" || query.length < 2) {
      setStartSuggestions([]);
      return;
    }
    const requestId = Date.now();
    startAutocompleteIdRef.current = requestId;
    const timeout = setTimeout(async () => {
      try {
        const items = await autocompletePlaces(query, 5);
        if (startAutocompleteIdRef.current !== requestId) return;
        setStartSuggestions(items);
      } catch {
        if (startAutocompleteIdRef.current !== requestId) return;
        setStartSuggestions([]);
      }
    }, 220);
    return () => clearTimeout(timeout);
  }, [routeForm.start]);

  useEffect(() => {
    const query = routeForm.destination.trim();
    if (!query || query.length < 2) {
      setDestinationSuggestions([]);
      return;
    }
    const requestId = Date.now();
    destinationAutocompleteIdRef.current = requestId;
    const timeout = setTimeout(async () => {
      try {
        const items = await autocompletePlaces(query, 5);
        if (destinationAutocompleteIdRef.current !== requestId) return;
        setDestinationSuggestions(items);
      } catch {
        if (destinationAutocompleteIdRef.current !== requestId) return;
        setDestinationSuggestions([]);
      }
    }, 220);
    return () => clearTimeout(timeout);
  }, [routeForm.destination]);

  useEffect(() => {
    if (!navigator.geolocation) return undefined;
    const watcher = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({
          lon: position.coords.longitude,
          lat: position.coords.latitude,
          accuracy: position.coords.accuracy || null,
          heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
          speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 900, timeout: 12000 }
    );
    return () => navigator.geolocation.clearWatch(watcher);
  }, []);

  useEffect(() => {
    if (!navigationActive || !routeInfo || !userLocation) return;
    const nextStep = findNextStep(routeInfo, userLocation, currentStepIndex);
    if (!nextStep) return;
    setCurrentStepIndex(nextStep.index);
    setCurrentInstruction(nextStep.instruction);
    setDistanceToNextStepMeters(nextStep.distanceMeters);

    const stepKey = `${nextStep.index}_${Math.round(nextStep.distanceMeters / 25)}`;
    if (nextStep.distanceMeters <= 170 && spokenStepKeyRef.current !== stepKey) {
      spokenStepKeyRef.current = stepKey;
      speak(`Tra ${Math.round(nextStep.distanceMeters)} metri, ${nextStep.instruction}`);
    }

    const offRouteDistance = minDistanceToRouteMeters(userLocation, routeInfo.geometry.coordinates);
    const now = Date.now();
    if (offRouteDistance > 85 && now - lastRerouteTsRef.current > 30000 && routeForm.destination.trim()) {
      lastRerouteTsRef.current = now;
      handleRouteRequest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationActive, userLocation, routeInfo, currentStepIndex]);

  const handleStartNavigation = () => {
    if (!routeInfo || navigationActive) return;
    setShowVoicePrompt(true);
  };

  const beginNavigation = (enableVoice = voiceEnabled) => {
    if (!routeInfo) return;
    setNavigationActive(true);
    setFollowUser(true);
    setBottomPanelVisible(false);
    setShowVoicePrompt(false);
    const firstInstruction = routeInfo.steps?.[0]?.instruction || "Continua dritto";
    setCurrentInstruction(firstInstruction);
    if (!enableVoice || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`Navigazione avviata. ${firstInstruction}`);
    utterance.lang = "it-IT";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  };

  const confirmVoiceAndStart = (enableVoice) => {
    setVoiceEnabled(enableVoice);
    beginNavigation(enableVoice);
  };

  const handleStopNavigation = () => {
    setNavigationActive(false);
    setCurrentInstruction("");
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  };

  const handleSaveMarker = ({ type, note }) => {
    if (!mapTapLocation) return;
    const feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [mapTapLocation.lon, mapTapLocation.lat] },
      properties: { id: crypto.randomUUID(), type, note, createdAt: new Date().toISOString() }
    };
    setMarkers((current) => addMarker(current, feature));
    setMapTapLocation(null);
  };

  const handleSaveTruckSettings = (values) => {
    setTruckSettings(values);
    saveTruckSettings(values);
  };

  const toggleBottomPanel = () => {
    setBottomPanelVisible((current) => !current);
  };

  const handleRecenter = () => {
    setFollowUser(true);
    if (!userLocation || !mapObject) return;
    mapObject.easeTo({
      center: [userLocation.lon, userLocation.lat],
      duration: 760,
      zoom: Math.max(mapObject.getZoom(), 17.6),
      bearing: Number.isFinite(userLocation.heading) ? userLocation.heading : mapObject.getBearing(),
      pitch: 58
    });
  };

  const routeDistanceKm = routeInfo ? (routeInfo.distanceMeters / 1000).toFixed(1) : null;
  const routeDurationMin = routeInfo ? Math.round(routeInfo.durationSeconds / 60) : null;
  const activeStep = routeInfo?.steps?.[currentStepIndex] || routeInfo?.steps?.[0] || null;
  const maneuverSymbol = stepSymbol(activeStep);

  return (
    <div className="app-shell">
      <div className="map-vignette" />
      <MapView
        markers={markers}
        routeGeometry={routeGeometry}
        routeEndpoints={routeEndpoints}
        restrictions={mapRestrictions}
        userLocation={userLocation}
        followUser={followUser}
        markMode={markMode}
        onMapTap={setMapTapLocation}
        onMapReady={setMapObject}
        onFollowDisabled={() => setFollowUser(false)}
      />

      {navigationActive ? (
        <div className="turn-banner">
          <div className="turn-symbol">{maneuverSymbol}</div>
          <div className="turn-copy">
            <p className="turn-label">Manovra successiva</p>
            <p className="turn-instruction">{currentInstruction || "Procedi sul percorso"}</p>
            <p className="turn-distance">Tra {Math.round(distanceToNextStepMeters)} m</p>
          </div>
        </div>
      ) : null}

      <button className="pressable recenter-orb" onClick={handleRecenter} title="Riposiziona su di me">
        ↗
      </button>

      <section className={bottomPanelVisible ? "control-stage" : "control-stage hidden"}>
        <div className="panel-shell">
          <div
            className="panel-handle"
            onClick={toggleBottomPanel}
          >
            <div className="sheet-grabber" />
          </div>

          <div className="mode-tabs">
            <button
              className={`pressable mode-tab ${activeMode === "navigate" ? "active" : ""}`}
              onClick={() => setActiveMode("navigate")}
            >
              Naviga
            </button>
            <button
              className={`pressable mode-tab ${activeMode === "truck" ? "active" : ""}`}
              onClick={() => setActiveMode("truck")}
            >
              Limiti
            </button>
            <button
              className={`pressable mode-tab ${activeMode === "marks" ? "active" : ""}`}
              onClick={() => setActiveMode("marks")}
            >
              Segnali
            </button>
          </div>

          {activeMode === "navigate" ? (
            <div className="mode-pane">
              <div className="pane-hero">
                <h3 className="pane-title">Centro Navigazione</h3>
                <p className="quick-hint">{routeHint}</p>
              </div>
              <div className="navigate-grid">
                <div className="navigate-main">
                  <label className="field-label">
                    Partenza
                    <input
                      value={routeForm.start}
                      onChange={(e) => setRouteForm((c) => ({ ...c, start: e.target.value }))}
                      placeholder={userLocation ? "Mia posizione o città" : "Città di partenza"}
                    />
                    {startSuggestions.length ? (
                      <div className="autocomplete-list">
                        {startSuggestions.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className="autocomplete-item"
                            onClick={() => {
                              setRouteForm((current) => ({ ...current, start: item }));
                              setStartSuggestions([]);
                            }}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </label>
                  <label className="field-label">
                    Destinazione
                    <input
                      value={routeForm.destination}
                      onChange={(e) => setRouteForm((c) => ({ ...c, destination: e.target.value }))}
                      placeholder="Dove vuoi andare?"
                    />
                    {destinationSuggestions.length ? (
                      <div className="autocomplete-list">
                        {destinationSuggestions.map((item) => (
                          <button
                            key={item}
                            type="button"
                            className="autocomplete-item"
                            onClick={() => {
                              setRouteForm((current) => ({ ...current, destination: item }));
                              setDestinationSuggestions([]);
                            }}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </label>
                  <div className="route-actions-row">
                    <button className="pressable secondary-btn" onClick={() => setRouteForm((c) => ({ ...c, start: "Mia posizione" }))}>
                      Usa GPS
                    </button>
                    <button
                      className="pressable secondary-btn"
                      onClick={() => setRouteForm((c) => ({ start: c.destination, destination: c.start }))}
                    >
                      Inverti
                    </button>
                  </div>
                  <button className="pressable primary-btn" onClick={handleRouteRequest} disabled={routeLoading}>
                    {routeLoading ? "Calcolo..." : "Calcola percorso"}
                  </button>
                  {routeError ? <p className="error-text">{routeError}</p> : null}
                </div>

                {routeInfo ? (
                  <aside className="route-insight-card">
                    <p className="route-insight-kicker">Sintesi percorso</p>
                    <div className="metric-grid">
                      <div>
                        <p className="metric-label">Distanza</p>
                        <p className="metric-value">{routeDistanceKm} km</p>
                      </div>
                      <div>
                        <p className="metric-label">Tempo</p>
                        <p className="metric-value">{routeDurationMin} min</p>
                      </div>
                    </div>
                    <div className="nav-controls">
                      {!navigationActive ? (
                        <button className="pressable primary-btn" onClick={handleStartNavigation}>
                          Avvia navigazione
                        </button>
                      ) : (
                        <button className="pressable danger-btn" onClick={handleStopNavigation}>
                          Ferma
                        </button>
                      )}
                    </div>
                    {navigationActive && currentInstruction ? (
                      <div className="next-step-card">
                        <p className="next-label">Prossima manovra</p>
                        <p className="next-instruction">{currentInstruction}</p>
                        <p className="next-distance">Tra {Math.round(distanceToNextStepMeters)} m</p>
                      </div>
                    ) : null}
                  </aside>
                ) : (
                  <aside className="route-insight-card placeholder">
                    <p className="route-insight-kicker">Pronto</p>
                    <p className="quick-hint">
                      Calcola un percorso per vedere distanza, tempo e avvio navigazione.
                    </p>
                  </aside>
                )}
              </div>
            </div>
          ) : null}

          {activeMode === "truck" ? (
            <div className="mode-pane">
              <div className="pane-hero">
                <h3 className="pane-title">Parametri Veicolo</h3>
                <p className="quick-hint">Imposta il profilo camion usato per il controllo limiti.</p>
              </div>
              <TruckSettings initialValues={truckSettings} onSave={handleSaveTruckSettings} />
            </div>
          ) : null}

          {activeMode === "marks" ? (
            <div className="mode-pane">
              <div className="pane-hero">
                <h3 className="pane-title">Segnalazioni Locali</h3>
                <p className="quick-hint">Attiva “Segna” e tocca la mappa per aggiungere punti utili ai camion.</p>
              </div>
              <button
                className={`pressable ${markMode ? "primary-btn" : "secondary-btn"}`}
                onClick={() => setMarkMode((current) => !current)}
              >
                {markMode ? "Segna attivo" : "Attiva Segna"}
              </button>
              <div className="saved-list">
                {markers.features.slice(-6).reverse().map((feature) => (
                  <div className="saved-item" key={feature.properties.id}>
                    <p>
                      <span className="saved-type-chip">
                        {MARKER_TYPES[feature.properties.type]?.label}
                      </span>
                      {feature.properties.note || "Nessuna nota"}
                    </p>
                    <button
                      className="pressable danger-btn"
                      onClick={() => setMarkers((current) => removeMarkerById(current, feature.properties.id))}
                    >
                      Del
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {!bottomPanelVisible ? (
        <div
          className="restore-pill"
          onClick={toggleBottomPanel}
        >
          <div className="sheet-grabber" />
        </div>
      ) : null}

      <MarkerModal
        isOpen={Boolean(mapTapLocation)}
        onClose={() => setMapTapLocation(null)}
        onSave={handleSaveMarker}
      />

      {showVoicePrompt && !navigationActive ? (
        <div className="voice-modal-backdrop">
          <div className="voice-modal-card">
            <p className="voice-ask-title">Guida vocale</p>
            <p className="voice-ask-body">Vuoi attivare le istruzioni vocali quando avvii la navigazione?</p>
            <div className="voice-ask-actions">
              <button type="button" className="pressable secondary-btn" onClick={() => confirmVoiceAndStart(false)}>
                No, avvia senza voce
              </button>
              <button type="button" className="pressable primary-btn" onClick={() => confirmVoiceAndStart(true)}>
                Si, avvia con voce
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
