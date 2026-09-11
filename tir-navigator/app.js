const $ = (id)=>document.getElementById(id);
let map, userMarker, destMarker, routeLine, userPos=null, destinationPos=null, deferredPrompt=null;

const savedVehicle = JSON.parse(localStorage.getItem('tirVehicle')||'{}');
['weight','height','width','length','axles','trailer'].forEach(id=>{ if(savedVehicle[id]!==undefined) $(id).value=String(savedVehicle[id]); });
$('hereApiKey').value = localStorage.getItem('hereApiKey')||'';

map = L.map('map',{zoomControl:false}).setView([44.4949,11.3426], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
L.control.zoom({position:'topright'}).addTo(map);

function setStatus(s){ $('status').textContent=s; }
function saveVehicle(){
  const v={}; ['weight','height','width','length','axles','trailer'].forEach(id=>v[id]=$(id).value);
  localStorage.setItem('tirVehicle',JSON.stringify(v));
}
['weight','height','width','length','axles','trailer'].forEach(id=>$(id).addEventListener('change',saveVehicle));

async function locate(){
  if(!navigator.geolocation){ alert('Geolocalizzazione non disponibile'); return; }
  setStatus('Cerco la posizione…');
  navigator.geolocation.getCurrentPosition(pos=>{
    userPos=[pos.coords.latitude,pos.coords.longitude];
    if(userMarker) userMarker.setLatLng(userPos); else userMarker=L.marker(userPos).addTo(map).bindPopup('La tua posizione');
    map.setView(userPos,15); setStatus('Posizione aggiornata'); updateRouteBtn();
  },err=>{ setStatus('Posizione non disponibile'); alert('Consenti la posizione al browser per usare la navigazione.'); },{enableHighAccuracy:true,timeout:12000,maximumAge:10000});
}
$('myPosBtn').onclick=locate; $('recenterBtn').onclick=()=>userPos&&map.setView(userPos,15);

async function geocode(q){
  const url='https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=1&q='+encodeURIComponent(q);
  const r=await fetch(url,{headers:{'Accept-Language':'it'}}); if(!r.ok) throw new Error('Ricerca luogo non disponibile'); return r.json();
}
function selectDestination(item){
  destinationPos=[Number(item.lat),Number(item.lon)]; $('destination').value=item.display_name;
  $('suggestions').innerHTML='';
  if(destMarker) destMarker.setLatLng(destinationPos); else destMarker=L.marker(destinationPos).addTo(map).bindPopup('Destinazione').openPopup();
  map.setView(destinationPos,14); updateRouteBtn();
}
async function searchDestination(){
  const q=$('destination').value.trim(); if(!q) return;
  setStatus('Ricerca destinazione…');
  try{ const items=await geocode(q); $('suggestions').innerHTML=items.map((x,i)=>`<div class="suggestion" data-i="${i}">${x.display_name}</div>`).join('')||'<div class="suggestion">Nessun risultato</div>'; [...document.querySelectorAll('.suggestion[data-i]')].forEach(el=>el.onclick=()=>selectDestination(items[+el.dataset.i])); setStatus('Scegli una destinazione'); }catch(e){ alert(e.message); setStatus('Errore ricerca'); }
}
$('searchBtn').onclick=searchDestination; $('destination').addEventListener('keydown',e=>{if(e.key==='Enter') searchDestination();});
function updateRouteBtn(){ $('routeBtn').disabled=!(userPos&&destinationPos); }

function parseFlexiblePolyline(encoded){
  const dec='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; const mapDec={}; [...dec].forEach((c,i)=>mapDec[c]=i);
  let idx=0; const readVar=()=>{let res=0,shift=0,b; do{b=mapDec[encoded[idx++]];res|=(b&31)<<shift;shift+=5;}while(b&32); return res};
  const toSigned=v=>(v&1)?-(v+1)/2:v/2;
  const version=readVar(); if(version!==1) throw new Error('Polyline HERE non supportata');
  const header=readVar(); const precision=header&15; const third=(header>>4)&7; const factor=Math.pow(10,precision);
  let lat=0,lng=0,thirdVal=0; const out=[];
  while(idx<encoded.length){ lat+=toSigned(readVar()); lng+=toSigned(readVar()); if(third){thirdVal+=toSigned(readVar());} out.push([lat/factor,lng/factor]); }
  return out;
}

async function calculateTruckRoute(){
  const key=localStorage.getItem('hereApiKey'); if(!key){ $('settingsDialog').showModal(); alert('Inserisci prima una HERE API Key per il routing TIR.'); return; }
  saveVehicle();
  const weightKg=Math.round(Number($('weight').value||40)*1000); const h=Math.round(Number($('height').value||4)*100); const w=Math.round(Number($('width').value||2.55)*100); const len=Math.round(Number($('length').value||16.5)*100);
  const params=new URLSearchParams({transportMode:'truck',origin:userPos.join(','),destination:destinationPos.join(','),return:'polyline,summary,actions,instructions',apiKey:key});
  params.set('truck[grossWeight]',String(weightKg)); params.set('truck[height]',String(h)); params.set('truck[width]',String(w)); params.set('truck[length]',String(len)); params.set('truck[axleCount]',String(Number($('axles').value||5)));
  setStatus('Calcolo percorso TIR…'); $('routeBtn').disabled=true;
  try{
    const r=await fetch('https://router.hereapi.com/v8/routes?'+params.toString()); const data=await r.json(); if(!r.ok||!data.routes?.length) throw new Error(data?.notices?.[0]?.title||'Nessun percorso TIR trovato');
    const sections=data.routes[0].sections; const coords=[]; let dist=0,dur=0; sections.forEach(s=>{coords.push(...parseFlexiblePolyline(s.polyline));dist+=s.summary?.length||0;dur+=s.summary?.duration||0;});
    if(routeLine) routeLine.remove(); routeLine=L.polyline(coords,{weight:6}).addTo(map); map.fitBounds(routeLine.getBounds(),{padding:[30,30]});
    $('routeInfo').textContent=`${(dist/1000).toFixed(1)} km • ${Math.round(dur/60)} min`;
    setStatus('Percorso TIR calcolato');
  }catch(e){ console.error(e); alert('Errore percorso: '+e.message); setStatus('Errore percorso'); }
  finally{ updateRouteBtn(); }
}
$('routeBtn').onclick=calculateTruckRoute;

$('toggleVehicle').onclick=()=>{ $('vehicleForm').scrollIntoView({behavior:'smooth'}); $('height').focus(); };
$('saveSettings').onclick=()=>{ localStorage.setItem('hereApiKey',$('hereApiKey').value.trim()); setStatus('Impostazioni salvate'); };
document.querySelector('[data-tab="settings"]').onclick=()=> $('settingsDialog').showModal();
document.querySelector('[data-tab="vehicle"]').onclick=()=>document.querySelector('.vehicle-card').scrollIntoView({behavior:'smooth'});
document.querySelector('[data-tab="nav"]').onclick=()=>document.querySelector('.route-card').scrollIntoView({behavior:'smooth'});
document.querySelector('[data-tab="saved"]').onclick=()=>alert('Preferiti: funzione pronta da aggiungere nella prossima versione.');

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').hidden=false;});
$('installBtn').onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBtn').hidden=true;};
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
locate();
