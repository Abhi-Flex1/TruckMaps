import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { expandBBox, getGeometryBBox, haversineMeters, minDistanceToRouteMeters } from "./lib/geo";
import {
  analyzeCandidate,
  findNextStep,
  normalizeTruck,
  stepSymbol
} from "./lib/navigation";
import { useDebouncedPlaces } from "./hooks/useDebouncedPlaces";
import { useUserLocation } from "./hooks/useUserLocation";

const MapView = lazy(() => import("./components/MapView"));

function App() {
  const [mapObject, setMapObject] = useState(null);
  const [markers, setMarkers] = useState(loadMarkers);
  const [mapTapLocation, setMapTapLocation] = useState(null);
  const [activeMode, setActiveMode] = useState("navigate");
  const [bottomPanelVisible, setBottomPanelVisible] = useState(true);
  const [markMode, setMarkMode] = useState(false);
  const [followUser, setFollowUser] = useState(true);
  const [routeForm, setRouteForm] = useState({ start: "", destination: "" });
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [routeHint, setRouteHint] = useState("1) Inserisci destinazione  2) Calcola  3) Avvia navigazione");
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeGeometry, setRouteGeometry] = useState(null);
  const [routeEndpoints, setRouteEndpoints] = useState(null);
  const [truckSettings, setTruckSettings] = useState(loadTruckSettings);
  const [navigationActive, setNavigationActive] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [showVoicePrompt, setShowVoicePrompt] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [currentInstruction, setCurrentInstruction] = useState("");
  const [distanceToNextStepMeters, setDistanceToNextStepMeters] = useState(0);
  const [routingCache, setRoutingCache] = useState(null);

  const userLocation = useUserLocation();
  const [startSuggestions, setStartSuggestions] = useDebouncedPlaces(routeForm.start, {
    skip: routeForm.start.trim().toLowerCase() === "mia posizione"
  });
  const [destinationSuggestions, setDestinationSuggestions] = useDebouncedPlaces(routeForm.destination);

  const lastRerouteTsRef = useRef(0);
  const spokenStepKeyRef = useRef("");

  const routeMetrics = useMemo(() => {
    if (!routeInfo) return { routeDistanceKm: null, routeDurationMin: null, activeStep: null };
    return {
      routeDistanceKm: (routeInfo.distanceMeters / 1000).toFixed(1),
      routeDurationMin: Math.round(routeInfo.durationSeconds / 60),
      activeStep: routeInfo?.steps?.[currentStepIndex] || routeInfo?.steps?.[0] || null
    };
  }, [currentStepIndex, routeInfo]);

  const speak = useCallback(
    (text) => {
      if (!voiceEnabled || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "it-IT";
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    },
    [voiceEnabled]
  );

  const fitMapToRoute = useCallback(
    (geometry) => {
      if (!mapObject || !geometry?.coordinates?.length) return;
      const bbox = getGeometryBBox(geometry.coordinates);
      mapObject.fitBounds(
        [
          [bbox.minLon, bbox.minLat],
          [bbox.maxLon, bbox.maxLat]
        ],
        { padding: 52, duration: 900 }
      );
    },
    [mapObject]
  );

  const chooseAndApplyRoute = useCallback(
    (cacheData, isRecalculation = false, finalAnalysis = true) => {
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
      } else if (isRecalculation) {
        setRouteHint("Percorso ottimizzato.");
      } else {
        setRouteHint("Percorso pronto.");
      }

      setRouteError("");
      setCurrentStepIndex(0);
      setCurrentInstruction(best.steps?.[0]?.instruction || "");
      spokenStepKeyRef.current = "";
      fitMapToRoute(best.geometry);
    },
    [fitMapToRoute, truckSettings]
  );

  const buildTruckAwareRoute = useCallback(
    async (startPlace, destinationPlace) => {
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

      let restrictions = [];
      try {
        restrictions = await Promise.race([
          fetchTruckRestrictionsForBBox(expandBBox(mergedBBox)),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Restriction timeout")), 9000))
        ]);
      } catch {
        restrictions = [];
      }

      const finalCache = { ...routeData, restrictions, startPlace, destinationPlace };
      setRoutingCache(finalCache);
      chooseAndApplyRoute(finalCache, true, true);
    },
    [chooseAndApplyRoute]
  );

  const handleRouteRequest = useCallback(async () => {
    setRouteLoading(true);
    setRouteError("");

    try {
      const startRaw = routeForm.start.trim();
      const destinationRaw = routeForm.destination.trim();
      const startValue = startRaw.toLowerCase();

      const startPlace =
        (!startValue || startValue === "mia posizione") && userLocation
          ? { lon: userLocation.lon, lat: userLocation.lat, name: "Mia posizione" }
          : await geocodePlace(startRaw);

      const destinationPlace = await geocodePlace(destinationRaw);

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
  }, [buildTruckAwareRoute, routeForm.destination, routeForm.start, userLocation]);

  const beginNavigation = useCallback(
    (enableVoice = voiceEnabled) => {
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
    },
    [routeInfo, voiceEnabled]
  );

  const handleSaveTruckSettings = useCallback((values) => {
    setTruckSettings(values);
    saveTruckSettings(values);
  }, []);

  const handleFollowDisabled = useCallback(() => {
    setFollowUser(false);
  }, []);

  const handleSaveMarker = useCallback(({ type, note }) => {
    if (!mapTapLocation) return;
    const feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [mapTapLocation.lon, mapTapLocation.lat] },
      properties: { id: crypto.randomUUID(), type, note, createdAt: new Date().toISOString() }
    };
    setMarkers((current) => addMarker(current, feature));
    setMapTapLocation(null);
  }, [mapTapLocation]);

  const handleRecenter = useCallback(() => {
    setFollowUser(true);
    if (!userLocation || !mapObject) return;

    mapObject.easeTo({
      center: [userLocation.lon, userLocation.lat],
      duration: 760,
      zoom: Math.max(mapObject.getZoom(), 17.6),
      bearing: Number.isFinite(userLocation.heading) ? userLocation.heading : mapObject.getBearing(),
      pitch: 58
    });
  }, [mapObject, userLocation]);

  useEffect(() => {
    if (!routingCache) return;
    chooseAndApplyRoute(routingCache, true);
  }, [chooseAndApplyRoute, routingCache, truckSettings.height, truckSettings.length, truckSettings.weight]);

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
      void handleRouteRequest();
    }
  }, [
    currentStepIndex,
    handleRouteRequest,
    navigationActive,
    routeForm.destination,
    routeInfo,
    speak,
    userLocation
  ]);

  const maneuverSymbol = stepSymbol(routeMetrics.activeStep);

  return (
    <div className="app-shell">
      <div className="map-vignette" />
      <Suspense fallback={<div className={markMode ? "map mark-mode" : "map"} />}>
        <MapView
          markers={markers}
          routeGeometry={routeGeometry}
          routeEndpoints={routeEndpoints}
          userLocation={userLocation}
          followUser={followUser}
          markMode={markMode}
          onMapTap={setMapTapLocation}
          onMapReady={setMapObject}
          onFollowDisabled={handleFollowDisabled}
        />
      </Suspense>

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
          <div className="panel-handle" onClick={() => setBottomPanelVisible((current) => !current)}>
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
                      onChange={(event) => setRouteForm((current) => ({ ...current, start: event.target.value }))}
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
                      onChange={(event) =>
                        setRouteForm((current) => ({ ...current, destination: event.target.value }))
                      }
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
                    <button
                      className="pressable secondary-btn"
                      onClick={() => setRouteForm((current) => ({ ...current, start: "Mia posizione" }))}
                    >
                      Usa GPS
                    </button>
                    <button
                      className="pressable secondary-btn"
                      onClick={() =>
                        setRouteForm((current) => ({ start: current.destination, destination: current.start }))
                      }
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
                        <p className="metric-value">{routeMetrics.routeDistanceKm} km</p>
                      </div>
                      <div>
                        <p className="metric-label">Tempo</p>
                        <p className="metric-value">{routeMetrics.routeDurationMin} min</p>
                      </div>
                    </div>
                    <div className="nav-controls">
                      {!navigationActive ? (
                        <button className="pressable primary-btn" onClick={() => setShowVoicePrompt(true)}>
                          Avvia navigazione
                        </button>
                      ) : (
                        <button
                          className="pressable danger-btn"
                          onClick={() => {
                            setNavigationActive(false);
                            setCurrentInstruction("");
                            if (window.speechSynthesis) window.speechSynthesis.cancel();
                          }}
                        >
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
                      <span className="saved-type-chip">{MARKER_TYPES[feature.properties.type]?.label}</span>
                      {feature.properties.note || "Nessuna nota"}
                    </p>
                    <button
                      className="pressable danger-btn"
                      onClick={() =>
                        setMarkers((current) => removeMarkerById(current, feature.properties.id))
                      }
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
        <div className="restore-pill" onClick={() => setBottomPanelVisible(true)}>
          <div className="sheet-grabber" />
        </div>
      ) : null}

      <MarkerModal isOpen={Boolean(mapTapLocation)} onClose={() => setMapTapLocation(null)} onSave={handleSaveMarker} />

      {showVoicePrompt && !navigationActive ? (
        <div className="voice-modal-backdrop">
          <div className="voice-modal-card">
            <p className="voice-ask-title">Guida vocale</p>
            <p className="voice-ask-body">Vuoi attivare le istruzioni vocali quando avvii la navigazione?</p>
            <div className="voice-ask-actions">
              <button
                type="button"
                className="pressable secondary-btn"
                onClick={() => {
                  setVoiceEnabled(false);
                  beginNavigation(false);
                }}
              >
                No, avvia senza voce
              </button>
              <button
                type="button"
                className="pressable primary-btn"
                onClick={() => {
                  setVoiceEnabled(true);
                  beginNavigation(true);
                }}
              >
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
