import {
  distanceToRouteMeters,
  haversineMeters,
  nearestRouteIndex,
  routeDistanceMeters,
} from "./lib/geo.js";
import {
  DEFAULT_CENTER,
  buildRoutePayload,
  normalizeValhallaRoute,
  requestRoute,
} from "./lib/route-service.js";

const L = globalThis.L;
const STORAGE_KEY = "varga-ride-state-v1";
const state = loadState();
const runtime = {
  map: null,
  navMap: null,
  baseLayer: null,
  routeLayer: null,
  navRouteLayer: null,
  locationMarker: null,
  navMarker: null,
  currentPosition: null,
  mapPickPosition: null,
  activeRoute: state.activeRoute || null,
  activeView: "explore",
  navigationWatch: null,
  navigationRouteIndex: 0,
  navigationStartedAt: null,
  navigationMuted: false,
  lastSpokenManeuver: null,
  recordWatch: null,
  recordTimer: null,
  recordingStartedAt: null,
  recordingPoints: [],
  lastRecordPosition: null,
  recordingDistance: 0,
};

const communityRoutes = [
  { id: "c1", title: "Crinali dell’Appennino bolognese", mode: "enduro", distance: 83, elevation: 1860, difficulty: "Esperto", author: "Marco E.", likes: 128 },
  { id: "c2", title: "Passo della Raticosa e Futa", mode: "road", distance: 146, elevation: 2480, difficulty: "Media", author: "Sara Ride", likes: 94 },
  { id: "c3", title: "Anello sterrato di Monte Sole", mode: "enduro", distance: 58, elevation: 1220, difficulty: "Media", author: "Enduro BO", likes: 76 },
  { id: "c4", title: "Crossodromo – sessione tecnica", mode: "motocross", distance: 3.2, elevation: 85, difficulty: "Esperto", author: "MX Emilia", likes: 52 },
];

document.addEventListener("DOMContentLoaded", init);

function init() {
  if (!L) {
    showToast("La libreria cartografica non è stata caricata.", "error");
    return;
  }
  initMap();
  bindNavigation();
  bindGenerator();
  bindRecording();
  bindCommunity();
  bindDialogs();
  updateProfileStats();
  renderCommunity();
  renderHistory();
  restoreActiveRoute();
  registerServiceWorker();
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { savedRoutes: [], recordings: [], favorites: [] };
  } catch {
    return { savedRoutes: [], recordings: [], favorites: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    savedRoutes: state.savedRoutes || [],
    recordings: state.recordings || [],
    favorites: state.favorites || [],
    activeRoute: runtime.activeRoute,
  }));
}

function initMap() {
  runtime.map = L.map("map", { zoomControl: false, preferCanvas: true }).setView([DEFAULT_CENTER[1], DEFAULT_CENTER[0]], 11);
  runtime.baseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(runtime.map);
  runtime.map.on("click", event => {
    runtime.mapPickPosition = [event.latlng.lng, event.latlng.lat];
    if (document.querySelector("#startSource")?.value === "map") {
      showToast("Punto di partenza selezionato sulla mappa.");
    }
  });
}

function bindNavigation() {
  document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
  document.querySelector("#openGenerator").addEventListener("click", () => showView("routes"));
  document.querySelector("#locateButton").addEventListener("click", locateUser);
  document.querySelector("#layersButton").addEventListener("click", toggleLayer);
  document.querySelector("#weatherButton").addEventListener("click", () => showToast("Meteo percorso: condizioni regolari · nessun avviso attivo."));
  document.querySelector("#alertsButton").addEventListener("click", () => showToast("Nessuna segnalazione critica nell’area visualizzata."));
  document.querySelector("#searchClear").addEventListener("click", () => {
    document.querySelector("#mapSearch").value = "";
  });
  document.querySelector("#mapSearch").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      showToast("La ricerca dei luoghi verrà collegata al servizio geografico in pubblicazione.");
    }
  });
  document.querySelectorAll("#modeChips .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#modeChips .chip").forEach(item => item.classList.toggle("active", item === chip));
      showToast(chip.dataset.mode === "all" ? "Visualizzo tutti i percorsi." : `Filtro ${chip.textContent} attivato.`);
    });
  });
  document.querySelector("#navCenter").addEventListener("click", centerNavigation);
  document.querySelector("#navOverview").addEventListener("click", showNavigationOverview);
  document.querySelector("#muteNav").addEventListener("click", toggleNavigationVoice);
  document.querySelector("#navSos").addEventListener("click", showSos);
  document.querySelector("#endNavigation").addEventListener("click", endNavigation);
  document.querySelector("#rerouteButton").addEventListener("click", rerouteFromCurrentPosition);
}

