import { haversineMeters, minDistanceToRouteMeters } from "./geo";

export function italianInstructionForStep(step) {
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

export function stepSymbol(step) {
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

export function parseRestrictionValue(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().replace(",", ".");
  const match = normalized.match(/(\d+(\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]);
}

export function normalizeTruck(truckSettings) {
  return {
    // Conservative defaults help avoid unsafe roads when user did not fill all values.
    height: parseRestrictionValue(truckSettings.height) ?? 4.0,
    weight: parseRestrictionValue(truckSettings.weight) ?? 18,
    length: parseRestrictionValue(truckSettings.length) ?? 12
  };
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

export function analyzeCandidate(candidate, restrictions, truck) {
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

export function findNextStep(routeInfo, userLocation, currentStepIndex) {
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
