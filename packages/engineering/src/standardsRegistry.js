'use strict';
/** Standards metadata only; values that vary by fibre/system/vendor remain external parameters. */
const REGISTRY=Object.freeze({
  'ITU-T G.652':{status:'in_force',latest_revision:'08/2024',scope:'single-mode optical fibre and cable'},
  'ITU-T G.657':{status:'in_force',latest_revision:'08/2024',scope:'bending-loss insensitive single-mode optical fibre and cable'},
  'IEC 61746':{status:'reference',scope:'OTDR calibration / measurement framework',note:'verify exact edition and laboratory applicability before claiming conformity'}
});
function get(id){return REGISTRY[id]||null;}
function list(){return Object.entries(REGISTRY).map(([id,v])=>({id,...v}));}
module.exports=Object.freeze({get,list,REGISTRY});
