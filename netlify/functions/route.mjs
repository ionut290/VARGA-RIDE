const VALHALLA_URL = process.env.VALHALLA_URL || "https://valhalla1.openstreetmap.de/route";
const GRAPHHOPPER_URL = process.env.GRAPHHOPPER_URL || "https://graphhopper.com/api/1/route";
const MAX_LOCATIONS = 8;

export default async request => {
  if (request.method === "OPTIONS") return response(204, "", corsHeaders());
  if (request.method === "GET") {
    return response(200, {
      defaultProvider: process.env.GRAPHHOPPER_API_KEY ? "graphhopper" : "valhalla",
      providers: {
        valhalla: { available: true, label: "OpenStreetMap" },
        graphhopper: { available: Boolean(process.env.GRAPHHOPPER_API_KEY), label: "GraphHopper" },
      },
    }, corsHeaders());
  }
  if (request.method !== "POST") return response(405, { error: "Metodo non consentito" }, corsHeaders());

  try {
    const input = await request.json();
    const valhallaPayload = sanitizePayload(input);
    const options = sanitizeOptions(input?.varga_options);
    const wantsGraphHopper = options.provider === "graphhopper" || (options.provider === "auto" && Boolean(process.env.GRAPHHOPPER_API_KEY));

    if (wantsGraphHopper && process.env.GRAPHHOPPER_API_KEY) {
      try {
        const graphHopperPayload = buildGraphHopperPayload(valhallaPayload, options);
        const graphHopperResponse = await fetch(`${GRAPHHOPPER_URL}?key=${encodeURIComponent(process.env.GRAPHHOPPER_API_KEY)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "VargaRide/0.2" },
          body: JSON.stringify(graphHopperPayload),
          signal: AbortSignal.timeout(25000),
        });
        const route = await readJsonResponse(graphHopperResponse, "GraphHopper");
        return response(200, { provider: "graphhopper", route }, corsHeaders());
      } catch (error) {
        const route = await fetchValhalla(valhallaPayload);
        return response(200, { provider: "valhalla", fallbackFrom: "graphhopper", fallbackReason: error.message, route }, corsHeaders());
      }
    }

    const route = await fetchValhalla(valhallaPayload);
    return response(200, {
      provider: "valhalla",
      fallbackFrom: options.provider === "graphhopper" ? "graphhopper" : undefined,
      route,
    }, corsHeaders());
  } catch (error) {
    const status = error.name === "TypeError" || error.name === "SyntaxError" ? 400 : 502;
    return response(status, { error: error.message || "Servizio di percorso non disponibile" }, corsHeaders());
  }
};

export const config = { path: "/.netlify/functions/route" };

async function fetchValhalla(payload) {
  const upstream = await fetch(VALHALLA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "VargaRide/0.2" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });
  return readJsonResponse(upstream, "OpenStreetMap");
}

async function readJsonResponse(upstream, provider) {
  const body = await upstream.text();
  if (!upstream.ok) {
    let message = body;
    try {
      const parsed = JSON.parse(body);
      message = parsed.message || parsed.error || parsed.error_code || body;
    } catch {}
    throw new Error(`${provider}: ${String(message || `errore ${upstream.status}`).slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${provider} ha restituito una risposta non valida.`);
  }
}

export function sanitizePayload(input) {
  if (!Array.isArray(input?.locations) || input.locations.length < 2 || input.locations.length > MAX_LOCATIONS) {
    throw new TypeError("Sono necessari da 2 a 8 punti validi.");
  }
  const locations = input.locations.map((location, index) => {
    const lat = Number(location.lat);
    const lon = Number(location.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new TypeError(`Coordinate non valide al punto ${index + 1}.`);
    return { lat, lon, type: location.type === "through" ? "through" : "break" };
  });
  const motorcycle = input.costing_options?.motorcycle || {};
  return {
    locations,
    costing: "motorcycle",
    costing_options: {
      motorcycle: {
        use_trails: clamp(motorcycle.use_trails, 0, 1, 0.5),
        use_highways: clamp(motorcycle.use_highways, 0, 1, 0.2),
        use_tolls: clamp(motorcycle.use_tolls, 0, 1, 0),
        gate_penalty: clamp(motorcycle.gate_penalty, 0, 43200, 1800),
        private_access_penalty: clamp(motorcycle.private_access_penalty, 0, 43200, 3600),
      },
    },
    directions_options: { units: "kilometers", language: "it-IT", narrative: true },
    units: "kilometers",
  };
}

export function sanitizeOptions(options = {}) {
  const provider = ["auto", "graphhopper", "valhalla"].includes(options.provider) ? options.provider : "auto";
  const mode = ["enduro", "road", "motocross"].includes(options.mode) ? options.mode : "enduro";
  return {
    provider,
    mode,
    scenic: options.scenic !== false,
    trailPreference: clamp(options.trail_preference, 0, 100, mode === "enduro" ? 70 : 0),
    avoidHighways: options.avoid_highways !== false,
    avoidTolls: options.avoid_tolls !== false,
  };
}

export function buildGraphHopperPayload(valhallaPayload, options) {
  const priority = [];
  if (options.avoidHighways) {
    priority.push(
      { if: "road_class == MOTORWAY", multiply_by: "0" },
      { if: "road_class == TRUNK", multiply_by: "0.2" },
    );
  } else if (options.scenic) {
    priority.push(
      { if: "road_class == MOTORWAY", multiply_by: "0.25" },
      { if: "road_class == TRUNK", multiply_by: "0.45" },
      { if: "road_class == PRIMARY", multiply_by: "0.75" },
    );
  }
  if (options.avoidTolls) priority.push({ if: "toll == ALL", multiply_by: "0" });
  if (options.mode === "enduro" && options.trailPreference >= 40) {
    const pavedPenalty = Math.max(0.35, 1 - options.trailPreference / 140).toFixed(2);
    priority.push({ if: "surface == PAVED", multiply_by: pavedPenalty });
  }

  return {
    points: valhallaPayload.locations.map(({ lon, lat }) => [lon, lat]),
    profile: process.env.GRAPHHOPPER_PROFILE || "scooter",
    locale: "it",
    instructions: true,
    calc_points: true,
    points_encoded: false,
    elevation: true,
    "ch.disable": true,
    custom_model: {
      priority,
      distance_influence: options.scenic ? 35 : 70,
    },
  };
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
}

function response(status, body, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