function showView(viewName) {
  runtime.activeView = viewName;
  document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
  const target = document.querySelector(`#${viewName}View`);
  if (!target) return;
  target.classList.add("active");
  document.querySelectorAll("#bottomNav [data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === viewName));
  document.querySelector("#bottomNav").classList.toggle("hidden", viewName === "navigation");
  document.querySelector(".topbar").classList.toggle("hidden", viewName === "navigation");
  if (viewName === "explore") setTimeout(() => runtime.map.invalidateSize(), 60);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function locateUser() {
  const button = document.querySelector("#locateButton");
  button.disabled = true;
  try {
    const position = await getCurrentPosition();
    runtime.currentPosition = [position.coords.longitude, position.coords.latitude];
    updateLocationMarker(runtime.currentPosition, position.coords.accuracy);
    runtime.map.setView([runtime.currentPosition[1], runtime.currentPosition[0]], 15, { animate: true });
    showToast(`Posizione rilevata · precisione ${Math.round(position.coords.accuracy)} m`);
  } catch (error) {
    showToast(locationErrorMessage(error), "error");
  } finally {
    button.disabled = false;
  }
}

function getCurrentPosition() {
  if (!navigator.geolocation) return Promise.reject(new Error("GPS non disponibile"));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: true,
    timeout: 14000,
    maximumAge: 3000,
  }));
}

function updateLocationMarker(coordinates, accuracy = 0) {
  const latLng = [coordinates[1], coordinates[0]];
  if (!runtime.locationMarker) {
    runtime.locationMarker = L.circleMarker(latLng, { radius: 8, weight: 4, color: "#fff", fillColor: "#9ee22c", fillOpacity: 1 }).addTo(runtime.map);
  } else runtime.locationMarker.setLatLng(latLng);
  runtime.locationMarker.bindTooltip(accuracy ? `Precisione GPS: ${Math.round(accuracy)} m` : "La mia posizione");
}

let darkLayerEnabled = false;
function toggleLayer() {
  darkLayerEnabled = !darkLayerEnabled;
  runtime.map.removeLayer(runtime.baseLayer);
  runtime.baseLayer = L.tileLayer(
    darkLayerEnabled ? "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: darkLayerEnabled ? 17 : 19, attribution: darkLayerEnabled ? "© OpenTopoMap · © OpenStreetMap" : "© OpenStreetMap contributors" },
  ).addTo(runtime.map);
  runtime.baseLayer.bringToBack();
  showToast(darkLayerEnabled ? "Mappa topografica attivata." : "Mappa stradale attivata.");
}

function bindGenerator() {
  const distance = document.querySelector("#distanceRange");
  const trail = document.querySelector("#trailRange");
  distance.addEventListener("input", () => document.querySelector("#distanceOutput").value = `${distance.value} km`);
  trail.addEventListener("input", () => document.querySelector("#trailOutput").value = `${trail.value}%`);
  document.querySelectorAll("input[name=rideMode]").forEach(input => input.addEventListener("change", () => {
    if (input.value === "road" && input.checked) {
      trail.value = "10";
      document.querySelector("#trailOutput").value = "10%";
    }
    if (input.value === "enduro" && input.checked) {
      trail.value = "70";
      document.querySelector("#trailOutput").value = "70%";
    }
  }));
  document.querySelector("#routeForm").addEventListener("submit", generateRoute);
}

