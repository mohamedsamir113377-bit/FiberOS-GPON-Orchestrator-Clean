(() => {
'use strict';
const $=id=>document.getElementById(id);
const API=window.FiberOSApiOrigin;
const base=API?API.normalizeApiBase('',location.href,window.__FIBEROS_ALLOWED_API_ORIGINS__||[]):location.origin;
const get=(path)=>fetch(API?API.resolveApiUrl(base,path):new URL(path,base),{credentials:'include',cache:'no-store'}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||('HTTP_'+r.status));return d;});
const post=(path,body)=>{const headers={'content-type':'application/json'};try{const csrf=window.FiberOSSessionAuth?.getCsrfToken?.();if(csrf)headers['X-FiberOS-CSRF']=csrf}catch(_){}return fetch(API?API.resolveApiUrl(base,path):new URL(path,base),{method:'POST',credentials:'include',headers,body:JSON.stringify(body)}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||('HTTP_'+r.status));return d;});};
let siteLat=null,siteLon=null,stream=null,recorder=null,chunks=[],mime='video/webm',photoHash=null,videoHash=null;
function field(id){return $(id)?.value?.trim()||''}
function dateValue(id){const v=field(id);return v?new Date(v).toISOString():null}
async function sha(blob){const b=await blob.arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function gps(target='callOut'){if(!navigator.geolocation)throw Error('GEOLOCATION_UNAVAILABLE');const p=await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));siteLat=p.coords.latitude;siteLon=p.coords.longitude;if(target==='techOut'){ $('techLat').value=siteLat.toFixed(6);$('techLon').value=siteLon.toFixed(6);}else{$('lat').value=siteLat.toFixed(6);$('lon').value=siteLon.toFixed(6);} $('intakeOut').textContent='موقع حقيقي: '+siteLat.toFixed(6)+' , '+siteLon.toFixed(6);return {lat:siteLat,lon:siteLon}}
async function apiAction(action,body={}){const id=field('jobId');if(!id)throw Error('FAULT_JOB_ID_REQUIRED');return post('/v1/faults/'+encodeURIComponent(id)+'/'+action,body)}
async function camera(){if(!navigator.mediaDevices?.getUserMedia)throw Error('CAMERA_UNAVAILABLE');if(stream)return;stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});$('camera').srcObject=stream}
async function captureFrame(){await camera();const v=$('camera');if(!v.videoWidth)throw Error('CAMERA_FRAME_NOT_READY');const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0,c.width,c.height);return new Promise(r=>c.toBlob(r,'image/jpeg',.9))}
async function recordPhoto(){const blob=await captureFrame();photoHash=await sha(blob);$('evidenceHash').value=photoHash;window.__faultPhotoBlob=blob;$('techOut').textContent='تم التقاط صورة فعلية وحساب SHA-256: '+photoHash+' — التخزين الدائم يحتاج provider/object-storage مهيأ.'}
async function recordVideo(){await camera();if(recorder?.state==='recording'){recorder.stop();return}chunks=[];mime=['video/mp4;codecs=avc1.42E01E','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported?.(x))||'video/webm';recorder=new MediaRecorder(stream,{mimeType:mime});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=async()=>{const blob=new Blob(chunks,{type:mime});videoHash=await sha(blob);$('evidenceHash').value=videoHash;$('techOut').textContent='تم تسجيل فيديو فعلي وحساب SHA-256: '+videoHash+' — التخزين الدائم يحتاج provider/object-storage مهيأ.'};recorder.start();$('techOut').textContent='جاري تسجيل الفيديو… اضغط مرة أخرى للإيقاف.'}
$('captureSite').onclick=()=>gps().catch(e=>$('intakeOut').textContent=e.message);
$('submitIntake').onclick=async()=>{try{
  if(siteLat==null) await gps();
  const d=await post('/v1/faults/intake',{
    serviceNumber:field('serviceNumber'),
    customerName:field('customerName'),
    landlineCompanyName:field('landlineCompanyName'),
    internetProviderName:field('internetProviderName'),
    followupMobile1:field('followupMobile1'),
    followupMobile2:field('followupMobile2'),
    faultType:field('faultType'),
    severity:field('severity'),
    faultDescription:field('faultDescription'),
    addressRegion:field('addressRegion'),
    addressStreet:field('addressStreet'),
    addressBuildingNumber:field('addressBuildingNumber'),
    addressFloor:field('addressFloor'),
    addressApartment:field('addressApartment'),
    cabinetCode:field('cabinetCode'),
    boxCode:field('boxCode'),
    rootAssetId:field('rootAssetId')||null,
    lat:siteLat,
    lon:siteLon,
    slaDurationHours:field('slaDurationHours')||null,
    outageStartedAt:dateValue('outageStartedAt')||null
  });
  $('jobId').value=d.fault.id||d.fault?.job_id||'';
  $('intakeOut').textContent=JSON.stringify(d,null,2);
}catch(e){
  $('intakeOut').textContent=e.message;
}};
$('verifyJob').onclick=()=>apiAction('verify',{confirmed:true,confirmedSite:true}).then(d=>$('callOut').textContent=JSON.stringify(d,null,2)).catch(e=>$('callOut').textContent=e.message);
$('scheduleJob').onclick=()=>apiAction('schedule',{visitScheduledAt:dateValue('visitScheduledAt')}).then(d=>$('callOut').textContent=JSON.stringify(d,null,2)).catch(e=>$('callOut').textContent=e.message);
$('dispatchJob').onclick=()=>apiAction('dispatch').then(d=>$('callOut').textContent=JSON.stringify(d,null,2)).catch(e=>$('callOut').textContent=e.message);
$('acceptJob').onclick=()=>apiAction('accept').then(d=>$('techOut').textContent=JSON.stringify(d,null,2)).catch(e=>$('techOut').textContent=e.message);
$('startJob').onclick=async()=>{try{await gps('techOut');const d=await apiAction('start',{lat:siteLat,lon:siteLon});$('techOut').textContent=JSON.stringify(d,null,2)}catch(e){$('techOut').textContent=e.message}};
$('captureTechGps').onclick=()=>gps('techOut').catch(e=>$('techOut').textContent=e.message);
$('recordPhoto').onclick=()=>recordPhoto().catch(e=>$('techOut').textContent=e.message);
$('recordVideo').onclick=()=>recordVideo().catch(e=>$('techOut').textContent=e.message);
$('submitEvidence').onclick=async()=>{try{const type=field('evidenceType');const hash=field('evidenceHash');if(!hash)throw Error('EVIDENCE_CAPTURE_OR_HASH_REQUIRED');const la=Number(field('techLat')),lo=Number(field('techLon'));if(!Number.isFinite(la)||!Number.isFinite(lo))throw Error('TECHNICIAN_GPS_REQUIRED');const d=await apiAction('evidence',{evidenceType:type,contentSha256:hash,storageReference:field('storageReference')||null,lat:la,lon:lo,metadata:{rxDbm:field('rxDbm')===''?null:Number(field('rxDbm')),syntheticData:false}});$('techOut').textContent=JSON.stringify(d,null,2)}catch(e){$('techOut').textContent=e.message}};
$('submitFeedback').onclick=()=>apiAction('feedback',{accepted:field('accepted')==='true',rating:field('rating')===''?null:Number(field('rating')),feedback:field('feedback')}).then(d=>$('statusOut').textContent=JSON.stringify(d,null,2)).catch(e=>$('statusOut').textContent=e.message);
$('resolveJob').onclick=()=>apiAction('resolve',{resolutionCode:field('resolutionCode'),resolutionNotes:field('resolutionNotes')}).then(d=>$('statusOut').textContent=JSON.stringify(d,null,2)).catch(e=>$('statusOut').textContent=e.message);
window.addEventListener('beforeunload',()=>stream?.getTracks().forEach(t=>t.stop()));
})();
