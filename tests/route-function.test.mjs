import test from "node:test";
import assert from "node:assert/strict";
import { buildGraphHopperPayload, sanitizeOptions, sanitizePayload } from "../netlify/functions/route.mjs";

test("la funzione elimina campi non consentiti prima di chiamare Valhalla", () => {
  const payload = sanitizePayload({
    locations: [{ lon: 11.34, lat: 44.49 }, { lon: 11.39, lat: 44.53 }],
    costing_options: { motorcycle: { use_trails: 4, use_highways: -1 } },
    dangerous_field: "ignored",
  });
  assert.equal(payload.costing_options.motorcycle.use_trails, 1);
  assert.equal(payload.costing_options.motorcycle.use_highways, 0);
  assert.equal("dangerous_field" in payload, false);
});

test("GraphHopper riceve punti GeoJSON e regole enduro", () => {
  const valhalla = sanitizePayload({ locations: [{ lon: 11.34, lat: 44.49 }, { lon: 11.39, lat: 44.53 }] });
  const options = sanitizeOptions({ mode: "enduro", provider: "graphhopper", trail_preference: 80, avoid_highways: true, avoid_tolls: true });
  const graphHopper = buildGraphHopperPayload(valhalla, options);
  assert.deepEqual(graphHopper.points[0], [11.34, 44.49]);
  assert.equal(graphHopper.points_encoded, false);
  assert.ok(graphHopper.custom_model.priority.some(rule => rule.if === "surface == PAVED"));
  assert.ok(graphHopper.custom_model.priority.some(rule => rule.if === "road_class == MOTORWAY" && rule.multiply_by === "0"));
});