async function generateRoute(event) {
  event.preventDefault();
  const button = document.querySelector("#generateRoute");
  button.classList.add("loading");
  button.disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28000);
  try {
    const mode = document.querySelector("input[name=rideMode]:checked").value;
    const origin = await resolveRouteOrigin();
    const payload = buildRoutePayload({
      origin,
      distanceKm: Number(document.querySelector("#distanceRange").value),
      trailPreference: mode === "motocross" ? 0 : Number(document.querySelector("#trailRange").value),
      avoidHighways: document.querySelector("#avoidHighways").checked,
      avoidTolls: document.querySelector("#avoidTolls").checked,
      routeKind: document.querySelector("#routeKind").value,
    });
    const data = await requestRoute(payload, controller.signal);
    runtime.activeRoute = normalizeValhallaRoute(data, mode);
    runtime.activeRoute.difficulty = document.querySelector("input[name=difficulty]:checked").value;
    runtime.activeRoute.origin = origin;
    saveState();
    renderGeneratedRoute(runtime.activeRoute);
    drawRouteOnMainMap(runtime.activeRoute);
    showToast("Percorso creato. Controlla sempre i divieti presenti sul posto.");
  } catch (error) {
    const message = error.name === "AbortError" ? "Il calcolo sta impiegando troppo tempo. Riprova con una distanza minore." : error.message;
    showRouteError(message);
  } finally {
    clearTimeout(timeout);
    button.classList.remove("loading");
    button.disabled = false;
  }
}

async function resolveRouteOrigin() {
  const source = document.querySelector("#startSource").value;
  if (source === "map") {
    if (!runtime.mapPickPosition) throw new Error("Tocca prima un punto sulla mappa da usare come partenza.");
    return runtime.mapPickPosition;
  }
  if (source === "bologna") return DEFAULT_CENTER;
  if (runtime.currentPosition) return runtime.currentPosition;
  try {
    const position = await getCurrentPosition();
    runtime.currentPosition = [position.coords.longitude, position.coords.latitude];
    return runtime.currentPosition;
  } catch {
    showToast("GPS non disponibile: uso Bologna come partenza.");
    return DEFAULT_CENTER;
  }
}

function renderGeneratedRoute(route) {
  const result = document.querySelector("#generatedRoute");
  result.classList.remove("hidden");
  result.innerHTML = `
    <article class="route-result card">
      <div class="route-result-head"><div><span class="eyebrow">PERCORSO PRONTO</span><h2>${escapeHtml(route.title)}</h2><p>${labelForMode(route.mode)} · dati ${escapeHtml(route.source)}</p></div><span class="route-badge">VERIFICA ACCESSI</span></div>
      <div class="route-summary"><div><strong>${formatNumber(route.distanceKm, 1)}</strong><span>km</span></div><div><strong>${Math.round(route.durationSeconds / 60)}</strong><span>min</span></div><div><strong>${route.maneuvers.length}</strong><span>indicazioni</span></div><div><strong>${difficultyLabel(route.difficulty)}</strong><span>difficoltà</span></div></div>
      <div class="route-result-actions"><button class="secondary-button" data-save-route>SALVA</button><button class="secondary-button" data-show-map>VEDI MAPPA</button><button class="primary-button" data-start-navigation>AVVIA NAVIGAZIONE</button></div>
    </article>`;
  result.querySelector("[data-save-route]").addEventListener("click", saveActiveRoute);
  result.querySelector("[data-show-map]").addEventListener("click", () => {
    showView("explore");
    fitMainRoute();
  });
  result.querySelector("[data-start-navigation]").addEventListener("click", startNavigation);
}

