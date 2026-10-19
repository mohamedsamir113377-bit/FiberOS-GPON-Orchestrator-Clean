'use strict';
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function blastRadius({edges,roots,includeRoots=true}){
 const q=[...(roots||[])],seen=new Set(q),affectedEdges=new Set(),services=new Set(),customers=new Set();
 let serviceCountFallback=0, customerCountFallback=0;
 const g=new Map();for(const e of edges||[]){if(!e.from||!e.to)throw new TypeError('edge requires from/to');if(!g.has(e.from))g.set(e.from,[]);g.get(e.from).push(e);}
 while(q.length){const n=q.shift();for(const e of g.get(n)||[]){affectedEdges.add(e.id??`${e.from}->${e.to}`);
   if(Array.isArray(e.serviceIds)&&e.serviceIds.length){for(const s of e.serviceIds)services.add(s);} else serviceCountFallback += Math.max(0,Number(e.serviceCount||0));
   if(Array.isArray(e.customerIds)&&e.customerIds.length){for(const c of e.customerIds)customers.add(c);} else customerCountFallback += Math.max(0,Number(e.customerCount||0));
   if(!seen.has(e.to)){seen.add(e.to);q.push(e.to);}
 }}
 const serviceExposure=services.size+serviceCountFallback, customerExposure=customers.size+customerCountFallback;
 return Object.freeze({affectedNodes:[...seen],affectedNodeCount:seen.size,affectedEdges:affectedEdges.size,affectedServices:[...services],affectedCustomers:[...customers],serviceExposure,customerExposure,roots:[...(roots||[])],includeRoots});
}
function shortestPath(edges,start,target,weightKey='weight'){
 const nodes=new Set([start,target]);for(const e of edges||[]){nodes.add(e.from);nodes.add(e.to);}
 const d=new Map([...nodes].map(n=>[n,Infinity])),prev=new Map();d.set(start,0);const sig=new Map([[start,String(start)]]),used=new Set();
 while(used.size<nodes.size){let u=null,best=Infinity,bestSig='~';for(const n of nodes)if(!used.has(n)){const dn=d.get(n),sg=sig.get(n)||'~';if(dn<best||(dn===best&&sg<bestSig)){best=dn;bestSig=sg;u=n;}}if(u===null||!Number.isFinite(best))break;used.add(u);if(u===target)break;
  for(const e of (edges||[]).filter(x=>x.from===u&&!x.disabled)){const w=finite(e[weightKey]??1,weightKey);if(w<0)throw new RangeError('Dijkstra requires non-negative weights');const nd=best+w, ns=(sig.get(u)||'')+'>'+String(e.to);if(nd<d.get(e.to)||(nd===d.get(e.to)&&(sig.get(e.to)||'~')>ns)){d.set(e.to,nd);prev.set(e.to,{node:u,edge:e});sig.set(e.to,ns);}}
 }
 if(!Number.isFinite(d.get(target)))return {reachable:false,distance:Infinity,path:[]};const path=[];let cur=target;while(cur!==start){const p=prev.get(cur);if(!p)return {reachable:false,distance:Infinity,path:[]};path.unshift(p.edge);cur=p.node;}return {reachable:true,distance:d.get(target),path};
}
module.exports={blastRadius,shortestPath};
