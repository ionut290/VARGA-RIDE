import test from "node:test";
import assert from "node:assert/strict";
import { buildLoopWaypoints, decodePolyline, destinationPoint, haversineMeters, routeDistanceMeters } from "../lib/geo.js";
import { buildRoutePayload } from "../lib/route-service.js";

test("haversine calcola una distanza realistica", () => {
  const bologna = [11.3426, 44.4949];
  const modena = [10.9252, 44.6471];
  const distanceKm = haversineMeters(bologna, modena) / 1000;
  assert.ok(distanceKm > 35 && distanceKm < 40);
});

test("destinationPoint mantiene la distanza richiesta", () => {
  const origin = [11.3426, 44.4949];
  const point = destinationPoint(origin, 10000, 45);
  assert.ok(Math.abs(haversineMeters(origin, point) - 10000) < 3);
});

test("i waypoint ad anello iniziano e terminano nello stesso punto", () => {
  const origin = [11.3426, 44.4949];
  const points = buildLoopWaypoints(origin, 60, 42);
  assert.equal(points.length, 5);
  assert.deepEqual(points[0], origin);
  assert.deepEqual(points.at(-1), origin);
});

test("decodePolyline decodifica una polyline standard", () => {
  const coordinates = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
  assert.deepEqual(coordinates.map(pair => pair.map(value => Number(value.toFixed(5)))), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
});

test("routeDistanceMeters somma i segmenti", () => {
  const origin = [11.3426, 44.4949];
  const a = destinationPoint(origin, 1000, 0);
  const b = destinationPoint(a, 1000, 90);
  assert.ok(Math.abs(routeDistanceMeters([origin, a, b]) - 2000) < 5);
});

test("payload applica limiti e penalità sicurezza", () => {
  const payload = buildRoutePayload({ origin: [11.3426, 44.4949], distanceKm: 60, trailPreference: 140, avoidHighways: true, avoidTolls: true });
  assert.equal(payload.costing, "motorcycle");
  assert.equal(payload.costing_options.motorcycle.use_trails, 1);
  assert.equal(payload.costing_options.motorcycle.use_highways, 0);
  assert.equal(payload.costing_options.motorcycle.private_access_penalty, 3600);
  assert.equal(payload.locations.at(-1).lat, payload.locations[0].lat);
});
