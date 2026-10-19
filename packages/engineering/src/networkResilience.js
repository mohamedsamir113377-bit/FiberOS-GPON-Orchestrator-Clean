'use strict';
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function positive(x,n){const v=finite(x,n);if(v<=0)throw new RangeError(`${n} must be > 0`);return v;}
class Dinic{
 constructor(n){this.g=Array.from({length:n},()=>[]);}
 add(u,v,c,meta){const a={to:v,rev:this.g[v].length,cap:c,initial:c,meta};const b={to:u,rev:this.g[u].length,cap:0,initial:0,meta:null};this.g[u].push(a);this.g[v].push(b);}
 maxFlow(s,t){let flow=0;const n=this.g.length;while(true){const level=Array(n).fill(-1),q=[s];level[s]=0;for(let h=0;h<q.length;h++){const u=q[h];for(const e of this.g[u])if(e.cap>1e-12&&level[e.to]<0){level[e.to]=level[u]+1;q.push(e.to);}}if(level[t]<0)break;const it=Array(n).fill(0);const dfs=(u,f)=>{if(u===t)return f;for(;it[u]<this.g[u].length;it[u]++){const e=this.g[u][it[u]];if(e.cap>1e-12&&level[e.to]===level[u]+1){const z=dfs(e.to,Math.min(f,e.cap));if(z>1e-12){e.cap-=z;this.g[e.to][e.rev].cap+=z;return z;}}}return 0;};let z;while((z=dfs(s,Infinity))>1e-12)flow+=z;}return flow;}
}
function maxFlow({edges,source,target}){
 if(!source||!target)throw new TypeError('source/target required'); const nodes=[...new Set([source,target,...(edges||[]).flatMap(e=>[e.from,e.to])])]; const idx=new Map(nodes.map((n,i)=>[n,i])); const d=new Dinic(nodes.length);
 for(const e of edges||[]){const cap=positive(e.capacity==null?1:e.capacity,'edge.capacity');d.add(idx.get(e.from),idx.get(e.to),cap,e);}
 const flow=d.maxFlow(idx.get(source),idx.get(target)); return Object.freeze({source,target,maxFlow:flow,edgeCapacityInterpretation:'flow units in authoritative topology'});
}
function edgeDisjointPathCount(p){return Math.floor(maxFlow({...p,edges:(p.edges||[]).map(e=>({...e,capacity:1}))}).maxFlow+1e-12);}
module.exports={maxFlow,edgeDisjointPathCount};
