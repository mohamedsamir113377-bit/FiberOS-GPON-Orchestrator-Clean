
(()=>{"use strict";
const DATA="/buyer-data.json";
const S={data:null,status:"ALL",q:"",progress:0};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const cls=s=>({REAL:"real",ADVISORY:"advisory",INTEGRATION_REQUIRED:"boundary",VISION:"demo",UNIMPLEMENTED:"boundary"}[s]||"boundary");
function syncCapabilityHeading(){
 const heading=document.querySelector('#capabilities h2');
 if(!heading||!S.data||!Array.isArray(S.data.capabilities))return;
 heading.innerHTML=S.data.capabilities.length+' capabilities.<br><em>Five status classes.</em>';
}
const steps=[["01","System","architecture"],["02","Operations","operations"],["03","Network","network"],["04","Spatial","twin"],["05","Field","field"],["06","Engineering","optical"],["07","Reliability","reliability"],["08","Security","security"],["09","Capabilities","capabilities"],["10","Verification","verification"]];
function calc(){const n=i=>Number(document.getElementById(i)?.value||0);const rx=n("tx")-n("km")*n("att")-n("splices")*n("sl")-n("cl");document.getElementById("rx").textContent=rx.toFixed(2)+" dBm";}
function metrics(){const f=S.data.facts;const a=[[f.capabilityTotal,"capabilities / registry"],[f.numberedMigrations,"numbered migrations / "+f.migrationRange],[f.v1MetaEndpointEntries,"endpoint entries / v1 meta"],[f.totalNodeTestFiles,"node:test files / product + buyer"]];document.getElementById("metrics").innerHTML=a.map(x=>"<div class=metric><strong>"+x[0]+"</strong><span>"+esc(x[1])+"</span></div>").join("");}
function filters(){const f=S.data.facts.statusCounts;const a=["ALL","REAL","INTEGRATION_REQUIRED","ADVISORY","VISION","UNIMPLEMENTED"];document.getElementById("filters").innerHTML=a.map(x=>{const n=x==="ALL"?S.data.capabilities.length:(f[x]||0);return "<button type=button class='ghost filter "+(S.status===x?"active":"")+"' data-status='"+x+"'>"+x.replaceAll("_"," ")+" · "+n+"</button>"}).join("");}
function caps(){syncCapabilityHeading();const q=S.q.toLowerCase();const rows=S.data.capabilities.filter(c=>(S.status==="ALL"||c.status===S.status)&&(!q||(c.id+" "+c.name+" "+c.status).toLowerCase().includes(q)));document.getElementById("capTable").innerHTML=rows.map(c=>"<div class=cap-row><div class=cap-id>"+esc(c.id)+"</div><div><div class=cap-name>"+esc(c.name)+"</div>"+(c.evidence||[]).slice(0,2).map(e=>"<span class=cap-meta>"+esc(e)+"</span>").join("")+"</div><div class=cap-status><span class='tag "+cls(c.status)+"'>"+c.status.replaceAll("_"," ")+"</span></div></div>").join("")||"<div class=verify>No match.</div>";}
function verify(){const f=S.data.facts,a=[[f.capabilityTotal,"CAPABILITY REGISTRY"],[f.numberedMigrations,"NUMBERED MIGRATIONS"],[f.workspacePackageManifests,"PACKAGE.JSON MANIFESTS"],[f.totalNodeTestFiles,"NODE:TEST FILES"],[f.v1MetaEndpointEntries,"/v1/META ENTRIES"],[f.verifiedLocaleCount,"VERIFIED LOCALES"],[f.localeCatalogFiles,"LOCALE CATALOG FILES"],[f.structuralPlaceholders,"STRUCTURAL PLACEHOLDERS"]];document.getElementById("verify").innerHTML=a.map(x=>"<div class='panel verify'><strong>"+x[0]+"</strong><span>"+x[1]+"</span></div>").join("");}
function evaluation(){document.getElementById("eval").innerHTML=steps.map((x,i)=>"<button class='eval-step "+(i<S.progress?"done":"")+"' data-target='"+x[2]+"' type=button><span class=n>"+x[0]+"</span><span><h3>"+x[1]+"</h3><p>Open this evidence-bound surface.</p></span></button>").join("");document.getElementById("prog").textContent=S.progress+" / 10";}
function sources(){document.getElementById("sources").innerHTML=S.data.sourceLinks.map(p=>"<a href='/trust/#evidence'><span>"+esc(p)+"</span><span>Evidence boundary ↗</span></a>").join("");}
function nexus(){
 const form=document.getElementById("universalCommand"),input=document.getElementById("universalQuery"),kind=document.getElementById("nexusEntityKind"),scopeLevel=document.getElementById("nexusScopeLevel"),scopeId=document.getElementById("nexusScopeId"),result=document.getElementById("nexusContract"),results=document.getElementById("nexusSearchResults"),header=document.getElementById("nexusEntityHeader"),drawer=document.getElementById("contextDrawer"),toggle=document.getElementById("contextToggle");
 if(!form||!input)return;
 const escHtml=esc;
 const classify=(q)=>{
  const needle=q.toLowerCase();
  const matches=S.data.capabilities.filter(x=>(x.id+" "+x.name+" "+x.status+" "+(x.evidence||[]).join(" ")).toLowerCase().includes(needle)).slice(0,8);
  results.innerHTML=matches.length?matches.map(x=>`<div class="nexus-result"><code>${escHtml(x.status)}</code><div><strong>${escHtml(x.name)}</strong><span>${escHtml(x.id)}</span></div><code>${escHtml((x.evidence||[])[0]||"registry")}</code></div>`).join(""):`<div class="nexus-result"><code>NO MATCH</code><div><strong>No shipped registry entry matched</strong><span>Runtime entity search still requires a server endpoint and authorized scope.</span></div><code>NO SYNTHETIC FALLBACK</code></div>`;
 };
 const build=()=>{
  const query=input.value.trim();
  if(!query){result.textContent="QUERY_REQUIRED";return null}
  const lvl=scopeLevel.value.trim(),sid=scopeId.value.trim();
  if(lvl&&!sid){result.textContent="SCOPE_ID_REQUIRED";return null}
  const contract={
   version:"1.0.0",
   intent:"SEARCH",
   search:{query:query.slice(0,256),entityKind:kind.value||null,execution:"SERVER_REQUIRED",fallback:"NONE",syntheticData:false},
   requestedScope:lvl?{level:lvl,id:sid}:null,
   timeRange:null,
   pagination:{offset:0,limit:50,maxLimit:200},
   authorization:"REQUIRED",
   tenantAuthority:"SERVER_DERIVED",
   clientSuppliedTenantAuthority:false,
   execution:"DEFERRED_TO_SERVER",
   resultAuthority:"UNSET_UNTIL_EXECUTED",
   stages:["USER_INTENT","QUERY_CONTRACT","AUTHORIZATION","TENANT_SCOPE","RESOURCE_SCOPE","DATABASE_QUERY","AGGREGATION","PAGINATION","TRUTH_ENVELOPE","RESPONSE"]
  };
  header.setAttribute("kind",kind.value||"QUERY");
  header.setAttribute("entity-id",query.slice(0,64));
  header.setAttribute("label","Query Contract");
  header.setAttribute("status","UNSET");
  header.setAttribute("scope",lvl?lvl+" / "+sid:"Server-resolved");
  header.setAttribute("source","Query & Scope Engine");
  result.textContent=JSON.stringify(contract,null,2);
  classify(query);
  if(drawer?.setContext)drawer.setContext({scope:contract.requestedScope,filters:[],timeRange:null});
  return contract;
 };
 form.addEventListener("submit",e=>{e.preventDefault();build()});
 input.addEventListener("input",()=>{if(S.data)classify(input.value.trim())});
 toggle?.addEventListener("click",()=>{const open=drawer.getAttribute("data-open")==="true";drawer.setAttribute("data-open",String(!open));if(drawer.setContext)drawer.setContext({scope:scopeLevel.value&&scopeId.value?{level:scopeLevel.value,id:scopeId.value}:null,filters:[],timeRange:null})});
 drawer?.addEventListener("click",e=>{if(e.target.closest("[data-close-context]"))drawer.setAttribute("data-open","false")});
}
function bind(){document.getElementById("capSearch").addEventListener("input",e=>{S.q=e.target.value;caps()});document.getElementById("filters").addEventListener("click",e=>{const b=e.target.closest("[data-status]");if(!b)return;S.status=b.dataset.status;filters();caps()});document.getElementById("eval").addEventListener("click",e=>{const b=e.target.closest("[data-target]");if(!b)return;const i=steps.findIndex(x=>x[2]===b.dataset.target);S.progress=Math.max(S.progress,i+1);evaluation();document.getElementById(b.dataset.target).scrollIntoView({behavior:"smooth"});});["tx","km","att","splices","sl","cl"].forEach(id=>document.getElementById(id).addEventListener("input",calc));}
async function referenceAtlas(){const target=document.getElementById("referenceAtlasGrid");if(!target)return;try{const r=await fetch("/reference-capabilities.json",{cache:"default"});if(!r.ok)throw Error("reference map unavailable");const data=await r.json();if(!Array.isArray(data.capabilities))throw Error("reference map invalid");target.innerHTML=data.capabilities.map(c=>`<article class="reference-card"><span class="reference-domain">${esc(c.id)} · ${esc(c.domain)}</span><h3>${esc(c.title)}</h3><p class="reference-basis">${esc(c.basis)}</p><span class="reference-status">${esc(c.status)}</span><p class="reference-limit">${esc(c.limitation)}</p><footer><code>${esc(c.package)}</code><code>${esc(c.tests)}</code></footer></article>`).join("");}catch(e){target.innerHTML='<div class="panel warning">Reference map unavailable. No reference-derived capability claims were fabricated.</div>';}}
async function start(){try{const r=await fetch(DATA,{cache:"default"});if(!r.ok)throw Error("buyer-data unavailable");S.data=await r.json();metrics();filters();caps();verify();evaluation();sources();calc();bind();nexus();await referenceAtlas();}catch(e){document.body.dataset.buyerDataLoadError=String(e&&e.message||e);document.body.insertAdjacentHTML("afterbegin","<div class=truth role=alert><strong>DATA BOUNDARY</strong><span>Local buyer data unavailable; no capability or commercial claims were fabricated.</span></div>");}}
start();})();
