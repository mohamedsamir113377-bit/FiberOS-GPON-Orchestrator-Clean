'use strict';

function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function positive(x,n){const v=finite(x,n);if(v<=0)throw new RangeError(`${n} must be > 0`);return v;}

// Weibull reliability: R(t)=exp(-(t/eta)^beta), F=1-R, h(t)=beta/eta*(t/eta)^(beta-1).
// Parameters must be fitted/approved from real failure data; the engine never chooses them.
function weibull({age, shapeBeta, scaleEta}){
  const t=Math.max(0,finite(age,'age')); const beta=positive(shapeBeta,'shapeBeta'); const eta=positive(scaleEta,'scaleEta');
  const z=Math.pow(t/eta,beta); const reliability=Math.exp(-z); const failureProbability=1-reliability;
  const hazard=t===0 && beta<1 ? Infinity : (beta/eta)*Math.pow(Math.max(t,Number.MIN_VALUE)/eta,beta-1);
  return Object.freeze({age:t,shapeBeta:beta,scaleEta:eta,reliability,failureProbability,hazardRate:hazard});
}

// Proportional hazards multiplier: h(t|x)=h0(t)*exp(beta^T x). Coefficients must be fitted.
function proportionalHazard({baselineHazard, coefficients, features}){
  const h0=positive(baselineHazard,'baselineHazard');
  if(!Array.isArray(coefficients)||!Array.isArray(features)||coefficients.length!==features.length) throw new TypeError('coefficients/features length mismatch');
  let eta=0; for(let i=0;i<coefficients.length;i++) eta+=finite(coefficients[i],`coefficients[${i}]`)*finite(features[i],`features[${i}]`);
  const multiplier=Math.exp(eta); return Object.freeze({baselineHazard:h0,linearPredictor:eta,riskMultiplier:multiplier,conditionalHazard:h0*multiplier});
}

// Arrhenius acceleration is valid only where the supplied degradation mechanism is known to be thermally activated.
function arrheniusAcceleration({activationEnergyJPerMol, temperatureK, referenceTemperatureK}){
  const Ea=positive(activationEnergyJPerMol,'activationEnergyJPerMol'); const T=positive(temperatureK,'temperatureK'); const Tr=positive(referenceTemperatureK,'referenceTemperatureK');
  const R=8.31446261815324; return Math.exp((Ea/R)*(1/Tr-1/T));
}
module.exports={weibull,proportionalHazard,arrheniusAcceleration};