function showRouteError(message) {
  const result = document.querySelector("#generatedRoute");
  result.classList.remove("hidden");
  result.innerHTML = `<article class="route-result card"><span class="eyebrow">PERCORSO NON CREATO</span><h2>Riprova tra poco</h2><p>${escapeHtml(message)}</p><p class="legal-note" style="margin-top:12px">Non viene mostrato un percorso inventato: la navigazione parte solo quando il motore cartografico restituisce strade realmente presenti nei dati.</p></article>`;
}

function drawRouteOnMainMap(route) {
  if (runtime.routeLayer) runtime.map.removeLayer(runtime.routeLayer);
  runtime.routeLayer = L.polyline(route.coordinates.map(([lon, lat]) => [lat, lon]), { color: "#d6ff45", weight: 6, opacity: .95, lineJoin: "round" }).addTo(runtime.map);
  runtime.routeLayer.bindTooltip(route.title, { sticky: true });
}

function fitMainRoute() {
  if (runtime.routeLayer) runtime.map.fitBounds(runtime.routeLayer.getBounds(), { padding: [28, 28] });
}

function restoreActiveRoute() {
  if (!runtime.activeRoute?.coordinates?.length) return;
  drawRouteOnMainMap(runtime.activeRoute);
  renderGeneratedRoute(runtime.activeRoute);
}

function saveActiveRoute() {
  if (!runtime.activeRoute) return;
  state.savedRoutes ||= [];
  if (!state.savedRoutes.some(route => route.id === runtime.activeRoute.id)) state.savedRoutes.unshift(runtime.activeRoute);
  saveState();
  updateProfileStats();
  showToast("Percorso salvato nel profilo.");
}

function startNavigation() {
  if (!runtime.activeRoute?.coordinates?.length) return showToast("Crea o seleziona prima un percorso.", "error");
  showView("navigation");
  setTimeout(() => {
    if (!runtime.navMap) {
      runtime.navMap = L.map("navigationMap", { zoomControl: false, preferCanvas: true }).setView([DEFAULT_CENTER[1], DEFAULT_CENTER[0]], 15);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(runtime.navMap);
    }
    if (runtime.navRouteLayer) runtime.navMap.removeLayer(runtime.navRouteLayer);
    runtime.navRouteLayer = L.polyline(runtime.activeRoute.coordinates.map(([lon, lat]) => [lat, lon]), { color: "#d6ff45", weight: 7, opacity: .95 }).addTo(runtime.navMap);
    runtime.navMap.fitBounds(runtime.navRouteLayer.getBounds(), { padding: [35, 35] });
    runtime.navMap.invalidateSize();
  }, 40);
  runtime.navigationRouteIndex = 0;
  runtime.navigationStartedAt = Date.now();
  runtime.lastSpokenManeuver = null;
  updateNavigationSummary(0, null);
  speak("Navigazione avviata. Guida con prudenza e rispetta la segnaletica.");
  startNavigationGps();
}

function startNavigationGps() {
  if (!navigator.geolocation) {
    showToast("GPS non disponibile su questo dispositivo.", "error");
    return;
  }
  if (runtime.navigationWatch !== null) navigator.geolocation.clearWatch(runtime.navigationWatch);
  runtime.navigationWatch = navigator.geolocation.watchPosition(updateNavigationPosition, error => {
    showToast(locationErrorMessage(error), "error");
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 16000 });
}

function updateNavigationPosition(position) {
  const coordinates = [position.coords.longitude, position.coords.latitude];
  runtime.currentPosition = coordinates;
  const latLng = [coordinates[1], coordinates[0]];
  if (!runtime.navMarker) runtime.navMarker = L.circleMarker(latLng, { radius: 9, weight: 4, color: "#fff", fillColor: "#9ee22c", fillOpacity: 1 }).addTo(runtime.navMap);
  else runtime.navMarker.setLatLng(latLng);
  runtime.navigationRouteIndex = nearestRouteIndex(coordinates, runtime.activeRoute.coordinates, runtime.navigationRouteIndex);
  const offRouteDistance = distanceToRouteMeters(coordinates, runtime.activeRoute.coordinates.slice(Math.max(0, runtime.navigationRouteIndex - 25), runtime.navigationRouteIndex + 150), 2);
  document.querySelector("#offRouteWarning").classList.toggle("hidden", offRouteDistance < 85);
  updateNavigationInstruction(runtime.navigationRouteIndex);
  updateNavigationSummary(runtime.navigationRouteIndex, position.coords);
  runtime.navMap.setView(latLng, Math.max(runtime.navMap.getZoom(), 16), { animate: true });
  if (Number.isFinite(position.coords.heading)) runtime.navMap.setBearing?.(position.coords.heading);
}

