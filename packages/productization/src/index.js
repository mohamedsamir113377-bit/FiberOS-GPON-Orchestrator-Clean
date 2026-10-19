'use strict';

function requireFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(name + ' must be a finite number');
  }
  return value;
}

function validateCoordinates(lat, lon) {
  requireFiniteNumber(lat, 'latitude');
  requireFiniteNumber(lon, 'longitude');
  if (lat < -90 || lat > 90) throw new RangeError('latitude out of range');
  if (lon < -180 || lon > 180) throw new RangeError('longitude out of range');
  return true;
}

function validateMoneyMinorUnits(amountMinor, currency) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new TypeError('amountMinor must be a non-negative safe integer');
  }
  if (!/^[A-Z]{3}$/.test(String(currency || ''))) {
    throw new TypeError('currency must be an ISO-4217 style 3-letter code');
  }
  return true;
}

function normalizeEvidenceSource(source) {
  const allowed = new Set(['field', 'nms', 'system', 'ai_simulated']);
  if (!allowed.has(source)) throw new TypeError('unsupported evidence source');
  return source;
}


const PORTAL_BILLING_INTERVALS = Object.freeze(['weekly', 'monthly', 'yearly']);
const PORTAL_REPORT_TYPES = Object.freeze([
  'executive',
  'network',
  'quality',
  'field',
  'financial',
  'engineering'
]);
const PORTAL_SCHEDULE_MAX_RECIPIENTS = 10;
const PORTAL_REPORT_MAX_DAYS = 366;

function normalizePortalBillingInterval(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!PORTAL_BILLING_INTERVALS.includes(normalized)) {
    throw Object.assign(new Error('PORTAL_BILLING_INTERVAL_INVALID'), {
      statusCode: 400,
      code: 'PORTAL_BILLING_INTERVAL_INVALID'
    });
  }
  return normalized;
}

function normalizePortalReportType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!PORTAL_REPORT_TYPES.includes(normalized)) {
    throw Object.assign(new Error('PORTAL_REPORT_TYPE_INVALID'), {
      statusCode: 400,
      code: 'PORTAL_REPORT_TYPE_INVALID'
    });
  }
  return normalized;
}

function validatePortalEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('PORTAL_EMAIL_INVALID'), {
      statusCode: 400,
      code: 'PORTAL_EMAIL_INVALID'
    });
  }
  return email;
}

function normalizePortalRecipients(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > PORTAL_SCHEDULE_MAX_RECIPIENTS) {
    throw Object.assign(new Error('PORTAL_RECIPIENTS_INVALID'), {
      statusCode: 400,
      code: 'PORTAL_RECIPIENTS_INVALID'
    });
  }
  const recipients = [...new Set(values.map(validatePortalEmail))];
  if (recipients.length < 1 || recipients.length > PORTAL_SCHEDULE_MAX_RECIPIENTS) {
    throw Object.assign(new Error('PORTAL_RECIPIENTS_INVALID'), {
      statusCode: 400,
      code: 'PORTAL_RECIPIENTS_INVALID'
    });
  }
  return recipients;
}

function validatePortalReportWindow(start, end, now = new Date()) {
  const from = new Date(start);
  const to = new Date(end || now);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw Object.assign(new Error('PORTAL_REPORT_WINDOW_INVALID'), {
      statusCode: 400,
      code: 'PORTAL_REPORT_WINDOW_INVALID'
    });
  }
  const spanDays = (to.getTime() - from.getTime()) / 86400000;
  if (spanDays > PORTAL_REPORT_MAX_DAYS) {
    throw Object.assign(new Error('PORTAL_REPORT_WINDOW_TOO_LARGE'), {
      statusCode: 400,
      code: 'PORTAL_REPORT_WINDOW_TOO_LARGE'
    });
  }
  return Object.freeze({ from, to });
}

function timeZoneParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    const map = Object.create(null);
    for (const part of parts) if (part.type !== 'literal') map[part.type] = part.value;
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      weekday: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(map.weekday),
      hour: Number(map.hour),
      minute: Number(map.minute)
    };
  } catch (error) {
    throw Object.assign(new Error('PORTAL_TIMEZONE_INVALID'), {
      statusCode: 400,
      code: 'PORTAL_TIMEZONE_INVALID',
      cause: error
    });
  }
}

function localWallClockToUtc(fields, timeZone) {
  let guess = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute);
  for (let i = 0; i < 3; i += 1) {
    const current = timeZoneParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(
      current.year,
      current.month - 1,
      current.day,
      current.hour,
      current.minute
    );
    const offset = asUtc - guess;
    guess = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute) - offset;
  }
  return new Date(guess);
}

