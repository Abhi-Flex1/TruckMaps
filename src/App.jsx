import { useEffect, useRef, useState } from "react";
import MapView from "./components/MapView";
import MarkerModal from "./components/MarkerModal";
import TruckSettings from "./components/TruckSettings";
import {
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

function routeNearRestriction(routeCoordinates, restrictionGeometry) {
  return restrictionGeometry.some(
    (point) => minDistanceToRouteMeters(point, routeCoordinates) <= 30
  );
}

function evaluateRestriction(tags, truck) {
  if (
    tags.hgv === "no" ||
    tags.goods === "no" ||
    tags.access === "no" ||
    tags.vehicle === "no" ||
    tags.motor_vehicle === "no"
  ) {
    return { severity: "hard", reason: "tratto stradale vietato ai camion" };
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

function analyzeCandidate(candidate, restrictions, truck) {
  const warnings = [];
  let hardCount = 0;
  let closestRestrictionMeters = Infinity;
  restrictions.forEach((restriction) => {
    const evaluation = evaluateRestriction(restriction.tags, truck);
    if (!evaluation) return;
    const distanceToRestriction = restriction.geometry.reduce((minDistance, point) => {
      const distance = minDistanceToRouteMeters(point, candidate.geometry.coordinates);
      return Math.min(minDistance, distance);
    }, Infinity);

    closestRestrictionMeters = Math.min(closestRestrictionMeters, distanceToRestriction);
    if (distanceToRestriction <= 30 || routeNearRestriction(candidate.geometry.coordinates, restriction.geometry)) {
      hardCount += 1;
      warnings.push(`Limite camion: ${evaluation.reason}`);
    }
  });
  return {
    ...candidate,
    hardCount,
    warnings,
    closestRestrictionMeters,
    // Safety-first score: heavy penalty for restrictions, then reward larger clearance.
    score:
      hardCount * 1000000 +
      Math.max(0, 200 - Math.min(closestRestrictionMeters, 200)) * 1000 +
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
  return { index: idx, instruction: step.instruction, distanceMeters: stepDistance };
}

function App() {
  const [mapObject, setMapObject] = useState(null);
  const [markers, setMarkers] = useState(loadMarkers);
  const [mapTapLocation, setMapTapLocation] = useState(null);
  const [activeMode, setActiveMode] = useState("navigate");
  const [bottomPanelVisible, setBottomPanelVisible] = useState(true);
  const [markMode, setMarkMode] = useState(false);
  const [followUser, setFollowUser] = useState(true);
  const [topSearch, setTopSearch] = useState("");
  const [topSearchError, setTopSearchError] = useState("");
  const [routeForm, setRouteForm] = useState({ start: "", destination: "" });
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [routeHint, setRouteHint] = useState("1) Inserisci destinazione  2) Calcola  3) Avvia navigazione");
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeGeometry, setRouteGeometry] = useState(null);
  const [routeEndpoints, setRouteEndpoints] = useState(null);
  const [truckSettings, setTruckSettings] = useState(loadTruckSettings);
  const [truckWarnings, setTruckWarnings] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [navigationActive, setNavigationActive] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [currentInstruction, setCurrentInstruction] = useState("");
  const [distanceToNextStepMeters, setDistanceToNextStepMeters] = useState(0);
  const [routingCache, setRoutingCache] = useState(null);
  const lastRerouteTsRef = useRef(0);
  const spokenStepKeyRef = useRef("");

  const markerWarnings = routeGeometry
    ? markers.features
        .filter((feature) => feature.properties?.type === "avoid" || feature.properties?.type === "caution")
        .map((feature) => {
          const [lon, lat] = feature.geometry.coordinates;
          const d = minDistanceToRouteMeters({ lon, lat }, routeGeometry.coordinates);
          if (d > 200) return null;
          return `${MARKER_TYPES[feature.properties?.type || "caution"]?.label} entro ${Math.round(d)}m`;
        })
        .filter(Boolean)
    : [];
  const warnings = [...truckWarnings, ...markerWarnings];

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

  const chooseAndApplyRoute = (cacheData, isRecalculation = false) => {
    const truck = normalizeTruck(truckSettings);
    const analyzed = cacheData.candidates.map((candidate) =>
      analyzeCandidate(candidate, cacheData.restrictions, truck)
    );
    const safeRoutes = analyzed.filter((candidate) => candidate.hardCount === 0);
    if (safeRoutes.length === 0) {
      setRouteInfo(null);
      setRouteGeometry(null);
      setRouteEndpoints(null);
      setTruckWarnings([]);
      setCurrentInstruction("");
      setCurrentStepIndex(0);
      setRouteHint("Nessun percorso camion-safe trovato. Prova una destinazione alternativa.");
      setRouteError("Percorso bloccato: tutte le alternative includono strade non adatte ai camion.");
      setNavigationActive(false);
      return;
    }

    const best = [...safeRoutes].sort((a, b) => {
      if (a.hardCount !== b.hardCount) return a.hardCount - b.hardCount;
      const aClearance = Number.isFinite(a.closestRestrictionMeters) ? a.closestRestrictionMeters : Infinity;
      const bClearance = Number.isFinite(b.closestRestrictionMeters) ? b.closestRestrictionMeters : Infinity;
      if (aClearance !== bClearance) return bClearance - aClearance;
      return a.durationSeconds - b.durationSeconds;
    })[0];
    setRouteInfo(best);
    setRouteGeometry(best.geometry);
    setRouteEndpoints({
      start: cacheData.snappedStart,
      destination: cacheData.snappedDestination
    });
    setTruckWarnings(best.warnings.slice(0, 4));
    setRouteHint(
      isRecalculation
        ? "Percorso aggiornato (priorità sicurezza)."
        : "Percorso camion-safe pronto."
    );
    setRouteError("");
    setCurrentStepIndex(0);
    setCurrentInstruction(best.steps?.[0]?.instruction || "");
    spokenStepKeyRef.current = "";
    fitMapToRoute(best.geometry);
  };

  const buildTruckAwareRoute = async (startPlace, destinationPlace) => {
    const routeData = await fetchRouteCandidates(startPlace, destinationPlace);
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
    let restrictions = [];
    try {
      restrictions = await fetchTruckRestrictionsForBBox(expandBBox(mergedBBox));
    } catch {
      restrictions = [];
    }
    const cacheData = { ...routeData, restrictions, startPlace, destinationPlace };
    setRoutingCache(cacheData);
    chooseAndApplyRoute(cacheData);
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
    if (!routingCache) return;
    chooseAndApplyRoute(routingCache, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckSettings.height, truckSettings.weight, truckSettings.length]);

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
    if (!routeInfo) return;
    if (routeInfo.hardCount > 0) {
      setRouteError("Navigazione bloccata: percorso non completamente camion-safe.");
      return;
    }
    setNavigationActive(true);
    setFollowUser(true);
    setBottomPanelVisible(false);
    const firstInstruction = routeInfo.steps?.[0]?.instruction || "Continua dritto";
    setCurrentInstruction(firstInstruction);
    speak(`Navigazione avviata. ${firstInstruction}`);
  };

  const handleStopNavigation = () => {
    setNavigationActive(false);
    setCurrentInstruction("");
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  };

  const handleSearch = async (event) => {
    event.preventDefault();
    setTopSearchError("");
    try {
      const place = await geocodePlace(topSearch);
      if (!place || !mapObject) {
        setTopSearchError("Località non trovata.");
        return;
      }
      mapObject.flyTo({ center: [place.lon, place.lat], zoom: 12, duration: 700 });
    } catch {
      setTopSearchError("Ricerca non disponibile.");
    }
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

  const routeDistanceKm = routeInfo ? (routeInfo.distanceMeters / 1000).toFixed(1) : null;
  const routeDurationMin = routeInfo ? Math.round(routeInfo.durationSeconds / 60) : null;

  return (
    <div className="app-shell">
      <div className="map-vignette" />
      <MapView
        markers={markers}
        routeGeometry={routeGeometry}
        routeEndpoints={routeEndpoints}
        userLocation={userLocation}
        followUser={followUser}
        markMode={markMode}
        onMapTap={setMapTapLocation}
        onMapReady={setMapObject}
        onFollowDisabled={() => setFollowUser(false)}
      />

      <header className="command-deck">
        <div className="brand-strip">
          <p>Truck Maps Italia</p>
          {routeInfo ? <span>{routeDistanceKm} km • {routeDurationMin} min</span> : <span>Nessun percorso attivo</span>}
        </div>
        <form onSubmit={handleSearch} className="search-bar">
          <input
            value={topSearch}
            onChange={(event) => setTopSearch(event.target.value)}
            placeholder="Cerca luogo, via o città"
          />
          <button type="submit" className="pressable primary-btn">Vai</button>
        </form>
        {topSearchError ? <p className="inline-error">{topSearchError}</p> : null}
      </header>

      {navigationActive ? (
        <div className="turn-banner">
          <p className="turn-label">Manovra successiva</p>
          <p className="turn-instruction">{currentInstruction || "Procedi sul percorso"}</p>
          <p className="turn-distance">Tra {Math.round(distanceToNextStepMeters)} m</p>
        </div>
      ) : null}

      {warnings.length ? (
        <div className="alert-stack">
          <p className="warnings-title">Avvisi percorso</p>
          {warnings.slice(0, 3).map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      <div className="fab-column">
        <button className="pressable map-chip-btn" onClick={() => setFollowUser(true)}>
          Segui
        </button>
        <button
          className={`pressable map-chip-btn ${voiceEnabled ? "is-on" : ""}`}
          onClick={() => setVoiceEnabled((s) => !s)}
        >
          Voce
        </button>
      </div>

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
              <h3 className="pane-title">Percorso camion</h3>
              <p className="quick-hint">{routeHint}</p>
              <label className="field-label">
                Partenza
                <input
                  value={routeForm.start}
                  onChange={(e) => setRouteForm((c) => ({ ...c, start: e.target.value }))}
                  placeholder={userLocation ? "Mia posizione o città" : "Città di partenza"}
                />
              </label>
              <label className="field-label">
                Destinazione
                <input
                  value={routeForm.destination}
                  onChange={(e) => setRouteForm((c) => ({ ...c, destination: e.target.value }))}
                  placeholder="Dove vuoi andare?"
                />
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

              {routeInfo ? (
                <>
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
                        Avvia
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
                </>
              ) : null}
            </div>
          ) : null}

          {activeMode === "truck" ? (
            <div className="mode-pane">
              <TruckSettings initialValues={truckSettings} onSave={handleSaveTruckSettings} />
            </div>
          ) : null}

          {activeMode === "marks" ? (
            <div className="mode-pane">
              <h3 className="pane-title">Segnalazioni locali</h3>
              <p className="quick-hint">Attiva “Segna” e tocca la mappa per aggiungere segnalazioni utili ai camion.</p>
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
    </div>
  );
}

export default App;
