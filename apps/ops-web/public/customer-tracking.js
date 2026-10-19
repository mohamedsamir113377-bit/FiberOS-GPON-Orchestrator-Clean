import * as maplibregl from 'https://unpkg.com/maplibre-gl@6.13.0/dist/maplibre-gl.mjs';

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const kind=params.get('kind')==='fault'?'fault':'installation';
const token=params.get('token')||location.pathname.split('/').filter(Boolean).pop();
const map=new maplibregl.Map({
  container:'map',
  style:window.__FIBEROS_MAP_STYLE_URL__||'https://tiles.openfreemap.org/styles/liberty',
  center:[31.2357,30.0444],
  zoom:6,
  pitch:35,
  maxPitch:65,
  localIdeographFontFamily:'system-ui,sans-serif'
});
map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');

let marker=null;
let eventSource=null;
let pollTimer=null;
let lastKey='';

function esc(v){
  return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function trackingUrl(){
  return kind==='fault'
    ? '/v1/public/faults/tracking/'+encodeURIComponent(token)
    : '/v1/public/installations/tracking/'+encodeURIComponent(token);
}
async function fetchTracking(){
  if(!token) throw Error('TRACKING_TOKEN_REQUIRED');
  const r=await fetch(trackingUrl(),{credentials:'omit',cache:'no-store',redirect:'error'});
  const d=await r.json().catch(()=>({error:'INVALID_JSON_RESPONSE'}));
  if(!r.ok) throw Error(d.error||('HTTP_'+r.status));
  return d.tracking||null;
}
function updateMap(t){
  const tech=t?.technician;
  $('jobStatus').textContent=esc(t?.status||'UNKNOWN');
  $('techStatus').textContent=esc(tech?.status||'POSITION_UNAVAILABLE');
  $('techName').textContent=esc(tech?.name||'—');
  $('capturedAt').textContent=esc(tech?.capturedAt||'—');
  $('accuracy').textContent=tech?.accuracyMeters!=null?Math.round(Number(tech.accuracyMeters))+' m':'—';
  $('visit').textContent=esc(t?.visitScheduledAt||'—');
  if(!tech||!Number.isFinite(Number(tech.lat))||!Number.isFinite(Number(tech.lon))){
    $('truth').textContent='في انتظار أول إحداثيات حقيقية للفني…';
    return;
  }
  const lat=Number(tech.lat),lon=Number(tech.lon);
  const pos=[lon,lat];
  if(!marker){
    const el=document.createElement('div');
    el.style.width='18px';el.style.height='18px';el.style.borderRadius='50%';
    el.style.background='currentColor';el.style.border='3px solid white';el.style.boxShadow='0 0 0 7px rgba(75,209,197,.18)';
    marker=new maplibregl.Marker({element:el}).setLngLat(pos).addTo(map);
  }else marker.setLngLat(pos);
  const key=lat.toFixed(6)+','+lon.toFixed(6)+','+String(tech.capturedAt||'');
  if(key!==lastKey){
    lastKey=key;
    map.easeTo({center:pos,zoom:Math.max(map.getZoom(),13),duration:450});
  }
  $('truth').textContent='آخر موقع حقيقي مسجل للفني · accuracy '+(tech.accuracyMeters!=null?Math.round(Number(tech.accuracyMeters))+'m':'غير متاح')+' · لا يوجد ETA مصطنع.';
}
async function load(){
  try{ updateMap(await fetchTracking()); }
  catch(e){ $('truth').textContent=e.message==='TRACKING_LINK_INVALID_OR_EXPIRED'?'انتهت صلاحية رابط التتبع أو تم إلغاؤه.':'تعذر تحديث التتبع: '+e.message; }
}
function startInstallationStream(){
  if(!token||!window.EventSource)return;
  eventSource=new EventSource('/v1/public/installations/tracking/stream/'+encodeURIComponent(token));
  eventSource.onmessage=e=>{try{updateMap(JSON.parse(e.data))}catch(_){}};
  eventSource.addEventListener('tracking-expired',()=>{eventSource.close();$('truth').textContent='انتهت صلاحية رابط التتبع.';});
  eventSource.onerror=()=>{try{eventSource.close()}catch(_){};eventSource=null;};
}
map.on('load',async()=>{
  await load();
  if(kind==='installation') startInstallationStream();
  pollTimer=setInterval(()=>load(),kind==='fault'?5000:15000);
});
window.addEventListener('beforeunload',()=>{if(eventSource)eventSource.close();if(pollTimer)clearInterval(pollTimer);});
