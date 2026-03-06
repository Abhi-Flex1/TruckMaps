const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_BASE_URL = "https://router.project-osrm.org";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const ITALY_VIEWBOX = "6.6,47.2,18.8,36.4";

async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept-Language": "it,en"
      }
    });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postTextForJson(url, body, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      body,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function scoreGeocodingResult(result, queryLower) {
  const name = (result.display_name || "").toLowerCase();
  let score = Number(result.importance || 0);
  if (name.startsWith(queryLower)) score += 3;
  if (name.includes(queryLower)) score += 1;
  if (result.class === "highway") score += 1.2;
  if (result.type === "city" || result.type === "town") score += 0.8;
  return score;
}

export async function geocodePlace(query) {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "it");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("bounded", "1");
  url.searchParams.set("viewbox", ITALY_VIEWBOX);
  url.searchParams.set("q", trimmed);

  const results = await fetchJsonWithTimeout(url);
  if (!results.length) return null;

  const queryLower = trimmed.toLowerCase();
  const best = [...results].sort(
    (a, b) => scoreGeocodingResult(b, queryLower) - scoreGeocodingResult(a, queryLower)
  )[0];

  return {
    name: best.display_name,
    lon: Number(best.lon),
    lat: Number(best.lat)
  };
}

export async function autocompletePlaces(query, limit = 5) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "it");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("bounded", "1");
  url.searchParams.set("viewbox", ITALY_VIEWBOX);
  url.searchParams.set("q", trimmed);

  const results = await fetchJsonWithTimeout(url, 9000);
  if (!Array.isArray(results)) return [];

  const seen = new Set();
  return results
    .map((item) => item?.display_name?.trim())
    .filter(Boolean)
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export async function snapToRoad(point) {
  const url = `${OSRM_BASE_URL}/nearest/v1/driving/${point.lon},${point.lat}?number=1`;
  const data = await fetchJsonWithTimeout(url);
  const snapped = data?.waypoints?.[0];
  if (!snapped?.location) return point;
  return {
    ...point,
    lon: snapped.location[0],
    lat: snapped.location[1]
  };
}

export async function fetchRouteCandidates(start, destination) {
  const snappedPoints = await Promise.all([snapToRoad(start), snapToRoad(destination)]);
  const coordinates = `${snappedPoints[0].lon},${snappedPoints[0].lat};${snappedPoints[1].lon},${snappedPoints[1].lat}`;
  const url = `${OSRM_BASE_URL}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&alternatives=3&continue_straight=true&steps=true`;

  let data;
  try {
    data = await fetchJsonWithTimeout(url, 15000);
  } catch {
    // One fast retry for transient public API failures.
    data = await fetchJsonWithTimeout(url, 15000);
  }

  const routes = data?.routes || [];
  if (!routes.length) {
    throw new Error("No route found for these points.");
  }

  return {
    candidates: routes.map((route, idx) => ({
      id: `route_${idx + 1}`,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: route.geometry,
      legs: route.legs || [],
      steps: (route.legs || []).flatMap((leg) =>
        (leg.steps || []).map((step) => ({
          name: step.name || "",
          mode: step.mode || "driving",
          maneuver: {
            type: step?.maneuver?.type || "",
            modifier: step?.maneuver?.modifier || "",
            location: step?.maneuver?.location || null
          },
          distanceMeters: step.distance,
          durationSeconds: step.duration
        }))
      )
    })),
    snappedStart: snappedPoints[0],
    snappedDestination: snappedPoints[1]
  };
}

export async function fetchTruckRestrictionsForBBox(bbox) {
  const { south, west, north, east } = bbox;
  const query = `
[out:json][timeout:25];
(
  way["highway"]["hgv"="no"](${south},${west},${north},${east});
  way["highway"]["goods"="no"](${south},${west},${north},${east});
  way["highway"]["access"="no"](${south},${west},${north},${east});
  way["highway"]["vehicle"="no"](${south},${west},${north},${east});
  way["highway"]["motor_vehicle"="no"](${south},${west},${north},${east});
  way["highway"]["maxheight:physical"](${south},${west},${north},${east});
  way["highway"]["maxheight"](${south},${west},${north},${east});
  way["highway"]["maxaxleload"](${south},${west},${north},${east});
  way["highway"]["maxweight"](${south},${west},${north},${east});
  way["highway"]["maxlength"](${south},${west},${north},${east});
);
out tags geom;
`;

  const data = await postTextForJson(OVERPASS_URL, query, 30000);
  const ways = (data?.elements || []).filter((item) => item.type === "way" && item.tags && item.geometry);
  return ways.map((way) => ({
    id: way.id,
    tags: way.tags,
    geometry: way.geometry.map((coord) => ({ lon: coord.lon, lat: coord.lat }))
  }));
}