function updateNavigationInstruction(routeIndex) {
  const maneuvers = runtime.activeRoute.maneuvers || [];
  const maneuver = maneuvers.find(item => item.end_shape_index >= routeIndex) || maneuvers.at(-1);
  if (!maneuver) return;
  const target = runtime.activeRoute.coordinates[Math.min(maneuver.begin_shape_index || routeIndex, runtime.activeRoute.coordinates.length - 1)];
  const current = runtime.currentPosition || runtime.activeRoute.coordinates[routeIndex];
  const distance = haversineMeters(current, target);
  document.querySelector("#maneuverDistance").textContent = formatDistance(distance);
  document.querySelector("#maneuverText").textContent = maneuver.instruction || "Continua sul percorso";
  document.querySelector("#maneuverIcon").textContent = maneuverIcon(maneuver.type);
  if (distance < 180 && runtime.lastSpokenManeuver !== maneuver.begin_shape_index) {
    runtime.lastSpokenManeuver = maneuver.begin_shape_index;
    speak(`${formatDistance(distance)}. ${maneuver.verbal_pre_transition_instruction || maneuver.instruction || "Continua"}`);
  }
}

function updateNavigationSummary(routeIndex, coords) {
  const remainingMeters = routeDistanceMeters(runtime.activeRoute.coordinates, routeIndex);
  const fraction = Math.max(.03, remainingMeters / Math.max(1, runtime.activeRoute.distanceKm * 1000));
  const remainingSeconds = runtime.activeRoute.durationSeconds * fraction;
  const eta = new Date(Date.now() + remainingSeconds * 1000);
  document.querySelector("#navEta").textContent = eta.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  document.querySelector("#navRemaining").textContent = formatNumber(remainingMeters / 1000, 1);
  document.querySelector("#navDuration").textContent = Math.max(1, Math.round(remainingSeconds / 60));
  document.querySelector("#navSpeed").textContent = Math.max(0, Math.round((coords?.speed || 0) * 3.6));
}

function centerNavigation() {
  if (runtime.currentPosition && runtime.navMap) runtime.navMap.setView([runtime.currentPosition[1], runtime.currentPosition[0]], 17, { animate: true });
}

function showNavigationOverview() {
  if (runtime.navRouteLayer) runtime.navMap.fitBounds(runtime.navRouteLayer.getBounds(), { padding: [40, 40] });
}

function toggleNavigationVoice() {
  runtime.navigationMuted = !runtime.navigationMuted;
  document.querySelector("#muteNav").textContent = runtime.navigationMuted ? "OFF" : "ON";
  if (runtime.navigationMuted) speechSynthesis?.cancel();
  else speak("Indicazioni vocali attivate.");
}

function speak(message) {
  if (runtime.navigationMuted || !globalThis.speechSynthesis || !message) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = "it-IT";
  utterance.rate = .96;
  speechSynthesis.speak(utterance);
}

function showSos() {
  const positionText = runtime.currentPosition ? `${runtime.currentPosition[1].toFixed(6)},${runtime.currentPosition[0].toFixed(6)}` : "posizione non disponibile";
  const message = `SOS MOTO – Ho bisogno di assistenza. Posizione: ${positionText}`;
  if (navigator.share) navigator.share({ title: "SOS Varga Ride", text: message }).catch(() => {});
  else navigator.clipboard?.writeText(message).then(() => showToast("Messaggio SOS copiato. Chiama subito il 112 in caso di emergenza."));
}

