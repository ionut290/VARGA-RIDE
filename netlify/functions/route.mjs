const ROUTING_URL = process.env.VALHALLA_URL || "https://valhalla1.openstreetmap.de/route";
const MAX_LOCATIONS = 8;

export default async request => {
  if (request.method === "OPTIONS") return response(204, "", corsHeaders());
  if (request.method !== "POST") return response(405, { error: "Metodo non consentito" });

  try {
    const input = await request.json();
    const payload = sanitizePayload(input);
    const upstream = await fetch(ROUTING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "VargaRide/0.1" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...corsHeaders(), "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error.name === "TypeError" || error.name === "SyntaxError" ? 400 : 502;
    return response(status, { error: error.message || "Servizio di percorso non disponibile" });
  }
};

export const config = { path: "/.netlify/functions/route" };

function sanitizePayload(input) {
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

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
}

function response(status, body, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
