'use strict';

/**
 * Predictive inventory: EOQ, safety stock, reorder point, ABC/XYZ.
 * Concept source (public): logistics & supply-chain management literature
 * (inventory policy, service level, demand classification). Deterministic.
 */

function pos(x, n) {
  const v = Number(x);
  if (!Number.isFinite(v) || v < 0) throw new Error('INV_' + n.toUpperCase() + '_INVALID');
  return v;
}
const r6 = (n) => Number(n.toFixed(6));

// Acklam inverse normal CDF (standard, public algorithm).
function normInv(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= ph) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function eoq({ annualDemand, orderCost, holdingCostPerUnit }) {
  const D = pos(annualDemand, 'demand');
  const S = pos(orderCost, 'orderCost');
  const H = pos(holdingCostPerUnit, 'holding');
  if (H === 0) throw new Error('INV_HOLDING_ZERO');
  const q = Math.sqrt((2 * D * S) / H);
  const orders = D / q;
  return Object.freeze({ eoqUnits: r6(q), ordersPerYear: r6(orders), cycleDays: r6(365 / orders), totalCost: r6(orders * S + (q / 2) * H) });
}

function safetyStock({ serviceLevel, demandStdDev, leadTimeDays, demandMeanPerDay }) {
  const sl = Number(serviceLevel);
  if (!Number.isFinite(sl) || sl <= 0 || sl >= 1) throw new Error('INV_SERVICE_LEVEL_INVALID');
  const sd = pos(demandStdDev, 'demandStdDev');
  const L = pos(leadTimeDays, 'leadTime');
  const mu = pos(demandMeanPerDay, 'demandMean');
  const z = normInv(sl);
  const sigmaL = Math.sqrt(L) * sd;
  const ss = z * sigmaL;
  return Object.freeze({ zScore: r6(z), leadTimeSigma: r6(sigmaL), safetyStockUnits: r6(ss), reorderPoint: r6(mu * L + ss) });
}

function classifyABC(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('INV_ITEMS_REQUIRED');
  const rows = items.map((it, i) => ({ id: String(it.id == null ? 'I' + i : it.id), annualValue: pos(it.annualValue, 'annualValue') }));
  const total = rows.reduce((s, x) => s + x.annualValue, 0);
  if (total === 0) throw new Error('INV_TOTAL_VALUE_ZERO');
  const sorted = rows.slice().sort((a, b) => b.annualValue - a.annualValue);
  let cum = 0;
  return Object.freeze(sorted.map((x) => {
    cum += x.annualValue;
    const share = cum / total;
    const cls = share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C';
    return Object.freeze({ id: x.id, annualValue: x.annualValue, cumulativeShare: r6(share), class: cls });
  }));
}

function classifyXYZ(series) {
  if (!Array.isArray(series) || series.length < 2) throw new Error('INV_SERIES_REQUIRED');
  const xs = series.map((v, i) => pos(v, 'series' + i));
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  if (mean === 0) return Object.freeze({ cv: null, class: 'Z', note: 'ZERO_MEAN' });
  const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length;
  const cv = Math.sqrt(variance) / mean;
  return Object.freeze({ cv: r6(cv), class: cv <= 0.25 ? 'X' : cv <= 0.5 ? 'Y' : 'Z' });
}

function forecastDemand({ series, periods = 1, alpha = 0.3 }) {
  if (!Array.isArray(series) || series.length < 2) throw new Error('INV_SERIES_REQUIRED');
  const n = Math.trunc(periods);
  if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error('INV_PERIODS_INVALID');
  const a = Number(alpha);
  if (!Number.isFinite(a) || a <= 0 || a > 1) throw new Error('INV_ALPHA_INVALID');
  let level = Number(series[0]);
  for (let i = 1; i < series.length; i++) level = a * Number(series[i]) + (1 - a) * level;
  return Object.freeze({ level: r6(level), forecast: Object.freeze(new Array(n).fill(r6(level))) });
}

module.exports = { normInv, eoq, safetyStock, classifyABC, classifyXYZ, forecastDemand };
