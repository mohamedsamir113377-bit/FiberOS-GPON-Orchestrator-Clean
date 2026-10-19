'use strict';
(() => {
  const $=id=>document.getElementById(id);
  let siteLat=null,siteLon=null,identityStream=null,techStream=null,recorder=null,recordedChunks=[];
  const base=()=>{try{return window.FiberOSApiOrigin.normalizeApiBase(localStorage.getItem('fiberos_api')||location.origin,location.href,window.__FIBEROS_ALLOWED_API_ORIGINS__||[])}catch(_){return location.origin}};
  function headers(method){const h={'Content-Type':'application/json'};try{const csrf=window.FiberOSSessionAuth?.getCsrfToken?.();if(csrf&&!['GET','HEAD'].includes(method))h['X-FiberOS-CSRF']=csrf}catch(_){}return h}
  async function api(path,method='GET',body){
    const u=window.FiberOSApiOrigin.resolveApiUrl(base(),path);
    const r=await fetch(u,{method,headers:headers(method),credentials:'include',redirect:'error',cache:'no-store',body:body===undefined?undefined:JSON.stringify(body)});
    let j;try{j=await r.json()}catch(_){j={error:'INVALID_JSON_RESPONSE'}};
    if(!r.ok)throw Error(j.error||('HTTP_'+r.status));return j;
  }
  function msg(id,v){$(id).textContent=typeof v==='string'?v:JSON.stringify(v,null,2)}
  function field(id){return $(id).value.trim()}
  function dateValue(id){const v=field(id);return v?new Date(v).toISOString():null}
  async function gps(targetOut='identityStatus'){
    if(!navigator.geolocation)throw Error('GEOLOCATION_UNAVAILABLE');
    const p=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:0,timeout:15000}));
    siteLat=p.coords.latitude;siteLon=p.coords.longitude;
    $('lat').value=siteLat.toFixed(6);$('lon').value=siteLon.toFixed(6);
    msg(targetOut,'GPS: '+siteLat.toFixed(6)+', '+siteLon.toFixed(6)+' · accuracy '+Math.round(p.coords.accuracy||0)+'m');
  }
  async function camera(kind){
    if(!navigator.mediaDevices?.getUserMedia)throw Error('CAMERA_UNAVAILABLE');
    const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    if(kind==='identity'){identityStream=s;$('identityCamera').srcObject=s}else{techStream=s;$('techCamera').srcObject=s}
  }
  async function captureIdentity(){
    if(!identityStream)await camera('identity');
    const v=$('identityCamera');if(!v.videoWidth)throw Error('CAMERA_FRAME_NOT_READY');
    const c=$('identityCanvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0,c.width,c.height);
    const data=c.toDataURL('image/jpeg',0.86);
    msg('identityStatus','تم التقاط صورة الهوية محليًا. سيتم تشفيرها في الخادم عند إرسال أمر التركيب.');
    window.__identityImage=data;
  }
  async function submitIntake(){
    if(siteLat==null)await gps();
    const docs=window.__identityImage?[{documentType:field('identitySide')||'IDENTITY_FRONT',imageData:window.__identityImage,capturedAt:new Date().toISOString(),ocrText:''}]:[];
    const body={
      workflowType:field('workflowType'),serviceNumber:field('serviceNumber'),landlineNumber:field('landlineNumber'),customerName:field('customerName'),
      internetProviderName:field('internetProviderName'),companyName:field('companyName'),landlineCompanyName:field('landlineCompanyName'),followupMobile1:field('followupMobile1'),followupMobile2:field('followupMobile2'),
      identityType:field('identityType')||null,identityNumber:field('identityNumber')||null,
      addressRegion:field('addressRegion'),addressStreet:field('addressStreet'),addressBuildingNumber:field('addressBuildingNumber'),
      addressFloor:field('addressFloor'),addressApartment:field('addressApartment'),cabinetCode:field('cabinetCode'),boxCode:field('boxCode'),
      lat:siteLat,lon:siteLon,slaDurationHours:field('slaDurationHours')||null,migrationWorkOrderDate:dateValue('migrationWorkOrderDate'),
      migrationCompletionDeadlineAt:dateValue('migrationCompletionDeadlineAt'),documents:docs
    };
    const j=await api('/v1/installations/intake','POST',body);$('jobId').value=j.job.id;msg('intakeOut',j);msg('callOut','أمر '+j.job.jobCode+' جاهز لمراجعة الكول سنتر.');
  }
  async function jobAction(action,body={}){
    const id=field('jobId');if(!id)throw Error('JOB_ID_REQUIRED');
    const j=await api('/v1/installations/'+encodeURIComponent(id)+'/'+action,'POST',body);msg('statusOut',j);return j;
  }
  async function verify(){const j=await jobAction('verify',{confirmed:true,confirmedSite:true,confirmedRouter:true,routerSerial:field('routerSerial')||null,routerModel:field('routerModel')||null,routerMac:field('routerMac')||null});msg('callOut',j)}
  async function schedule(){const j=await jobAction('schedule',{visitScheduledAt:dateValue('visitScheduledAt')});msg('callOut',j)}
  async function dispatch(){const j=await jobAction('dispatch');msg('callOut',j)}
  async function accept(){const j=await jobAction('accept');msg('techOut',j)}
  async function start(){await gps('techOut');const j=await jobAction('start',{lat:siteLat,lon:siteLon});msg('techOut',j)}
  async function hashBlob(blob){const b=await blob.arrayBuffer();const d=await crypto.subtle.digest('SHA-256',b);return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
  async function recordVideo(){
    if(!techStream)await camera('tech');
    if(recorder?.state==='recording'){recorder.stop();return}
    recordedChunks=[];
    recorder=new MediaRecorder(techStream,{mimeType:'video/webm'});
    recorder.ondataavailable=e=>{if(e.data.size)recordedChunks.push(e.data)};
    recorder.onstop=async()=>{const blob=new Blob(recordedChunks,{type:'video/webm'});const hash=await hashBlob(blob);$('evidenceHash').value=hash;msg('techOut','تم تسجيل الفيديو محليًا وحساب SHA-256. '+hash+' — التخزين الدائم يحتاج مرجع تخزين مهيأ.');};
    recorder.start();msg('techOut','جاري تسجيل الفيديو… اضغط الزر مرة أخرى للإيقاف.');
  }
  async function evidence(){
    let hash=field('evidenceHash');
    if(!hash){const t=field('evidenceType');if(t==='ROUTER_LABEL_SCAN')throw Error('ROUTER_LABEL_SCAN_CAPTURE_REQUIRED');throw Error('EVIDENCE_SHA256_REQUIRED')}
    const j=await jobAction('evidence',{evidenceType:field('evidenceType'),contentSha256:hash,storageReference:field('storageReference')||null,capturedAt:new Date().toISOString(),lat:siteLat,lon:siteLon,routerSerial:field('routerSerial')||null,routerModel:field('routerModel')||null,routerMac:field('routerMac')||null,metadata:{source:'installation-command',persistentStorage:Boolean(field('storageReference')),cableFromBoxToFaceplateConfirmed:field('cableChecklist')==='true',cableSpecConfirmed:field('cableChecklist')==='true',routerInstallationOrderConfirmed:field('routerChecklist')==='true',rxDbm:field('rxDbm')===''?null:Number(field('rxDbm'))}});
    msg('techOut',j);
  }
  async function feedback(){const j=await jobAction('feedback',{rating:Number(field('rating')),feedback:field('feedback')});msg('statusOut',j)}
  async function complete(){const j=await jobAction('complete');msg('statusOut',j)}
  async function load(){const id=field('jobId');if(!id)throw Error('JOB_ID_REQUIRED');msg('statusOut',await api('/v1/installations/'+encodeURIComponent(id)))}
  async function tracking(){const id=field('jobId');if(!id)throw Error('JOB_ID_REQUIRED');msg('statusOut',await api('/v1/installations/'+encodeURIComponent(id)+'/tracking'))}
  function bind(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>msg(id==='submitIntake'?'intakeOut':id.includes('Job')?'callOut':'techOut',e.message)))}
  bind('captureSite',()=>gps());bind('startIdentityCamera',()=>camera('identity'));bind('captureIdentity',captureIdentity);bind('submitIntake',submitIntake);
  bind('verifyJob',verify);bind('scheduleJob',schedule);bind('dispatchJob',dispatch);bind('acceptJob',accept);bind('startJob',start);
  bind('recordVideo',recordVideo);bind('submitEvidence',evidence);bind('submitFeedback',feedback);bind('completeJob',complete);bind('loadJob',load);bind('loadTracking',tracking);
  $('workflowType').addEventListener('change',()=>document.body.classList.toggle('router-mode',$('workflowType').value==='ROUTER_INSTALLATION'));
  window.addEventListener('beforeunload',()=>[identityStream,techStream].filter(Boolean).forEach(s=>s.getTracks().forEach(t=>t.stop())));
})();

