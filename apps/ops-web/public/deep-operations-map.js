import * as maplibregl from 'https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.mjs';

const API=window.FiberOSApiOrigin;
const base=API?API.normalizeApiBase('',location.href,window.__FIBEROS_ALLOWED_API_ORIGINS__||[]):location.origin;
const $=id=>document.getElementById(id);
const state={selected:null,selectedKind:null,snapshot:null,track:null};

const map=new maplibregl.Map({
  transformRequest:(url,resourceType)=>{try{const u=new URL(url,location.href),a=new URL(base,location.href);if(resourceType==='Source'&&u.origin===a.origin&&u.pathname.startsWith('/v1/gis/tiles/'))return {url,credentials:'include'};}catch(_){}return undefined;},
  container:'map',
  style:window.__FIBEROS_MAP_STYLE_URL__||'https://tiles.openfreemap.org/styles/liberty',
  center:[31.2357,30.0444],
  zoom:5.5,
  pitch:42,
  bearing:0,
  maxPitch:70,
  localIdeographFontFamily:'system-ui,sans-serif'
});
map.addControl(new maplibregl.NavigationControl({visualizePitch:true,showCompass:true}),'top-right');
map.addControl(new maplibregl.FullscreenControl(),'top-right');

const TILE_LAYERS=[
  ['technician','technician-point'],
  ['installation','installation-point'],
  ['fault','fault-point'],
  ['network_asset','asset-point'],
  ['fiber_cable','fiber-line'],
  ['duct','duct-line'],
  ['evidence','evidence-point'],
  ['ticket_location','ticket-location-point']
];

