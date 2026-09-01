import { buildLoopWaypoints, decodePolyline } from "./geo.js";

export const DEFAULT_CENTER = [11.3426, 44.4949];

export function buildRoutePayload({ origin, distanceKm, trailPreference, avoidHighways, avoidTolls, routeKind = "loop", destination }) {
  const waypointCoordinates = routeKind === "loop"
    ? buildLoopWaypoints(origin, distanceKm, Math.round(distanceKm * 97 + origin[0] * 1000))
    : [origin, destination || buildLoopWaypoints(origin, distanceKm, 19)[2]];

  return {
    locations: waypointCoordinates.map(([lon, lat], index) => ({
      lat,
      lon,
      type: index === 0 || index === waypointCoordinates.length - 1 ? "break" : "through",
    })),
    costing: "motorcycle",
    costing_options: {
      motorcycle: {
        use_trails: Math.max(0, Math.min(1, trailPreference / 100)),
        use_highways: avoidHighways ? 0 : 0.55,
        use_tolls: avoidTolls ? 0 : 0.5,
        gate_penalty: 1800,
        private_access_penalty: 3600,
      },
    },
    directions_options: { units: "kilometers", language: "it-IT", narrative: true },
    units: "kilometers",
  };
}

export function normalizeValhallaRoute(data, mode = "enduro") {
  if (!data?.trip?.legs?.length) throw new Error("Il motore non ha restituito un percorso utilizzabile.");
  const coordinates = [];
  const maneuvers = [];
  let shapeOffset = 0;
  for (const leg of data.trip.legs) {
    const legCoordinates = decodePolyline(leg.shape, 6);
    coordinates.push(...(coordinates.length ? legCoordinates.slice(1) : legCoordinates));
    for (const maneuver of leg.maneuvers || []) {
      maneuvers.push({
        ...maneuver,
        begin_shape_index: (maneuver.begin_shape_index || 0) + shapeOffset,
        end_shape_index: (maneuver.end_shape_index || 0) + shapeOffset,
      });
    }
    shapeOffset += Math.max(0, legCoordinates.length - 1);
  }

  return {
    id: crypto.randomUUID?.() || `route-${Date.now()}`,
    title: mode === "road" ? "Giro panoramico" : mode === "motocross" ? "Trasferimento al circuito" : "Anello adventure",
    mode,
    coordinates,
    maneuvers,
    distanceKm: Number(data.trip.summary?.length || 0),
    durationSeconds: Number(data.trip.summary?.time || 0),
    createdAt: new Date().toISOString(),
    source: "Valhalla / OpenStreetMap",
  };
}

export async function requestRoute(payload, signal) {
  const endpoints = ["/.netlify/functions/route", "https://valhalla1.openstreetmap.de/route"];
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Errore percorso (${response.status})`);
      }
      return await response.json();
    } catch (error) {
      if (error.name === "AbortError") throw error;
      lastError = error;
    }
  }
  throw new Error(`Motore di percorso non raggiungibile. ${lastError?.message || "Riprova più tardi."}`);
}