async function rerouteFromCurrentPosition() {
  if (!runtime.currentPosition || !runtime.activeRoute) return;
  showToast("Ricalcolo del collegamento al percorso…");
  const destination = runtime.activeRoute.coordinates[Math.min(runtime.navigationRouteIndex + 180, runtime.activeRoute.coordinates.length - 1)];
  try {
    const payload = buildRoutePayload({ origin: runtime.currentPosition, destination, distanceKm: 5, trailPreference: runtime.activeRoute.mode === "enduro" ? 70 : 0, avoidHighways: true, avoidTolls: true, routeKind: "oneway" });
    const data = await requestRoute(payload);
    const connector = normalizeValhallaRoute(data, runtime.activeRoute.mode);
    runtime.activeRoute.coordinates = [...connector.coordinates, ...runtime.activeRoute.coordinates.slice(runtime.navigationRouteIndex + 180)];
    runtime.activeRoute.maneuvers = connector.maneuvers;
    startNavigation();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function endNavigation() {
  if (runtime.navigationWatch !== null) navigator.geolocation.clearWatch(runtime.navigationWatch);
  runtime.navigationWatch = null;
  speechSynthesis?.cancel();
  document.querySelector("#offRouteWarning").classList.add("hidden");
  showView("explore");
  showToast("Navigazione terminata.");
}

function bindRecording() {
  document.querySelector("#recordButton").addEventListener("click", toggleRecording);
  document.querySelector("#finishRecordButton").addEventListener("click", finishRecording);
}

async function toggleRecording() {
  if (runtime.recordWatch !== null) return pauseRecording();
  try {
    await getCurrentPosition();
  } catch (error) {
    return showToast(locationErrorMessage(error), "error");
  }
  runtime.recordingStartedAt ||= Date.now();
  document.querySelector("#recordState").textContent = "Registrazione attiva";
  document.querySelector("#recordPulse").classList.add("active");
  document.querySelector("#recordButton").classList.add("active");
  document.querySelector("#recordButton").innerHTML = "Ⅱ PAUSA";
  document.querySelector("#finishRecordButton").classList.remove("hidden");
  runtime.recordWatch = navigator.geolocation.watchPosition(updateRecordingPosition, error => showToast(locationErrorMessage(error), "error"), { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
  runtime.recordTimer = setInterval(updateRecordClock, 1000);
}

function pauseRecording() {
  navigator.geolocation.clearWatch(runtime.recordWatch);
  runtime.recordWatch = null;
  clearInterval(runtime.recordTimer);
  document.querySelector("#recordState").textContent = "In pausa";
  document.querySelector("#recordPulse").classList.remove("active");
  document.querySelector("#recordButton").classList.remove("active");
  document.querySelector("#recordButton").innerHTML = "▶ RIPRENDI";
}

function updateRecordingPosition(position) {
  const point = [position.coords.longitude, position.coords.latitude, Date.now()];
  if (runtime.lastRecordPosition) {
    const step = haversineMeters(runtime.lastRecordPosition, point);
    if (step < 200) runtime.recordingDistance += step;
  }
  runtime.lastRecordPosition = point;
  runtime.recordingPoints.push(point);
  document.querySelector("#recordDistance").textContent = formatNumber(runtime.recordingDistance / 1000, 1);
  document.querySelector("#recordSpeed").textContent = Math.max(0, Math.round((position.coords.speed || 0) * 3.6));
  document.querySelector("#recordAltitude").textContent = position.coords.altitude == null ? "—" : `${Math.round(position.coords.altitude)} m`;
}

function updateRecordClock() {
  if (!runtime.recordingStartedAt) return;
  document.querySelector("#recordTime").textContent = formatDuration(Math.floor((Date.now() - runtime.recordingStartedAt) / 1000));
}

function finishRecording() {
  if (runtime.recordWatch !== null) navigator.geolocation.clearWatch(runtime.recordWatch);
  clearInterval(runtime.recordTimer);
  if (!runtime.recordingPoints.length) return resetRecording();
  const recording = {
    id: crypto.randomUUID?.() || `record-${Date.now()}`,
    title: `Giro del ${new Date().toLocaleDateString("it-IT")}`,
    createdAt: new Date().toISOString(),
    distanceKm: runtime.recordingDistance / 1000,
    durationSeconds: Math.floor((Date.now() - runtime.recordingStartedAt) / 1000),
    coordinates: runtime.recordingPoints.map(([lon, lat]) => [lon, lat]),
  };
  state.recordings ||= [];
  state.recordings.unshift(recording);
  saveState();
  resetRecording();
  renderHistory();
  updateProfileStats();
  showToast("Giro registrato e salvato nel profilo.");
}

function resetRecording() {
  runtime.recordWatch = null;
  runtime.recordingStartedAt = null;
  runtime.recordingPoints = [];
  runtime.lastRecordPosition = null;
  runtime.recordingDistance = 0;
  document.querySelector("#recordPulse").classList.remove("active");
  document.querySelector("#recordState").textContent = "Pronto";
  document.querySelector("#recordButton").classList.remove("active");
  document.querySelector("#recordButton").innerHTML = "<span>●</span> INIZIA REGISTRAZIONE";
  document.querySelector("#finishRecordButton").classList.add("hidden");
  document.querySelector("#recordTime").textContent = "00:00:00";
  document.querySelector("#recordDistance").textContent = "0,0";
  document.querySelector("#recordSpeed").textContent = "0";
  document.querySelector("#recordAltitude").textContent = "—";
}

function renderHistory() {
  const history = document.querySelector("#recordHistory");
  const recordings = state.recordings || [];
  history.innerHTML = recordings.length ? `<span class="eyebrow">ULTIME REGISTRAZIONI</span>${recordings.slice(0, 5).map(item => `<article class="history-item card"><div><b>${escapeHtml(item.title)}</b><br><span>${new Date(item.createdAt).toLocaleString("it-IT")}</span></div><strong>${formatNumber(item.distanceKm, 1)} km</strong></article>`).join("")}` : "";
}

function bindCommunity() {
  document.querySelectorAll(".community-tabs button").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".community-tabs button").forEach(item => item.classList.toggle("active", item === button));
    renderCommunity(button.dataset.feed);
  }));
  document.querySelector("#publishButton").addEventListener("click", () => document.querySelector("#publishDialog").showModal());
  document.querySelector("#publishForm").addEventListener("submit", event => {
    event.preventDefault();
    showToast("Percorso preparato. Il caricamento pubblico sarà attivo dopo la configurazione Firebase.");
    document.querySelector("#publishDialog").close();
  });
}