function addLocalDays(date, days) {
  const copy = new Date(Date.UTC(date.year, date.month - 1, date.day));
  copy.setUTCDate(copy.getUTCDate() + days);
  return {
    year: copy.getUTCFullYear(),
    month: copy.getUTCMonth() + 1,
    day: copy.getUTCDate()
  };
}

function daysInLocalMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextPortalRunAt(schedule, fromDate = new Date()) {
  const timeZone = String(schedule.timezone || 'UTC').trim();
  const from = fromDate instanceof Date ? fromDate : new Date(fromDate);
  if (Number.isNaN(from.getTime())) {
    throw Object.assign(new Error('PORTAL_SCHEDULE_FROM_INVALID'), {
      statusCode: 400,
      code: 'PORTAL_SCHEDULE_FROM_INVALID'
    });
  }
  const cadence = normalizePortalBillingInterval(schedule.cadence);
  const hour = Number(schedule.hour);
  const minute = Number(schedule.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw Object.assign(new Error('PORTAL_SCHEDULE_TIME_INVALID'), {
      statusCode: 400,
      code: 'PORTAL_SCHEDULE_TIME_INVALID'
    });
  }

  const localNow = timeZoneParts(from, timeZone);
  const wallClock = (dateOnly) => localWallClockToUtc({
    ...dateOnly,
    hour,
    minute
  }, timeZone);

  if (cadence === 'weekly') {
    const weekday = Number(schedule.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw Object.assign(new Error('PORTAL_WEEKDAY_INVALID'), { statusCode: 400, code: 'PORTAL_WEEKDAY_INVALID' });
    }
    for (let offset = 0; offset <= 7; offset += 1) {
      const candidateDate = addLocalDays(localNow, offset);
      const candidateWeekday = new Date(Date.UTC(
        candidateDate.year, candidateDate.month - 1, candidateDate.day
      )).getUTCDay();
      if (candidateWeekday !== weekday) continue;
      const candidate = wallClock(candidateDate);
      if (candidate.getTime() > from.getTime()) return candidate;
    }
  }

  if (cadence === 'monthly') {
    const day = Number(schedule.dayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw Object.assign(new Error('PORTAL_DAY_OF_MONTH_INVALID'), { statusCode: 400, code: 'PORTAL_DAY_OF_MONTH_INVALID' });
    }
    for (let monthOffset = 0; monthOffset <= 13; monthOffset += 1) {
      const monthDate = new Date(Date.UTC(localNow.year, localNow.month - 1 + monthOffset, 1));
      const year = monthDate.getUTCFullYear();
      const month = monthDate.getUTCMonth() + 1;
      if (day > daysInLocalMonth(year, month)) continue;
      const candidate = wallClock({ year, month, day });
      if (candidate.getTime() > from.getTime()) return candidate;
    }
  }

  if (cadence === 'yearly') {
    const month = Number(schedule.monthOfYear);
    const day = Number(schedule.dayOfMonth);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw Object.assign(new Error('PORTAL_MONTH_OF_YEAR_INVALID'), { statusCode: 400, code: 'PORTAL_MONTH_OF_YEAR_INVALID' });
    }
    if (!Number.isInteger(day) || day < 1 || day > daysInLocalMonth(localNow.year, month)) {
      throw Object.assign(new Error('PORTAL_DAY_OF_MONTH_INVALID'), { statusCode: 400, code: 'PORTAL_DAY_OF_MONTH_INVALID' });
    }
    for (let yearOffset = 0; yearOffset <= 2; yearOffset += 1) {
      const year = localNow.year + yearOffset;
      if (day > daysInLocalMonth(year, month)) continue;
      const candidate = wallClock({ year, month, day });
      if (candidate.getTime() > from.getTime()) return candidate;
    }
  }

  throw Object.assign(new Error('PORTAL_NEXT_RUN_UNRESOLVABLE'), {
    statusCode: 422,
    code: 'PORTAL_NEXT_RUN_UNRESOLVABLE'
  });
}

function portalReportDisplayName(type) {
  const value = normalizePortalReportType(type);
  return {
    executive: 'Executive Operating Brief',
    network: 'Network Reality & Capacity Report',
    quality: 'Quality & First-Time-Right Report',
    field: 'Field Productivity & Delivery Report',
    financial: 'Financial & Subscription Report',
    engineering: 'Optical Engineering & Assurance Report'
  }[value];
}

function stablePortalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stablePortalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stablePortalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function portalSha256(value) {
  return require('node:crypto').createHash('sha256').update(stablePortalJson(value)).digest('hex');
}

function csvValue(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function renderPortalReportCsv(report) {
  const rows = [['section', 'metric', 'value', 'evidenceClass']];
  for (const [section, values] of Object.entries(report || {})) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    for (const [metric, value] of Object.entries(values)) {
      let evidenceClass = 'persisted';
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'evidenceClass')) {
        evidenceClass = value.evidenceClass;
      }
      rows.push([section, metric, value && typeof value === 'object' ? JSON.stringify(value) : value, evidenceClass]);
    }
  }
  return rows.map((row) => row.map(csvValue).join(',')).join('\n') + '\n';
}

function renderPortalReportEmail({ tenantName, reportType, generatedAt, periodStart, periodEnd, report }) {
  const displayName = portalReportDisplayName(reportType);
  const lines = [
    displayName + ' — ' + String(tenantName || 'FiberOS tenant'),
    'Generated at: ' + generatedAt,
    'Reporting window: ' + periodStart + ' → ' + periodEnd,
    '',
    'This message contains database-derived facts only. Unknown or unavailable values remain unreported.',
    'Report hash: ' + portalSha256({ reportType, generatedAt, periodStart, periodEnd, report })
  ];
  for (const [section, values] of Object.entries(report || {})) {
    lines.push('', '[' + section + ']');
    for (const [key, value] of Object.entries(values || {})) {
      lines.push(key + ': ' + (value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')));
    }
  }
  return lines.join('\n');
}


const entitlementEngine = require('./entitlementEngine');
const contractorWorkPackageEngine = require('./contractorWorkPackageEngine');

module.exports = Object.freeze({
  validateCoordinates,
  validateMoneyMinorUnits,
  normalizeEvidenceSource,
  PORTAL_BILLING_INTERVALS,
  PORTAL_REPORT_TYPES,
  normalizePortalBillingInterval,
  normalizePortalReportType,
  validatePortalEmail,
  normalizePortalRecipients,
  validatePortalReportWindow,
  nextPortalRunAt,
  portalReportDisplayName,
  stablePortalJson,
  portalSha256,
  renderPortalReportCsv,
  renderPortalReportEmail,
  // Entitlement / usage / order / SLA foundations
  KNOWN_METRICS: entitlementEngine.KNOWN_METRICS,
  ORDER_TYPES: entitlementEngine.ORDER_TYPES,
  ORDER_STATUSES: entitlementEngine.ORDER_STATUSES,
  ORDER_TRANSITIONS: entitlementEngine.ORDER_TRANSITIONS,
  normalizeMetricCode: entitlementEngine.normalizeMetricCode,
  normalizeOrderType: entitlementEngine.normalizeOrderType,
  normalizeOrderStatus: entitlementEngine.normalizeOrderStatus,
  periodKeyFor: entitlementEngine.periodKeyFor,
  sumUsageDeltas: entitlementEngine.sumUsageDeltas,
  evaluateMetricEntitlement: entitlementEngine.evaluateMetricEntitlement,
  evaluatePlanEntitlements: entitlementEngine.evaluatePlanEntitlements,
  authorizeUsage: entitlementEngine.authorizeUsage,
  canTransitionOrder: entitlementEngine.canTransitionOrder,
  assertOrderTransition: entitlementEngine.assertOrderTransition,
  evaluateSlaClocks: entitlementEngine.evaluateSlaClocks,
  entitlementEngine,
  WP_STATUSES: contractorWorkPackageEngine.WP_STATUSES,
  WP_TRANSITIONS: contractorWorkPackageEngine.WP_TRANSITIONS,
  normalizeWpStatus: contractorWorkPackageEngine.normalizeWpStatus,
  canTransitionWorkPackage: contractorWorkPackageEngine.canTransitionWorkPackage,
  assertWorkPackageTransition: contractorWorkPackageEngine.assertWorkPackageTransition,
  eventTypeForTransition: contractorWorkPackageEngine.eventTypeForTransition,
  assertMeasurementSegregation: contractorWorkPackageEngine.assertMeasurementSegregation,
  assertReconciliationRules: contractorWorkPackageEngine.assertReconciliationRules,
  computeMeasurementAmountMinor: contractorWorkPackageEngine.computeMeasurementAmountMinor,
  detectSlaThresholds: contractorWorkPackageEngine.detectSlaThresholds,
  detectAllSlaThresholds: contractorWorkPackageEngine.detectAllSlaThresholds,
  contractorWorkPackageEngine
});
