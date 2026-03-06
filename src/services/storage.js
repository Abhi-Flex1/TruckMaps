const MARKERS_KEY = "truckMapsMarkersGeoJSON";
const TRUCK_SETTINGS_KEY = "truckMapsTruckSettings";

const EMPTY_COLLECTION = {
  type: "FeatureCollection",
  features: []
};

export const MARKER_TYPES = {
  avoid: { label: "Da evitare", color: "#e53935" },
  caution: { label: "Attenzione", color: "#fb8c00" },
  "low bridge": { label: "Ponte basso", color: "#8e24aa" },
  "narrow road": { label: "Strada stretta", color: "#3949ab" },
  "good truck road": { label: "Strada consigliata", color: "#43a047" }
};

export function loadMarkers() {
  try {
    const raw = localStorage.getItem(MARKERS_KEY);
    if (!raw) return EMPTY_COLLECTION;
    const parsed = JSON.parse(raw);
    if (parsed?.type === "FeatureCollection" && Array.isArray(parsed.features)) {
      return parsed;
    }
    return EMPTY_COLLECTION;
  } catch {
    return EMPTY_COLLECTION;
  }
}

export function saveMarkers(collection) {
  localStorage.setItem(MARKERS_KEY, JSON.stringify(collection));
}

export function addMarker(collection, markerFeature) {
  const next = {
    type: "FeatureCollection",
    features: [...collection.features, markerFeature]
  };
  saveMarkers(next);
  return next;
}

export function removeMarkerById(collection, id) {
  const next = {
    type: "FeatureCollection",
    features: collection.features.filter((feature) => feature.properties?.id !== id)
  };
  saveMarkers(next);
  return next;
}

export function loadTruckSettings() {
  try {
    const raw = localStorage.getItem(TRUCK_SETTINGS_KEY);
    if (!raw) return { height: "", weight: "", length: "" };
    const parsed = JSON.parse(raw);
    return {
      height: parsed?.height ?? "",
      weight: parsed?.weight ?? "",
      length: parsed?.length ?? ""
    };
  } catch {
    return { height: "", weight: "", length: "" };
  }
}

export function saveTruckSettings(settings) {
  localStorage.setItem(TRUCK_SETTINGS_KEY, JSON.stringify(settings));
}