function renderCommunity(feed = "nearby") {
  const routes = feed === "popular" ? [...communityRoutes].sort((a, b) => b.likes - a.likes) : communityRoutes;
  document.querySelector("#communityFeed").innerHTML = routes.map(route => `
    <article class="route-card card" data-community-route="${route.id}" tabindex="0">
      <div class="route-cover"><span class="route-type">${labelForMode(route.mode).toUpperCase()}</span><button class="route-favorite" data-favorite="${route.id}" aria-label="Salva nei preferiti">${state.favorites?.includes(route.id) ? "♥" : "♡"}</button></div>
      <div class="route-card-body"><div class="route-author"><i>${initials(route.author)}</i><span>${escapeHtml(route.author)} · percorso dimostrativo</span></div><h2>${escapeHtml(route.title)}</h2><div class="route-card-metrics"><span>${formatNumber(route.distance, 1)} km</span><span>↗ ${route.elevation} m</span><span class="difficulty">◆ ${route.difficulty}</span><span>♥ ${route.likes}</span></div></div>
    </article>`).join("");
  document.querySelectorAll("[data-community-route]").forEach(card => {
    card.addEventListener("click", event => {
      if (event.target.closest("[data-favorite]")) return;
      showCommunityDetail(communityRoutes.find(item => item.id === card.dataset.communityRoute));
    });
    card.addEventListener("keydown", event => { if (event.key === "Enter") card.click(); });
  });
  document.querySelectorAll("[data-favorite]").forEach(button => button.addEventListener("click", () => toggleFavorite(button.dataset.favorite)));
}

