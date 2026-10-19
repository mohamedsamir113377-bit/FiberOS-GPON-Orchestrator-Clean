const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusClass=s=>({OK:'ok',ZERO_DATA:'zero',DATA_UNAVAILABLE:'unavailable',DEGRADED:'degraded',STATIC:'static',UNSET:'unset'}[String(s||'UNKNOWN').toUpperCase()]||'unknown');
const status=(s,label)=>`<span class="fos-status fos-status-${statusClass(s)}" data-status="${esc(String(s||'UNKNOWN').toUpperCase())}">${esc(label||String(s||'UNKNOWN').replaceAll('_',' '))}</span>`;

class FiberStatusBadge extends HTMLElement{
 connectedCallback(){this.render()}
 attributeChangedCallback(){this.render()}
 static get observedAttributes(){return ['status','label']}
 render(){this.innerHTML=status(this.getAttribute('status'),this.getAttribute('label'))}
}
class FiberEntityHeader extends HTMLElement{
 connectedCallback(){this.render()}
 attributeChangedCallback(){this.render()}
 static get observedAttributes(){return ['kind','entity-id','label','status','scope','source']}
 render(){
  const id=this.getAttribute('entity-id')||'UNKNOWN';
  const label=this.getAttribute('label')||id;
  const kind=this.getAttribute('kind')||'UNKNOWN';
  this.innerHTML=`<header class="fos-entity-header"><div class="fos-entity-kicker">${esc(kind)}</div><h3>${esc(label)}</h3><code>${esc(id)}</code><fiber-status-badge status="${esc(this.getAttribute('status')||'UNKNOWN')}"></fiber-status-badge>${this.getAttribute('scope')?`<span class="fos-entity-scope">${esc(this.getAttribute('scope'))}</span>`:''}${this.getAttribute('source')?`<span class="fos-entity-source">${esc(this.getAttribute('source'))}</span>`:''}</header>`
 }
}
class FiberContextDrawer extends HTMLElement{
 connectedCallback(){this.render()}
 render(){this.innerHTML=`<div class="fos-drawer-head"><strong>${esc(this.getAttribute('title')||'Context')}</strong><button type="button" data-close-context>Close</button></div><dl><div><dt>Scope</dt><dd data-nexus-scope>Server-resolved scope required</dd></div><div><dt>Filters</dt><dd data-nexus-filters>No filters</dd></div><div><dt>Time</dt><dd data-nexus-time>All available time</dd></div></dl>`;this.setAttribute('role','dialog');this.setAttribute('aria-label',this.getAttribute('title')||'Context')}
 setContext({scope,filters,timeRange}={}){const s=scope?`${scope.level} / ${scope.id}`:'Server-resolved scope required';this.querySelector('[data-nexus-scope]').textContent=s;this.querySelector('[data-nexus-filters]').textContent=(filters||[]).map(x=>`${x.field}=${x.value}`).join(' · ')||'No filters';this.querySelector('[data-nexus-time]').textContent=timeRange&&(timeRange.start||timeRange.end)?`${timeRange.start||'—'} → ${timeRange.end||'—'}`:'All available time'}
}
class FiberSourceDrawer extends HTMLElement{
 connectedCallback(){this.render()}
 render(){this.innerHTML=`<div><b>Source</b><span data-source>${esc(this.getAttribute('source')||'UNKNOWN')}</span></div><div><b>Authority</b><span data-authority>${esc(this.getAttribute('authority')||'UNKNOWN')}</span></div><div><b>As of</b><span data-asof>${esc(this.getAttribute('as-of')||'Unavailable')}</span></div>`}
}
class FiberEvidenceCard extends HTMLElement{
 connectedCallback(){this.render()}
 render(){const refs=(this.getAttribute('refs')||'').split('|').filter(Boolean);const limits=(this.getAttribute('limitations')||'').split('|').filter(Boolean);this.innerHTML=`<div class="fos-evidence-head"><b>${esc(this.getAttribute('title')||'Evidence')}</b>${status(this.getAttribute('status')||'UNKNOWN')}</div><div class="fos-evidence-refs">${refs.map(x=>`<code>${esc(x)}</code>`).join('')||'<span>Evidence unavailable</span>'}</div><div class="fos-evidence-limits">${limits.map(x=>`<span>${esc(x)}</span>`).join('')||'<span>No additional limitations supplied</span>'}</div>`}
}
if(window.customElements){
 [['fiber-status-badge',FiberStatusBadge],['fiber-entity-header',FiberEntityHeader],['fiber-context-drawer',FiberContextDrawer],['fiber-source-drawer',FiberSourceDrawer],['fiber-evidence-card',FiberEvidenceCard]].forEach(([name,ctor])=>{if(!customElements.get(name))customElements.define(name,ctor)})
}
window.FiberOSNexusComponents=Object.freeze({version:'1.0.0',contracts:['fiber-status-badge','fiber-entity-header','fiber-context-drawer','fiber-source-drawer','fiber-evidence-card']});
export {status,esc,statusClass};
