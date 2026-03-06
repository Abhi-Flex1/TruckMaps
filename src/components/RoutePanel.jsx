function RoutePanel({
  routeForm,
  onRouteFormChange,
  onRouteRequest,
  onUseMyLocation,
  onSwap,
  routeInfo,
  routeHint,
  loading,
  error,
  locationReady,
  navigationActive,
  currentInstruction,
  distanceToNextStepMeters,
  onStartNavigation,
  onStopNavigation,
  voiceEnabled,
  onToggleVoice
}) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onRouteRequest(routeForm);
  };

  return (
    <div className="sheet-card">
      <h3>Percorso Camion</h3>
      <form onSubmit={handleSubmit}>
        <label>
          Partenza
          <input
            name="start"
            value={routeForm.start}
            onChange={(event) => onRouteFormChange("start", event.target.value)}
            placeholder={locationReady ? "La mia posizione o città" : "Es. Bologna"}
            required={!locationReady}
          />
        </label>
        <label>
          Destinazione
          <input
            name="destination"
            value={routeForm.destination}
            onChange={(event) => onRouteFormChange("destination", event.target.value)}
            placeholder="Es. Verona"
            required
          />
        </label>

        <div className="route-actions-row">
          <button type="button" className="pressable secondary-btn" onClick={onSwap}>
            Inverti
          </button>
          <button
            type="button"
            className="pressable secondary-btn"
            onClick={onUseMyLocation}
            disabled={!locationReady}
          >
            Usa GPS
          </button>
        </div>

        <button type="submit" className="pressable primary-btn" disabled={loading}>
          {loading ? "Calcolo percorso..." : "Calcola percorso"}
        </button>
      </form>

      {error ? <p className="error-text">{error}</p> : null}
      {routeHint ? <p className="hint-text">{routeHint}</p> : null}

      {routeInfo ? (
        <>
          <p className="small-text strong-text">
            {(routeInfo.distanceMeters / 1000).toFixed(1)} km |{" "}
            {(routeInfo.durationSeconds / 60).toFixed(0)} min
          </p>

          <div className="nav-controls">
            {!navigationActive ? (
              <button type="button" className="pressable primary-btn" onClick={onStartNavigation}>
                Avvia navigazione
              </button>
            ) : (
              <button type="button" className="pressable danger-btn" onClick={onStopNavigation}>
                Ferma navigazione
              </button>
            )}
            <button type="button" className="pressable secondary-btn" onClick={onToggleVoice}>
              Voce: {voiceEnabled ? "ON" : "OFF"}
            </button>
          </div>

          {navigationActive && currentInstruction ? (
            <div className="next-step-card">
              <p className="next-label">Prossima manovra</p>
              <p className="next-instruction">{currentInstruction}</p>
              <p className="next-distance">
                Tra {Math.max(0, Math.round(distanceToNextStepMeters))} m
              </p>
            </div>
          ) : null}

          {routeInfo.steps?.length ? (
            <div className="steps-list">
              {routeInfo.steps.slice(0, 10).map((step, index) => (
                <p key={`${step.maneuver?.type}_${step.name}_${index}`}>
                  {index + 1}. {step.instruction}
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default RoutePanel;
