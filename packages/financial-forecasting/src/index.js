'use strict';

/**
 * Financial Forecasting, Analysis & Modelling engine.
 * Concept source (public): "Financial Forecasting, Analysis and Modelling"
 * (M. Samonas, Wiley Finance) — forecasting, modelling and valuation structure.
 * Deterministic and dependency-free. No price, rate or margin is invented:
 * every input is caller-supplied and reported as LEDGER_DERIVED.
 */

function finite(x, name) {
  const n = Number(x);
  if (!Number.isFinite(n)) { const e = new Error('FIN_' + name.toUpperCase() + '_INVALID'); e.code = e.message; throw e; }
  return n;
}
function nonNeg(x, name) {
  const n = finite(x, name);
  if (n < 0) { const e = new Error('FIN_' + name.toUpperCase() + '_NEGATIVE'); e.code = e.message; throw e; }
  return n;
}
const r6 = (n) => Number(n.toFixed(6));

function ebitda({ revenue, costOfRevenue, opex }) {
  const r = nonNeg(revenue, 'revenue');
  const c = nonNeg(costOfRevenue, 'costOfRevenue');
  const o = nonNeg(opex, 'opex');
  const grossProfit = r - c;
  const e = grossProfit - o;
  return Object.freeze({
    revenue: r, grossProfit: r6(grossProfit),
    grossMargin: r === 0 ? null : r6(grossProfit / r),
    ebitda: r6(e), ebitdaMargin: r === 0 ? null : r6(e / r),
    authority: 'LEDGER_DERIVED'
  });
}

function forecastRevenue({ history, periods = 1, method = 'CAGR' }) {
  if (!Array.isArray(history) || history.length < 2) throw new Error('FIN_HISTORY_REQUIRED');
  const h = history.map((v, i) => nonNeg(v, 'history' + i));
  const n = Math.trunc(periods);
  if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error('FIN_PERIODS_INVALID');
  let rate;
  if (method === 'CAGR') rate = Math.pow(h[h.length - 1] / h[0], 1 / (h.length - 1)) - 1;
  else if (method === 'LAST_GROWTH') rate = h[h.length - 1] / h[h.length - 2] - 1;
  else throw new Error('FIN_METHOD_INVALID');
  const out = []; let v = h[h.length - 1];
  for (let i = 0; i < n; i++) { v = v * (1 + rate); out.push(r6(v)); }
  return Object.freeze({ method, growthRate: Number(rate.toFixed(8)), projected: Object.freeze(out) });
}

function breakEven({ fixedCosts, pricePerUnit, variableCostPerUnit }) {
  const f = nonNeg(fixedCosts, 'fixedCosts');
  const p = nonNeg(pricePerUnit, 'pricePerUnit');
  const v = nonNeg(variableCostPerUnit, 'variableCostPerUnit');
  const cm = p - v;
  if (cm <= 0) return Object.freeze({ feasible: false, reason: 'NON_POSITIVE_CONTRIBUTION_MARGIN', contributionMarginPerUnit: r6(cm) });
  const units = f / cm;
  return Object.freeze({ feasible: true, contributionMarginPerUnit: r6(cm), breakEvenUnits: r6(units), breakEvenRevenue: r6(units * p) });
}

function unitEconomics({ arpu, monthlyChurnRate, grossMarginPct, cac }) {
  const a = nonNeg(arpu, 'arpu');
  const ch = nonNeg(monthlyChurnRate, 'monthlyChurnRate');
  const gm = nonNeg(grossMarginPct, 'grossMarginPct');
  const c = nonNeg(cac, 'cac');
  if (ch === 0) return Object.freeze({ ltv: null, paybackMonths: null, note: 'ZERO_CHURN_UNBOUNDED' });
  const lifetimeMonths = 1 / ch;
  const ltv = a * gm * lifetimeMonths;
  const paybackMonths = c === 0 ? 0 : c / (a * gm);
  return Object.freeze({ ltv: r6(ltv), lifetimeMonths: r6(lifetimeMonths), paybackMonths: r6(paybackMonths), ltvCacRatio: c === 0 ? null : r6(ltv / c) });
}

function dcf({ cashFlows, discountRate, terminalGrowth = 0 }) {
  if (!Array.isArray(cashFlows) || !cashFlows.length) throw new Error('FIN_CASHFLOWS_REQUIRED');
  const r = finite(discountRate, 'discountRate');
  const g = finite(terminalGrowth, 'terminalGrowth');
  if (r <= -1) throw new Error('FIN_DISCOUNT_RATE_INVALID');
  if (g >= r) throw new Error('FIN_TERMINAL_GROWTH_INVALID');
  let pv = 0;
  const cf = cashFlows.map((v, i) => { const x = finite(v, 'cf' + i); pv += x / Math.pow(1 + r, i + 1); return x; });
  const last = cf[cf.length - 1];
  const terminal = last * (1 + g) / (r - g);
  const terminalPv = terminal / Math.pow(1 + r, cf.length);
  return Object.freeze({ presentValue: r6(pv), terminalValue: r6(terminal), terminalPv: r6(terminalPv), enterpriseValue: r6(pv + terminalPv) });
}

function covenantCheck({ ebitda: e, totalDebt, interestExpense, thresholds = {} }) {
  const ev = finite(e, 'ebitda');
  const d = nonNeg(totalDebt, 'totalDebt');
  const i = nonNeg(interestExpense, 'interestExpense');
  const leverage = ev === 0 ? null : d / ev;
  const coverage = i === 0 ? null : ev / i;
  const maxLeverage = thresholds.maxLeverage == null ? null : finite(thresholds.maxLeverage, 'maxLeverage');
  const minCoverage = thresholds.minCoverage == null ? null : finite(thresholds.minCoverage, 'minCoverage');
  const breaches = [];
  if (maxLeverage != null && leverage != null && leverage > maxLeverage) breaches.push('LEVERAGE_EXCEEDED');
  if (minCoverage != null && coverage != null && coverage < minCoverage) breaches.push('COVERAGE_BELOW_MIN');
  return Object.freeze({
    leverage: leverage == null ? null : r6(leverage),
    coverage: coverage == null ? null : r6(coverage),
    breaches: Object.freeze(breaches),
    compliant: breaches.length === 0
  });
}

module.exports = { ebitda, forecastRevenue, breakEven, unitEconomics, dcf, covenantCheck };