function toggleFavorite(routeId) {
  state.favorites ||= [];
  state.favorites = state.favorites.includes(routeId) ? state.favorites.filter(id => id !== routeId) : [...state.favorites, routeId];
  saveState();
  renderCommunity(document.querySelector(".community-tabs .active")?.dataset.feed);
}

function showCommunityDetail(route) {
  const dialog = document.querySelector("#routeDetailDialog");
  document.querySelector("#routeDetailContent").innerHTML = `<div class="detail-hero"><span class="eyebrow">${labelForMode(route.mode).toUpperCase()}</span><h2>${escapeHtml(route.title)}</h2></div><div class="route-summary"><div><strong>${formatNumber(route.distance,1)}</strong><span>km</span></div><div><strong>${route.elevation}</strong><span>dislivello</span></div><div><strong>${route.difficulty}</strong><span>difficoltà</span></div><div><strong>${route.likes}</strong><span>mi piace</span></div></div><p class="detail-description">Contenuto dimostrativo della futura community. Prima della pubblicazione reale ogni percorso mostrerà data dell’ultimo passaggio, condizioni del fondo, segnalazioni e attendibilità degli accessi.</p><button class="primary-button" style="width:100%" data-detail-action>USA COME PERCORSO</button>`;
  dialog.showModal();
  dialog.querySelector("[data-detail-action]").addEventListener("click", () => {
    dialog.close();
    showToast("La traccia completa sarà disponibile quando l’autore la pubblicherà.");
  });
}

function bindDialogs() {
  document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("click", event => {
    const rect = dialog.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) dialog.close();
  }));
  document.querySelectorAll(".profile-menu button").forEach(button => button.addEventListener("click", () => showToast(`${button.querySelector("b").textContent}: sezione predisposta per la prossima fase.`)));
  document.querySelector("#editProfile").addEventListener("click", () => showToast("La modifica del profilo sarà collegata all’account utente."));
}

function updateProfileStats() {
  const recordings = state.recordings || [];
  const savedRoutes = state.savedRoutes || [];
  const totalKm = recordings.reduce((sum, item) => sum + Number(item.distanceKm || 0), 0);
  document.querySelector("#profileKm").textContent = formatNumber(totalKm, 0);
  document.querySelector("#profileRoutes").textContent = recordings.length + savedRoutes.length;
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.querySelector("#toastRegion").append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function formatNumber(value, decimals = 0) {
  return Number(value || 0).toLocaleString("it-IT", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${formatNumber(meters / 1000, 1)} km`;
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function labelForMode(mode) {
  return ({ enduro: "Enduro e sterrato", road: "Strada e passi", motocross: "Motocross" })[mode] || "Moto";
}

function difficultyLabel(value) {
  return ({ easy: "Facile", medium: "Media", hard: "Esperto" })[value] || "Media";
}

function maneuverIcon(type) {
  if ([9, 10, 11, 12].includes(type)) return "↱";
  if ([15, 16, 17, 18].includes(type)) return "↰";
  if ([26, 27].includes(type)) return "↻";
  if ([4, 5].includes(type)) return "⤴";
  return "↑";
}

function locationErrorMessage(error) {
  if (error?.code === 1) return "Permesso GPS negato. Abilita la posizione nelle impostazioni del telefono.";
  if (error?.code === 2) return "Il segnale GPS non è disponibile.";
  if (error?.code === 3) return "Tempo scaduto durante la ricerca della posizione.";
  return error?.message || "Impossibile rilevare la posizione.";
}

function initials(name) {
  return name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
