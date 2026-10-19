import crypto from "node:crypto";

function finiteNumber(value, name) {
  const out = Number(value);
  if (!Number.isFinite(out)) throw new TypeError(`${name} must be finite`);
  return out;
}

function nonNegative(value, name) {
  const out = finiteNumber(value, name);
  if (out < 0) throw new RangeError(`${name} must be >= 0`);
  return out;
}

function nonNegativeInteger(value, name) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  return out;
}

function positive(value, name) {
  const out = finiteNumber(value, name);
  if (out <= 0) throw new RangeError(`${name} must be > 0`);
  return out;
}

function positiveInteger(value, name) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return out;
}

export function makeWorkload(seed, count) {
  if (!Number.isInteger(seed) || seed < 0) throw new Error("SEED_REQUIRED");
  if (!Number.isInteger(count) || count < 1) throw new Error("INVALID_COUNT");
  let s = seed >>> 0;
  const out = [];
  const rnd = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const ptx = -10 + rnd() * 20;
    const loss = rnd() * 20;
    out.push({ id: `w-${i}`, ptx, loss, prx: ptx - loss });
  }
  return out;
}

export function runWorkload(workload, fn) {
  const start = process.hrtime.bigint();
  for (const x of workload) fn(x);
  return Number(process.hrtime.bigint() - start) / 1e6;
}

export function percentiles(values, ps = [50, 95, 99]) {
  if (!values.length) throw new Error("EMPTY_SAMPLE");
  const xs = [...values].sort((a, b) => a - b);
  return Object.fromEntries(ps.map((p) => {
    if (!(p >= 0 && p <= 100)) throw new Error("INVALID_PERCENTILE");
    const pos = (xs.length - 1) * (p / 100);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const v = lo === hi ? xs[lo] : xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
    return [`p${p}`, v];
  }));
}

export function summarizeDurations(values) {
  const p = percentiles(values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    count: values.length,
    meanMs: mean,
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
    ...p
  };
}

export function fingerprintEnvironment() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    kernel: process.release?.name || null,
    pid: process.pid
  };
}

export function benchmarkReport({ name, seed, warmup, runs, workloadSize, durations, env, implementation }) {
  return {
    schema: "fiberos.performance.v1",
    name,
    seed,
    warmup,
    runs,
    workloadSize,
    implementation,
    environment: env,
    timing: "wall-clock process.hrtime.bigint, milliseconds",
    samples: summarizeDurations(durations),
    throughputWorkPerSec: workloadSize / (durations.reduce((a, b) => a + b, 0) / durations.length / 1000)
  };
}

