'use strict';
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function nonNeg(x,n){const v=finite(x,n);if(v<0)throw new RangeError(`${n} must be >= 0`);return v;}
function solvePath({segments,txDbm,receiverSensitivityDbm,requiredMarginDb=0}){
 if(!Array.isArray(segments)||!segments.length)throw new TypeError('segments required');
 const tx=finite(txDbm,'txDbm'),sens=finite(receiverSensitivityDbm,'receiverSensitivityDbm'),req=nonNeg(requiredMarginDb,'requiredMarginDb');let loss=0,variance=0;const detail=[];
 for(let i=0;i<segments.length;i++){const s=segments[i]||{};const length=nonNeg(s.lengthKm||0,`segments[${i}].lengthKm`);const alpha=s.attenuationDbPerKm==null?null:nonNeg(s.attenuationDbPerKm,`segments[${i}].attenuationDbPerKm`);if(length>0&&alpha==null)throw new TypeError(`segments[${i}].attenuationDbPerKm required for nonzero fiber length`);const fiber=length*(alpha||0),fixed=nonNeg(s.lossDb||0,`segments[${i}].lossDb`);const std=s.stdDb==null?0:nonNeg(s.stdDb,`segments[${i}].stdDb`);loss+=fiber+fixed;variance+=std*std;detail.push({id:s.id==null?`s${i}`:String(s.id),fiberLossDb:fiber,fixedLossDb:fixed,totalLossDb:fiber+fixed,stdDb:std,sourceRef:s.sourceRef||null});}
 const rx=tx-loss,margin=rx-sens, sigma=Math.sqrt(variance),lower=req?margin-1.95996398454005*sigma:margin;return Object.freeze({txDbm:tx,receiverSensitivityDbm:sens,totalLossDb:loss,rxDbm:rx,marginDb:margin,uncertaintyStdDb:sigma,lower95MarginDb:lower,requiredMarginDb:req,meetsRequiredMargin:margin>=req,components:detail,formula:'P_rx=P_tx-sum(L_i); M=P_rx-P_sens; sigma_M=sqrt(sum(sigma_i²))'});
}
module.exports={solvePath};
