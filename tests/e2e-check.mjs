import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  permissions: ["geolocation"],
  geolocation: { longitude: 11.3426, latitude: 44.4949, accuracy: 12 },
});
const page = await context.newPage();

await page.route(/valhalla1\.openstreetmap\.de\/route|\.netlify\/functions\/route/, async route => {
  const shape = encodePolyline([
    [11.3426, 44.4949], [11.3600, 44.5100], [11.3900, 44.5200], [11.3700, 44.4850], [11.3426, 44.4949],
  ]);
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ trip: { summary: { length: 21.4, time: 2380 }, legs: [{ shape, maneuvers: [
      { type: 1, instruction: "Parti verso nord", verbal_pre_transition_instruction: "Parti verso nord", begin_shape_index: 0, end_shape_index: 1 },
      { type: 10, instruction: "Svolta a destra", verbal_pre_transition_instruction: "Svolta a destra", begin_shape_index: 1, end_shape_index: 2 },
      { type: 15, instruction: "Svolta a sinistra", verbal_pre_transition_instruction: "Svolta a sinistra", begin_shape_index: 2, end_shape_index: 3 },
      { type: 4, instruction: "Arrivo", verbal_pre_transition_instruction: "Arrivo", begin_shape_index: 3, end_shape_index: 4 },
    ] }] } }),
  });
});

await page.goto("http://127.0.0.1:4174", { waitUntil: "networkidle" });
assert.equal(await page.locator(".brand strong").textContent(), "VARGA RIDE");
assert.ok(await page.locator("#map").isVisible());
await page.screenshot({ path: "artifacts/varga-ride-home.png", fullPage: true });

await page.locator('#bottomNav [data-view="routes"]').click();
assert.ok(await page.locator("#recordView").isHidden());
await page.locator("#startSource").selectOption("bologna");
await page.screenshot({ path: "artifacts/varga-ride-generator.png", fullPage: true });
await page.locator("#generateRoute").click();
await page.locator(".route-result").waitFor();
assert.match(await page.locator(".route-result h2").textContent(), /Anello adventure/);
await page.locator("[data-start-navigation]").click();
await page.locator("#navigationView.active").waitFor();
assert.ok(await page.locator(".nav-instruction").isVisible());
await page.screenshot({ path: "artifacts/varga-ride-navigation.png", fullPage: true });

await page.locator("#endNavigation").click();
await page.locator('#bottomNav [data-view="community"]').click();
assert.equal(await page.locator(".route-card").count(), 4);
await page.screenshot({ path: "artifacts/varga-ride-community.png", fullPage: true });

await browser.close();

function encodePolyline(coordinates, precision = 6) {
  const factor = 10 ** precision;
  let previousLat = 0;
  let previousLon = 0;
  let output = "";
  for (const [lon, lat] of coordinates) {
    const latitude = Math.round(lat * factor);
    const longitude = Math.round(lon * factor);
    output += encodeValue(latitude - previousLat);
    output += encodeValue(longitude - previousLon);
    previousLat = latitude;
    previousLon = longitude;
  }
  return output;
}

function encodeValue(value) {
  let shifted = value < 0 ? ~(value << 1) : value << 1;
  let output = "";
  while (shifted >= 0x20) {
    output += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>= 5;
  }
  return output + String.fromCharCode(shifted + 63);
}
