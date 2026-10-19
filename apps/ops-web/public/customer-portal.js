(function customerPortal(root){
  'use strict';

  const state={bootstrap:null,overview:null,plans:[],reports:[],schedules:[],activeTab:'overview'};
  const $=(id)=>root.document.getElementById(id);
  const text=(id,value)=>{const el=$(id);if(el)el.textContent=value==null?'—':String(value)};
  const esc=(v)=>String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const toast=(message,type='good')=>{const el=root.document.createElement('div');el.className='toast '+type;el.textContent=message;$('toastRegion').appendChild(el);setTimeout(()=>el.remove(),4200)};
  const apiBase=()=>{
    const configured=root.FIBEROS_API_BASE||root.location.origin;
    try{
      if(root.FiberOSApiOrigin&&root.FiberOSApiOrigin.normalizeApiBase) return root.FiberOSApiOrigin.normalizeApiBase(configured,root.location.href,root.__FIBEROS_ALLOWED_API_ORIGINS__||[]);
    }catch(_){}
    return configured.replace(/\/+$/,'');
  };
  async function api(path,options={}){
    const headers={Accept:'application/json',...(options.headers||{})};
    if(options.body!==undefined){headers['Content-Type']='application/json';}
    if(options.method&& !['GET','HEAD','OPTIONS'].includes(options.method.toUpperCase())){
      const csrf=root.FiberOSSessionAuth&&root.FiberOSSessionAuth.getCsrfToken?root.FiberOSSessionAuth.getCsrfToken():'';
      if(csrf)headers['X-FiberOS-CSRF']=csrf;
    }
    const res=await root.fetch(apiBase()+path,{credentials:'include',cache:'no-store',redirect:'error',...options,headers});
    let body=null;try{body=await res.json()}catch(_){}
    if(!res.ok)throw Object.assign(new Error(body&&body.error||('HTTP_'+res.status)),{status:res.status,body});
    return body||{};
  }
  function idempotency(prefix){return prefix+'-'+root.crypto.randomUUID();}
  function fmtDate(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(d)}
  function fmtNum(v,suffix=''){return v==null?'—':new Intl.NumberFormat().format(Number(v))+suffix}
  function setConnection(ok){text('connectionText',ok?'Live':'Unavailable');const dot=root.document.querySelector('.live-dot');if(dot)dot.style.opacity=ok?'1':'.35'}
  function evidenceClass(v){if(v&&typeof v==='object'&&v.evidenceClass)return v.evidenceClass;return 'persisted'}
  function renderBootstrap(data){
    state.bootstrap=data;
    text('tenantChip',data.tenant?.name||'Tenant');
    const sub=data.subscription;
    const s=$('subStatus'); if(s)s.textContent=sub?String(sub.status).replace(/_/g,' '):'No live subscription';
    const detail=$('subscriptionDetail');
    if(detail)detail.innerHTML=sub?[
      ['Plan',sub.plan_name||sub.plan_code],['Work domain',sub.work_type_name||'—'],
      ['Cadence',sub.billing_interval],['Payment',sub.payment_state],
      ['Period end',fmtDate(sub.current_period_end)],['Auto-renew',sub.auto_renew?'Enabled':'Disabled']
    ].map(([k,v])=>'<div><span>'+esc(k)+'</span><b>'+esc(v)+'</b></div>').join(''):'<div><span>Status</span><b>Select a catalog plan below.</b></div>';
    renderPlans(data.plans||[]);
    renderWorkTypes(data.workTypes||[]);
  }
  function renderPlans(plans){
    state.plans=plans;
    const workFilter=$('planWorkFilter');
    if(workFilter){
      const current=workFilter.value;
      const types=[...new Map(plans.map(p=>[p.work_type_code,p])).values()];
      workFilter.innerHTML='<option value="">All domains</option>'+types.map(p=>'<option value="'+esc(p.work_type_code)+'">'+esc(p.work_type_code)+'</option>').join('');
      workFilter.value=current;
    }
    drawPlans();
  }
  function drawPlans(){
    const filter=$('planWorkFilter')?.value||'',cad=$('planCadenceFilter')?.value||'';
    const list=state.plans.filter(p=>(!filter||p.work_type_code===filter)&&(!cad||p.billing_interval===cad));
    const grid=$('planGrid');
    if(!grid)return;
    grid.innerHTML=list.map(p=>{
      const flags=p.feature_flags&&typeof p.feature_flags==='object'?Object.entries(p.feature_flags).filter(([,v])=>v).map(([k])=>k):[];
      const price=p.quote_required?'Quote required':(p.amount_minor==null?'Price not configured':(p.amount_minor+' '+(p.currency||'')));
      return '<article class="plan-card"><div class="eyebrow">'+esc(p.billing_interval.toUpperCase())+'</div><h4>'+esc(p.display_name)+'</h4><p>'+esc(p.summary)+'</p><div class="plan-meta"><span>'+esc(price)+'</span><span>'+esc(p.work_type_code)+'</span></div><div class="plan-features">'+flags.map(x=>'<span class="tag">'+esc(x)+'</span>').join('')+'</div><button class="primary-btn" data-plan-id="'+esc(p.id)+'">Choose plan</button></article>';
    }).join('')||'<div class="glass-card">No plan matches the current filter.</div>';
  }
  function renderWorkTypes(types){
    const wrap=$('workTypes');if(!wrap)return;
    wrap.innerHTML=types.map(w=>'<article class="work-card"><div class="eyebrow">'+esc(w.discipline)+'</div><h4>'+esc(w.display_name)+'</h4><p>'+esc(w.summary)+'</p></article>').join('');
    const standards=$('standardsGrid');
    if(standards)standards.innerHTML=types.map(w=>{
      const refs=Array.isArray(w.standards)?w.standards:[];
      return '<article class="standard-card"><h3>'+esc(w.display_name)+'</h3><p>'+esc(w.summary)+'</p><ul>'+refs.map(r=>'<li><b>'+esc(r.ref)+'</b> — '+esc(r.edition)+'</li>').join('')+'</ul><div>'+((w.required_evidence||[]).map(x=>'<span class="tag">'+esc(x)+'</span>').join(' '))+'</div></article>';
    }).join('');
  }
  function renderOverview(report){
    state.overview=report;
    const op=report.operations||{},net=report.network||{},q=report.quality||{},field=report.field||{},eng=report.engineering||{};
    const services=op.services||{},tickets=op.tickets||{},inc=op.incidents||{},assets=net.assets||{},tele=net.telemetry||{};
    text('mServices',fmtNum(services.active));text('mSpeed',services.declaredSpeedMaxMbps!=null?'Observed/declared max: '+fmtNum(services.declaredSpeedMaxMbps,' Mbps'):'Observed/declared speed: —');
    text('mBacklog',fmtNum(tickets.openBacklog));text('mCritical',fmtNum(inc.critical));
    text('mCapacity',fmtNum(assets.overCapacity));text('mCapacitySub',assets.avgUtilizationPct!=null?'Avg utilization '+assets.avgUtilizationPct+'%':'Network-derived');
    const ftf=(q.firstTimeFix||{}).ratePct;text('mFtf',ftf==null?'—':ftf+'%');
    text('mOptical',fmtNum(tele.rxPowerSamples));
    text('oAssets',fmtNum(assets.total));text('oUtil',assets.avgUtilizationPct==null?'—':assets.avgUtilizationPct+'%');text('oOver',fmtNum(assets.overCapacity));
    text('oRx',tele.latestRxPowerDbm==null?'—':tele.latestRxPowerDbm+' dBm');text('oTelemetry',fmtNum(tele.total));text('oLastObs',fmtDate(tele.lastObservedAt));
    const pct=ftf==null?0:Math.max(0,Math.min(100,Number(ftf)));const ring=$('healthRing'),label=$('healthPct');
    if(ring)ring.style.background='conic-gradient(var(--cp-accent) '+(pct*3.6)+'deg,rgba(255,255,255,.07) 0deg)';
    if(label)label.textContent=ftf==null?'—':Math.round(pct)+'%';
    text('healthLabel',ftf==null?'Unknown':(pct>=90?'Strong':pct>=75?'Healthy':'Needs attention'));
    const delivery=$('deliveryFacts');if(delivery)delivery.innerHTML=[
      ['Active work packages',field.workPackages?.active],['Accepted in window',field.workPackages?.acceptedInWindow],
      ['Rework',field.workPackages?.rework],['Active contractors',field.contractors?.active],
      ['Qualified contractors',field.contractors?.qualified]
    ].map(([k,v])=>'<div class="fact-row"><span>'+esc(k)+'</span><b>'+esc(fmtNum(v))+'</b></div>').join('');
    const ef=$('engineeringFacts');if(ef)ef.innerHTML=[
      ['Optical samples',eng.opticalMeasurements?.samples],['Field / NMS',eng.opticalMeasurements?.fieldOrNms],
      ['Path-bound assessments',eng.pathBoundAssurance?.assessments],['Path-bound',eng.pathBoundAssurance?.pathBound],
      ['Current RX values',eng.pathBoundAssurance?.withCurrentRx]
    ].map(([k,v])=>'<div class="fact-row"><span>'+esc(k)+'</span><b>'+esc(fmtNum(v))+'</b></div>').join('');
  }
  async function loadBootstrap(){
    try{const data=await api('/v1/customer-portal/bootstrap');renderBootstrap(data);const ov=await api('/v1/customer-portal/overview?days=30');renderOverview(ov.report);setConnection(true);return true}
    catch(e){setConnection(false);toast('Portal unavailable: '+e.message,'error');return false}
  }
  async function loadReports(){
    try{const data=await api('/v1/customer-portal/reports');state.reports=data.reports||[];const box=$('reportHistory');if(box)box.innerHTML=state.reports.map(r=>'<div class="history-row"><b>'+esc(r.report_type)+'</b><small>'+esc(r.report_format.toUpperCase())+'</small><small>'+esc(fmtDate(r.generated_at||r.created_at))+'</small><button class="mini-btn" data-report-id="'+esc(r.id)+'">Open</button></div>').join('')||'<div class="fact-row">No reports yet.</div>'}catch(e){toast('Could not load reports: '+e.message,'error')}
  }
  async function loadSchedules(){
    try{const data=await api('/v1/customer-portal/report-schedules');state.schedules=data.schedules||[];const box=$('scheduleHistory');if(box)box.innerHTML=state.schedules.map(s=>'<div class="history-row"><b>'+esc(s.name)+'</b><small>'+esc(s.report_type)+' · '+esc(s.cadence)+'</small><small>Next: '+esc(fmtDate(s.next_run_at))+'</small><button class="mini-btn" data-schedule-action="'+esc(s.active?'pause':'resume')+'" data-schedule-id="'+esc(s.id)+'">'+(s.active?'Pause':'Resume')+'</button></div>').join('')||'<div class="fact-row">No scheduled reports yet.</div>'}catch(e){toast('Could not load timers: '+e.message,'error')}
  }
  async function loadMembers(){
    try{const data=await api('/v1/customer-portal/members');const box=$('teamList');if(box)box.innerHTML=(data.members||[]).map(m=>'<div class="history-row"><b>'+esc(m.portal_role)+'</b><small>'+esc(m.user_id)+'</small><small>'+esc((m.work_type_scope||[]).join(', ')||'All allowed scopes')+'</small><span class="evidence-badge '+(m.active?'observed':'protected')+'">'+(m.active?'ACTIVE':'OFF')+'</span></div>').join('')||'<div class="fact-row">No delegated portal members.</div>'}catch(e){const box=$('teamList');if(box)box.innerHTML='<div class="fact-row">Team administration is available to tenant admins.</div>'}
  }
  async function generateReport(){
    const reportType=$('reportType').value,days=Number($('reportDays').value),format=$('reportFormat').value;
    const end=new Date(),start=new Date(end.getTime()-days*86400000);
    try{
      const data=await api('/v1/customer-portal/reports/run',{method:'POST',body:JSON.stringify({reportType,format,periodStart:start.toISOString(),periodEnd:end.toISOString(),idempotencyKey:idempotency('report')})});
      const output=format==='csv'?data.csv:JSON.stringify(data.run?.report_payload||data.run,null,2);
      $('reportOutput').textContent=output||'Report generated.';
      if(format==='csv'){const blob=new Blob([output],{type:'text/csv;charset=utf-8'});const url=root.URL.createObjectURL(blob);const a=root.document.createElement('a');a.href=url;a.download='fiberos-'+reportType+'-'+days+'d.csv';a.click();setTimeout(()=>root.URL.revokeObjectURL(url),1000)}
      toast('Report generated and hashed successfully.');await loadReports();
    }catch(e){toast('Report failed: '+e.message,'error')}
  }
  async function choosePlan(planId){
    try{
      const data=await api('/v1/customer-portal/subscriptions',{method:'POST',body:JSON.stringify({planId,idempotencyKey:idempotency('subscribe')})});
      toast(data.checkout?.quoteRequired?'Request created — seller quote required.':'Subscription created — external checkout/provider is next.');await loadBootstrap();
    }catch(e){toast('Subscription action failed: '+e.message,'error')}
  }
  async function mutateSubscription(action){
    const sub=state.bootstrap?.subscription;if(!sub){toast('No active subscription selected.','error');return}
    const value=action==='toggle-renew'?Boolean(!sub.auto_renew):undefined;
    const path=action==='cancel'?'/cancel':action==='pause'?'/pause':'/auto-renew';
    try{await api('/v1/customer-portal/subscriptions/'+encodeURIComponent(sub.id)+path,{method:'POST',body:JSON.stringify({...((action==='toggle-renew')?{autoRenew:value}:{}),idempotencyKey:idempotency(action)})});toast('Subscription state updated.');await loadBootstrap()}catch(e){toast('Subscription update failed: '+e.message,'error')}
  }
  function updateScheduleFields(){
    const c=$('scheduleCadence').value;
    $('scheduleWeekdayWrap').hidden=c!=='weekly';$('scheduleDayWrap').hidden=c==='weekly';$('scheduleMonthWrap').hidden=c!=='yearly';
  }
  async function saveSchedule(){
    const recipients=$('scheduleRecipients').value.split(',').map(x=>x.trim()).filter(Boolean);
    const payload={
      name:$('scheduleName').value.trim(),reportType:$('scheduleReportType').value,
      cadence:$('scheduleCadence').value,timezone:$('scheduleTimezone').value.trim(),
      hour:Number($('scheduleHour').value),minute:Number($('scheduleMinute').value),
      weekday:Number($('scheduleWeekday').value),dayOfMonth:Number($('scheduleDay').value),monthOfYear:Number($('scheduleMonth').value),
      recipients,idempotencyKey:idempotency('schedule')
    };
    try{const data=await api('/v1/customer-portal/report-schedules',{method:'POST',body:JSON.stringify(payload)});toast('Timer created. Next run: '+fmtDate(data.schedule?.next_run_at));await loadSchedules()}catch(e){toast('Timer creation failed: '+e.message,'error')}
  }
  async function toggleSchedule(id,action){
    try{await api('/v1/customer-portal/report-schedules/'+encodeURIComponent(id)+'/'+action,{method:'POST',body:JSON.stringify({idempotencyKey:idempotency('schedule-'+action)})});toast('Schedule '+action+'d.');await loadSchedules()}catch(e){toast('Schedule update failed: '+e.message,'error')}
  }
  async function addMember(){
    const payload={userId:$('memberUserId').value.trim(),portalRole:$('memberRole').value,workTypeScope:$('memberScope').value.split(',').map(x=>x.trim()).filter(Boolean),idempotencyKey:idempotency('member')};
    try{await api('/v1/customer-portal/members',{method:'POST',body:JSON.stringify(payload)});toast('Portal access saved.');await loadMembers()}catch(e){toast('Member save failed: '+e.message,'error')}
  }
  async function openReport(id){
    try{const data=await api('/v1/customer-portal/reports/'+encodeURIComponent(id));const r=data.report;$('reportOutput').textContent=r.rendered_csv||JSON.stringify(r.report_payload||r,null,2);showTab('reports')}catch(e){toast('Report read failed: '+e.message,'error')}
  }
  function showTab(tab){
    state.activeTab=tab;root.document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));root.document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===tab));
    if(tab==='reports')loadReports();if(tab==='schedules')loadSchedules();if(tab==='team')loadMembers();
  }
  root.document.addEventListener('click',(event)=>{
    const tab=event.target.closest('[data-tab]');if(tab){showTab(tab.dataset.tab);return}
    const plan=event.target.closest('[data-plan-id]');if(plan){choosePlan(plan.dataset.planId);return}
    const report=event.target.closest('[data-report-id]');if(report){openReport(report.dataset.reportId);return}
    const sched=event.target.closest('[data-schedule-id]');if(sched){toggleSchedule(sched.dataset.scheduleId,sched.dataset.scheduleAction);return}
    const action=event.target.closest('[data-action]')?.dataset.action;
    if(!action)return;
    if(action==='refresh')loadBootstrap();
    else if(action==='generate-report'||action==='run-report'){showTab('reports');generateReport()}
    else if(action==='load-reports')loadReports();
    else if(action==='load-schedules')loadSchedules();
    else if(action==='save-schedule')saveSchedule();
    else if(action==='add-member')addMember();
    else if(action==='toggle-renew'||action==='pause-sub'||action==='cancel-sub')mutateSubscription(action);
  });
  $('planWorkFilter')?.addEventListener('change',drawPlans);$('planCadenceFilter')?.addEventListener('change',drawPlans);$('scheduleCadence')?.addEventListener('change',updateScheduleFields);
  async function start(){
    if(root.FiberOSSessionAuth){const s=await root.FiberOSSessionAuth.refresh();if(!s.authenticated){setConnection(false);toast('Sign in through the secure enterprise identity provider.','error');return}}
    updateScheduleFields();await loadBootstrap();await loadReports();await loadSchedules();if(state.bootstrap?.capabilities?.membershipAdmin)loadMembers();
  }
  start().catch(e=>toast('Portal startup failed: '+e.message,'error'));
})(window);