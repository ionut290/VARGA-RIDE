import { buildLoopWaypoints, decodePolyline } from "./geo.js";

export const DEFAULT_CENTER = [11.3426, 44.4949];

export function buildRoutePayload({
  origin,
  distanceKm,
  trailPreference,
  avoidHighways,
  avoidTolls,
  routeKind = "loop",
  destination,
  mode = "enduro",
  provider = "auto",
  scenic = true,
}) {
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
    varga_options: {
      mode,
      provider,
      scenic: Boolean(scenic),
      trail_preference: Math.max(0, Math.min(100, Number(trailPreference) || 0)),
      avoid_highways: Boolean(avoidHighways),
      avoid_tolls: Boolean(avoidTolls),
    },
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

export function normalizeGraphHopperRoute(data, mode = "enduro") {
  const path = data?.paths?.[0];
  const coordinates = path?.points?.coordinates;
  if (!path || !Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error("GraphHopper non ha restituito un percorso utilizzabile.");
  }

  const maneuvers = (path.instructions || []).map(instruction => ({
    type: graphHopperSignToValhallaType(instruction.sign),
    instruction: instruction.text || "Continua sul percorso",
    verbal_pre_transition_instruction: instruction.text || "Continua sul percorso",
    begin_shape_index: Number(instruction.interval?.[0] || 0),
    end_shape_index: Number(instruction.interval?.[1] || instruction.interval?.[0] || 0),
  }));

  return {
    id: crypto.randomUUID?.() || `route-${Date.now()}`,
    title: mode === "road" ? "Giro panoramico" : mode === "motocross" ? "Trasferimento al circuito" : "Anello adventure",
    mode,
    coordinates: coordinates.map(([lon, lat]) => [Number(lon), Number(lat)]),
    maneuvers,
    distanceKm: Number(path.distance || 0) / 1000,
    durationSeconds: Number(path.time || 0) / 1000,
    createdAt: new Date().toISOString(),
    source: "GraphHopper / OpenStreetMap",
  };
}

export function normalizeRouteResponse(data, mode = "enduro") {
  const provider = data?.provider;
  const payload = data?.route || data;
  const route = provider === "graphhopper" || Array.isArray(payload?.paths)
    ? normalizeGraphHopperRoute(payload, mode)
    : normalizeValhallaRoute(payload, mode);

  if (data?.fallbackFrom) route.fallbackFrom = data.fallbackFrom;
  return route;
}

function graphHopperSignToValhallaType(sign) {
  if (sign === -3 || sign === -2) return 15;
  if (sign === 2 || sign === 3) return 10;
  if (sign === 4 || sign === 5 || sign === 6) return 26;
  if (sign === 7) return 4;
  return 1;
}

export async function requestRoute(payload, signal) {
  const endpoints = ["/.netlify/functions/route", "https://valhalla1.openstreetmap.de/route"];
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const requestPayload = endpoint.startsWith("http")
        ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "varga_options"))
        : payload;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
        signal,
      });
      if (!response.ok) {
        const body = await response.text();
        let message = body;
        try {
          const parsed = JSON.parse(body);
          message = parsed.error || parsed.message || body;
        } catch {}
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