function apiUrl(path){
  return API?API.resolveApiUrl(base,path):new URL(path,base).toString();
}
async function json(path,options={}){
  const method=String(options.method||'GET').toUpperCase();
  const headers=new Headers(options.headers||{});
  if(!['GET','HEAD','OPTIONS'].includes(method)){
    try{const csrf=window.FiberOSSessionAuth?.getCsrfToken?.();if(csrf)headers.set('X-FiberOS-CSRF',csrf);}catch(_){}
  }
  const r=await fetch(apiUrl(path),{credentials:'include',cache:'no-store',redirect:'error',...options,headers});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||('HTTP_'+r.status));
  return d;
}
function tileUrl(layer){return apiUrl('/v1/gis/tiles/'+layer+'/{z}/{x}/{y}.pbf')}
function empty(){return {type:'FeatureCollection',features:[]}}
function visibility(k){return document.querySelector('[data-layer="'+k+'"]')?.checked!==false}
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function addVectorSource(layer){
  const sourceId='src-'+layer;
  if(map.getSource(sourceId))return;
  map.addSource(sourceId,{type:'vector',tiles:[tileUrl(layer)],minzoom:0,maxzoom:24,promoteId:'id'});
}
function addLayers(){
  addVectorSource('technician');addVectorSource('installation');addVectorSource('fault');addVectorSource('network_asset');addVectorSource('fiber_cable');addVectorSource('duct');addVectorSource('evidence');addVectorSource('ticket_location');
  map.addLayer({id:'fiber-line',type:'line',source:'src-fiber_cable','source-layer':'fiber_cable',paint:{'line-color':'#39c5ff','line-width':['interpolate',['linear'],['zoom'],5,1.2,12,2.7,18,6],'line-opacity':0.9}});
  map.addLayer({id:'duct-line',type:'line',source:'src-duct','source-layer':'duct',paint:{'line-color':'#93a5b2','line-width':['interpolate',['linear'],['zoom'],5,1,12,2,18,4],'line-dasharray':[2,2],'line-opacity':0.8}});
  map.addLayer({id:'technician-point',type:'circle',source:'src-technician','source-layer':'technician',paint:{'circle-radius':['interpolate',['linear'],['zoom'],5,4,13,7,18,10],'circle-color':'#ffd166','circle-stroke-color':'#061018','circle-stroke-width':2}});
  map.addLayer({id:'installation-point',type:'circle',source:'src-installation','source-layer':'installation',paint:{'circle-radius':['interpolate',['linear'],['zoom'],5,3.5,13,6,18,9],'circle-color':'#4fd1c5','circle-stroke-color':'#061018','circle-stroke-width':1.5}});
  map.addLayer({id:'fault-heatmap',type:'heatmap',source:'src-fault','source-layer':'fault',layout:{visibility:'none'},paint:{'heatmap-weight':['match',['get','severity'],'P1',1.0,'P2',0.7,'P3',0.45,'P4',0.2,0.1],'heatmap-intensity':['interpolate',['linear'],['zoom'],5,0.6,10,1.4,15,2.2],'heatmap-radius':['interpolate',['linear'],['zoom'],5,15,10,24,15,40],'heatmap-opacity':['interpolate',['linear'],['zoom'],5,0.72,14,0.5,18,0.25]}});
  map.addLayer({id:'fault-point',type:'circle',source:'src-fault','source-layer':'fault',paint:{'circle-radius':['interpolate',['linear'],['zoom'],5,4.5,13,7,18,11],'circle-color':['match',['get','severity'],'P1','#ff3355','P2','#ff8a3d','P3','#ffd166','P4','#73d13d','#9aa7b0'],'circle-stroke-color':'#061018','circle-stroke-width':2}});
  map.addLayer({id:'asset-point',type:'circle',source:'src-network_asset','source-layer':'network_asset',paint:{'circle-radius':['interpolate',['linear'],['zoom'],5,3.5,13,6,18,10],'circle-color':['match',['get','status'],'active','#8aa8ff','degraded','#f6ad55','faulty','#ef5959','removed','#6b7280','#8aa8ff'],'circle-stroke-color':'#061018','circle-stroke-width':1.5}});
  map.addLayer({id:'evidence-point',type:'circle',source:'src-evidence','source-layer':'evidence',paint:{'circle-radius':4,'circle-color':'#f6ad55','circle-stroke-color':'#061018','circle-stroke-width':1.5}});
  map.addLayer({id:'ticket-location-point',type:'circle',source:'src-ticket_location','source-layer':'ticket_location',paint:{'circle-radius':5,'circle-color':'#b18cff','circle-stroke-color':'#061018','circle-stroke-width':1.5}});
  setFilterState();
}
function setFilterState(){
  const fs=$('faultStatus').value,se=$('faultSeverity').value,is=$('installationStatus').value;
  const faultFilter=['all',...(fs?[['==',['get','status'],fs]]:[]),...(se?[['==',['get','severity'],se]]:[])];
  const installFilter=is?['==',['get','status'],is]:null;
  for(const id of ['fault-point','fault-heatmap'])if(map.getLayer(id))map.setFilter(id,faultFilter);
  if(map.getLayer('installation-point'))map.setFilter('installation-point',installFilter);
  for(const [k,id] of TILE_LAYERS)if(map.getLayer(id))map.setLayoutProperty(id,'visibility',visibility(k)?'visible':'none');
  if(map.getLayer('fault-heatmap'))map.setLayoutProperty('fault-heatmap','visibility',visibility('fault-heatmap')?'visible':'none');
}
async function loadSnapshot(){
  const b=map.getBounds();
  const q=new URLSearchParams({minLon:b.getWest().toString(),minLat:b.getSouth().toString(),maxLon:b.getEast().toString(),maxLat:b.getNorth().toString()});
  try{
    const d=await json('/v1/gis/deep-snapshot?'+q.toString());
    state.snapshot=d;
    $('techCount').textContent=d.counts?.technicians??'—';
    $('installationCount').textContent=d.counts?.installations??'—';
    $('faultCount').textContent=d.counts?.faults??'—';
    $('updatedAt').textContent=new Date(d.generatedAt||Date.now()).toLocaleTimeString();
    $('truth').textContent='Vector Tiles + PostGIS · البيانات التشغيلية من PostgreSQL/RLS · لا بيانات مصطنعة.';
  }catch(e){$('truth').textContent='تعذر قراءة مصدر GIS: '+e.message}
}
function selectFeature(e,kind){
  const f=e.features?.[0];if(!f)return;
  const p=f.properties||{};
  const c=[e.lngLat.lng,e.lngLat.lat];
  state.selected={id:f.id,properties:p,coordinates:c,kind};
  state.selectedKind=kind;
  $('selection').textContent=JSON.stringify({id:f.id,kind,...p,coordinates:c},null,2);
  $('nearest').disabled=false;$('route').disabled=false;
  $('showTrack').disabled=!(kind==='technician' && p.id);
  $('impact').disabled=!(kind==='network_asset'||(kind==='fault'&&p.root_asset_id));
  new maplibregl.Popup().setLngLat(c).setHTML('<strong>'+esc(p.name||p.job_code||p.asset_code||p.code||kind)+'</strong><br>'+esc(p.status||p.fault_type||p.asset_type||'')) .addTo(map);
}
async function showImpact(){
  if(!state.selected)return;
  const assetId=state.selectedKind==='fault'?state.selected.properties.root_asset_id:state.selected.id;
  if(!assetId)throw Error('ROOT_ASSET_REQUIRED_FOR_FAULT_IMPACT');
  const d=await json('/v1/gis/twin/impact',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({assetId,maxDepth:64})});
  state.impact=d;
  const affected=d.result?.[0]||d.rows?.[0]||d.impact||d;
  $('analysis').textContent=JSON.stringify(affected,null,2);
  if(affected?.affectedAssets){
    const features=affected.affectedAssets.filter(x=>x.geometry).map(x=>({type:'Feature',id:x.assetId,properties:{depth:x.depth,assetCode:x.assetCode,status:x.status},geometry:x.geometry}));
    const geo={type:'FeatureCollection',features};
    const src=map.getSource('impact-overlay');if(src)src.setData(geo);else{map.addSource('impact-overlay',{type:'geojson',data:geo});map.addLayer({id:'impact-overlay-point',type:'circle',source:'impact-overlay',paint:{'circle-radius':6,'circle-color':'#ff3355','circle-stroke-color':'#fff','circle-stroke-width':2}});}
  }
}
async function showTrack(){
  if(!state.selected||state.selectedKind!=='technician')return;
  const techId=state.selected.id;
  if(!techId)throw Error('TECHNICIAN_ID_UNAVAILABLE');
  const hours=Number($('trackHours').value||24),to=new Date(),from=new Date(to.getTime()-hours*3600000);
  const qs=new URLSearchParams({technicianId:String(techId),from:from.toISOString(),to:to.toISOString(),maxPoints:'5000'});
  const d=await json('/v1/gis/technician-track?'+qs.toString());
  state.track=d;
  $('analysis').textContent=JSON.stringify({technicianId:d.technicianId,from:d.from,to:d.to,pointCount:d.pointCount},null,2);
  const geo=d.track||empty();
  const src=map.getSource('technician-track');if(src)src.setData(geo);else{map.addSource('technician-track',{type:'geojson',data:geo});map.addLayer({id:'technician-track-line',type:'line',source:'technician-track',paint:{'line-color':'#fff','line-width':['interpolate',['linear'],['zoom'],6,2,14,4,18,6],'line-opacity':0.9}});}
  if(d.track?.geometry?.coordinates?.length){const b=d.track.geometry.coordinates.reduce((bb,p)=>bb.extend(p),new maplibregl.LngLatBounds(d.track.geometry.coordinates[0],d.track.geometry.coordinates[0]));map.fitBounds(b,{padding:70,maxZoom:17,duration:600});}
}
async function nearest(){
 if(!state.selected)return;
 const c=state.selected.coordinates;
 const d=await json('/v1/gis/nearest-technicians',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lat:c[1],lon:c[0],maxMeters:50000})});
 $('analysis').textContent=JSON.stringify(d,null,2);
}
async function route(){
 if(!state.selected)return;
 const c=state.selected.coordinates;
 const n=await json('/v1/gis/nearest-technicians',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lat:c[1],lon:c[0],maxMeters:50000})});
 const row=n.result?.[0]||n.technicians?.[0]||n.rows?.[0]||n[0];
 if(!row)throw Error('NO_AVAILABLE_TECHNICIAN_IN_SCOPE');
 const tlat=Number(row.lat??row.latitude),tlon=Number(row.lon??row.longitude);if(!Number.isFinite(tlat)||!Number.isFinite(tlon))throw Error('TECHNICIAN_COORDINATES_UNAVAILABLE');
 const d=await json('/v1/routing/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceLat:tlat,sourceLon:tlon,targetLat:c[1],targetLon:c[0]})});
 const rr=d.response?.routes?.[0];if(!rr?.geometry?.coordinates?.length)throw Error('ROUTE_GEOMETRY_UNAVAILABLE');
 const geo={type:'Feature',properties:{provider:d.provider},geometry:rr.geometry};
 const src=map.getSource('route-overlay');if(src)src.setData(geo);else{map.addSource('route-overlay',{type:'geojson',data:geo});map.addLayer({id:'route-overlay-line',type:'line',source:'route-overlay',paint:{'line-color':'#ffffff','line-width':['interpolate',['linear'],['zoom'],5,2,14,5,18,8],'line-opacity':0.95}});}
 const bounds=rr.geometry.coordinates.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds(rr.geometry.coordinates[0],rr.geometry.coordinates[0]));map.fitBounds(bounds,{padding:70,maxZoom:17,duration:650});
 const secs=Number(rr.duration),meters=Number(rr.distance);
 $('analysis').textContent=JSON.stringify({provider:d.provider,technician:row,route:{distanceMeters:Number.isFinite(meters)?meters:null,durationSeconds:Number.isFinite(secs)?secs:null,etaMinutes:Number.isFinite(secs)?Math.ceil(secs/60):null}},null,2);
}
map.on('load',()=>{addLayers();loadSnapshot().catch(()=>{});});
map.on('click','technician-point',e=>selectFeature(e,'technician'));
map.on('click','installation-point',e=>selectFeature(e,'installation'));
map.on('click','fault-point',e=>selectFeature(e,'fault'));
map.on('click','asset-point',e=>selectFeature(e,'network_asset'));
map.on('click','evidence-point',e=>selectFeature(e,'evidence'));
map.on('click','ticket-location-point',e=>selectFeature(e,'ticket_location'));
$('refresh').onclick=()=>loadSnapshot();
$('nearest').onclick=()=>nearest().catch(e=>$('analysis').textContent=e.message);
$('route').onclick=()=>route().catch(e=>$('analysis').textContent='المسار غير متاح: '+e.message);
$('impact').onclick=()=>showImpact().catch(e=>$('analysis').textContent='الأثر غير متاح: '+e.message);
$('showTrack').onclick=()=>showTrack().catch(e=>$('analysis').textContent='التتبع التاريخي غير متاح: '+e.message);
$('trackHours').oninput=()=>{$('trackHoursValue').textContent=$('trackHours').value+' ساعة'};
for(const id of ['faultStatus','faultSeverity','installationStatus'])$(id).onchange=setFilterState;
for(const el of document.querySelectorAll('[data-layer]'))el.onchange=setFilterState;
setInterval(()=>loadSnapshot().catch(()=>{}),20000);
