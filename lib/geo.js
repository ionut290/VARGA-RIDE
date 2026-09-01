export const EARTH_RADIUS_M = 6371008.8;

export function toRad(value) {
  return (value * Math.PI) / 180;
}

export function toDeg(value) {
  return (value * 180) / Math.PI;
}

export function haversineMeters(a, b) {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLat = lat2 - lat1;
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function destinationPoint(origin, distanceMeters, bearingDegrees) {
  const angularDistance = distanceMeters / EARTH_RADIUS_M;
  const bearing = toRad(bearingDegrees);
  const lat1 = toRad(origin[1]);
  const lon1 = toRad(origin[0]);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return [((toDeg(lon2) + 540) % 360) - 180, toDeg(lat2)];
}

export function buildLoopWaypoints(origin, targetKm, seed = Date.now()) {
  const radius = Math.max(2500, (targetKm * 1000) / 5.2);
  const baseBearing = Math.abs(Math.trunc(seed)) % 360;
  return [
    origin,
    destinationPoint(origin, radius, baseBearing),
    destinationPoint(origin, radius * 1.15, baseBearing + 118),
    destinationPoint(origin, radius * 0.85, baseBearing + 235),
    origin,
  ];
}

export function decodePolyline(encoded, precision = 6) {
  const coordinates = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const factor = 10 ** precision;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([longitude / factor, latitude / factor]);
  }

  return coordinates;
}

export function distanceToRouteMeters(point, route, stride = 1) {
  if (!Array.isArray(route) || route.length === 0) return Number.POSITIVE_INFINITY;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.length; index += Math.max(1, stride)) {
    nearest = Math.min(nearest, haversineMeters(point, route[index]));
  }
  return nearest;
}

export function nearestRouteIndex(point, route, previousIndex = 0) {
  if (!Array.isArray(route) || route.length === 0) return 0;
  const start = Math.max(0, previousIndex - 20);
  const end = Math.min(route.length, previousIndex + 260);
  let nearestIndex = start;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = start; index < end; index += 1) {
    const distance = haversineMeters(point, route[index]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  return nearestIndex;
}

export function routeDistanceMeters(route, startIndex = 0) {
  let total = 0;
  for (let index = Math.max(1, startIndex + 1); index < route.length; index += 1) {
    total += haversineMeters(route[index - 1], route[index]);
  }
  return total;
}