export function sha256Json(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

/**
 * Calculate a deterministic capacity and investment scenario from explicit
 * demand/capacity inputs. No vendor growth factors, prices, or hidden buffers
 * are embedded in this engine.
 *
 * Forecast demand:
 *   currentDemand * (1 + annualGrowthRate)^(horizonMonths / 12)
 *   + monthlyDemandIncrement * horizonMonths
 *
 * Required total capacity keeps forecast demand plus the explicit buffer
 * at or below the explicit target utilization.
 */
export function calculateCapacityInvestmentScenario({
  scenarioName,
  horizonMonths,
  resources
} = {}) {
  const name = String(scenarioName ?? "").trim();
  if (!name) throw new TypeError("SCENARIO_NAME_REQUIRED");

  const horizon = nonNegativeInteger(horizonMonths, "horizonMonths");
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new RangeError("CAPACITY_RESOURCES_REQUIRED");
  }

  const normalized = resources.map((resource, index) => {
    if (!resource || typeof resource !== "object") {
      throw new TypeError(`resources[${index}] must be an object`);
    }

    const id = String(resource.id ?? "").trim();
    if (!id) throw new TypeError(`resources[${index}].id is required`);

    const currentCapacity = nonNegative(resource.currentCapacity, `resources[${index}].currentCapacity`);
    const currentDemand = nonNegative(resource.currentDemand, `resources[${index}].currentDemand`);
    const annualGrowthRate = finiteNumber(resource.annualGrowthRate, `resources[${index}].annualGrowthRate`);
    if (annualGrowthRate < -1) {
      throw new RangeError(`resources[${index}].annualGrowthRate must be >= -1`);
    }

    const monthlyDemandIncrement = nonNegative(
      resource.monthlyDemandIncrement ?? 0,
      `resources[${index}].monthlyDemandIncrement`
    );
    const plannedCapacity = nonNegative(
      resource.plannedCapacity ?? 0,
      `resources[${index}].plannedCapacity`
    );
    const explicitBuffer = nonNegative(
      resource.bufferCapacity ?? 0,
      `resources[${index}].bufferCapacity`
    );
    const targetUtilization = finiteNumber(
      resource.targetUtilization,
      `resources[${index}].targetUtilization`
    );
    if (!(targetUtilization > 0 && targetUtilization <= 1)) {
      throw new RangeError(`resources[${index}].targetUtilization must be > 0 and <= 1`);
    }

    const unitCostMinorRaw = finiteNumber(
      resource.unitCostMinor,
      `resources[${index}].unitCostMinor`
    );
    if (!Number.isSafeInteger(unitCostMinorRaw) || unitCostMinorRaw < 0) {
      throw new RangeError(`resources[${index}].unitCostMinor must be a non-negative safe integer`);
    }

    const forecastDemand = (
      currentDemand * Math.pow(1 + annualGrowthRate, horizon / 12)
      + monthlyDemandIncrement * horizon
    );
    if (!Number.isFinite(forecastDemand) || forecastDemand < 0) {
      throw new RangeError(`resources[${index}] produces an invalid demand forecast`);
    }

    const protectedDemand = forecastDemand + explicitBuffer;
    const requiredTotalCapacity = Math.ceil(protectedDemand / targetUtilization);
    const capacityBeforeInvestment = currentCapacity + plannedCapacity;
    const additionalCapacity = Math.max(0, requiredTotalCapacity - capacityBeforeInvestment);
    const totalCapacityAfterInvestment = capacityBeforeInvestment + additionalCapacity;
    const investmentCostMinor = additionalCapacity * unitCostMinorRaw;
    if (!Number.isFinite(investmentCostMinor) || !Number.isSafeInteger(investmentCostMinor)) {
      throw new RangeError(`resources[${index}].investmentCostMinor exceeds exact monetary precision`);
    }
    const utilizationAfterInvestment = totalCapacityAfterInvestment === 0
      ? 0
      : forecastDemand / totalCapacityAfterInvestment;

    return {
      id,
      unit: String(resource.unit ?? "").trim() || null,
      currentCapacity,
      currentDemand,
      annualGrowthRate,
      monthlyDemandIncrement,
      horizonMonths: horizon,
      plannedCapacity,
      explicitBufferCapacity: explicitBuffer,
      targetUtilization,
      forecastDemand,
      requiredTotalCapacity,
      capacityBeforeInvestment,
      additionalCapacity,
      totalCapacityAfterInvestment,
      targetUtilizationHeadroom: (
        totalCapacityAfterInvestment * targetUtilization - protectedDemand
      ),
      rawHeadroomAfterInvestment: totalCapacityAfterInvestment - forecastDemand,
      utilizationAfterInvestment,
      unitCostMinor: unitCostMinorRaw,
      investmentCostMinor
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const totalInvestmentCostMinor = normalized.reduce(
    (sum, resource) => sum + resource.investmentCostMinor,
    0
  );
  const totalAdditionalCapacity = normalized.reduce(
    (sum, resource) => sum + resource.additionalCapacity,
    0
  );
  if (!Number.isSafeInteger(totalInvestmentCostMinor)) {
    throw new RangeError('totalInvestmentCostMinor exceeds exact monetary precision');
  }

  const canonical = {
    schema: "fiberos.capacity-investment.v1",
    scenarioName: name,
    horizonMonths: horizon,
    resources: normalized
  };

  return Object.freeze({
    ...canonical,
    scenarioId: sha256Json(canonical),
    calculated: true,
    autonomousInvestment: false,
    databaseWrites: 0,
    totals: {
      resourceCount: normalized.length,
      totalAdditionalCapacity,
      totalInvestmentCostMinor
    },
    authority: "DETERMINISTIC_CAPACITY_INVESTMENT_ENGINE",
    limitations: [
      "All growth, utilization targets, buffers, and unit costs are explicit inputs.",
      "The engine forecasts from supplied scenario assumptions; it does not claim live telemetry or financial certainty.",
      "No investment order, procurement action, or network mutation is performed."
    ]
  });
}
