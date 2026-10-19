'use strict';
const STAGES = Object.freeze(['survey','design','permit','material','civil','duct','cable','splicing','testing','qc','acceptance','drop','activation']);
const REQUIRED_EVIDENCE = Object.freeze({
  survey:['gps','survey_report'], design:['design_reference'], permit:['permit_reference'], material:['material_issue'],
  civil:['before_photo','after_photo','gps','depth_measurement'], duct:['duct_geometry','duct_test'], cable:['cable_id','route_geometry'],
  splicing:['splice_record'], testing:['otdr','power_meter'], qc:['qc_record'], acceptance:['acceptance_record'],
  drop:['drop_record','gps'], activation:['ont_serial','optical_test','activation_reference']
});
function validateStage(stage,evidence){
  if(!STAGES.includes(stage)) throw new Error('UNKNOWN_FTTH_STAGE');
  const have=new Set((evidence||[]).map(x=>typeof x==='string'?x:x.type));
  const missing=REQUIRED_EVIDENCE[stage].filter(x=>!have.has(x));
  return {ok:missing.length===0,missing};
}
function activationReady({drop,ont,router,optical,nms}){ return Boolean(drop&&ont&&router&&optical&&nms); }
module.exports={STAGES,REQUIRED_EVIDENCE,validateStage,activationReady};
