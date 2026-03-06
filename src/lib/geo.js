export function toRadians(value) {
  return (value * Math.PI) / 180;
}

export function haversineMeters(a, b) {
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

export function projectToWebMercator(point) {
  const x = (point.lon * 20037508.34) / 180;
  const y =
    Math.log(Math.tan(((90 + point.lat) * Math.PI) / 360)) / (Math.PI / 180);
  return { x, y: (y * 20037508.34) / 180 };
}

export function pointToSegmentMeters(point, start, end) {
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

export function minDistanceToRouteMeters(point, routeCoordinates) {
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

export function getGeometryBBox(geometryCoords) {
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

export function expandBBox(bbox, paddingDeg = 0.06) {
  return {
    south: bbox.minLat - paddingDeg,
    west: bbox.minLon - paddingDeg,
    north: bbox.maxLat + paddingDeg,
    east: bbox.maxLon + paddingDeg
  };
}
