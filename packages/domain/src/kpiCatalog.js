'use strict';

/**
 * INTERNATIONAL-STANDARD FIELD-SERVICE / NOC KPI CATALOG
 * =========================================================
 * Every KPI below is computed from persisted repository data. Where a KPI
 * depends on evidence that cannot be reconstructed historically, the
 * computation returns an explicit null/observability boundary instead of an
 * inferred value.
 */

const KPI_CATALOG = Object.freeze({
  TICKET_VOLUME: {
    id: 'TICKET_VOLUME',
    nameAr: 'Ticket Volume',
    nameEn: 'Ticket Volume',
    computedFrom: 'tickets.created_at',
    unit: 'count',
  },
  SLA_COMPLIANCE_RATE: {
    id: 'SLA_COMPLIANCE_RATE',
    nameAr: 'SLA Compliance Rate',
    nameEn: 'SLA Compliance Rate',
    computedFrom: 'completed tickets where closed_at <= sla_deadline, divided by completed tickets with persisted SLA deadline',
    unit: 'percent',
  },
  AVG_RESOLUTION_MINUTES: {
    id: 'AVG_RESOLUTION_MINUTES',
    nameAr: 'Average Resolution Time (minutes)',
    nameEn: 'Average Resolution Time',
    computedFrom: 'avg(closed_at - created_at) over completed tickets',
    unit: 'minutes',
  },
  OPEN_BACKLOG: {
    id: 'OPEN_BACKLOG',
    nameAr: 'Open Backlog',
    nameEn: 'Open Backlog',
    computedFrom: "count(tickets) where status IN ('pending','in_progress','awaiting_evidence','manager_review')",
    unit: 'count',
  },
  FAILURE_RATE: {
    id: 'FAILURE_RATE',
    nameAr: 'Failure Rate',
    nameEn: 'Failure Rate',
    computedFrom: 'faulty tickets divided by completed + faulty tickets',
    unit: 'percent',
  },
  FIRST_TIME_FIX_RATE: {
    id: 'FIRST_TIME_FIX_RATE',
    nameAr: 'First-Time-Fix Rate',
    nameEn: 'First-Time-Fix Rate',
    computedFrom: 'completed tickets with reopen_tracking_observed=true and reopened_at IS NULL, divided by observed completed tickets',
    unit: 'percent',
  },
  TECHNICIAN_TRAVEL_MINUTES: {
    id: 'TECHNICIAN_TRAVEL_MINUTES',
    nameAr: 'Technician Observed Movement Time',
    nameEn: 'Technician Travel Minutes',
    computedFrom: 'sum of consecutive technician_position intervals where persisted speed_mps > 0',
    unit: 'minutes',
  },
  REVENUE_PER_TICKET: {
    id: 'REVENUE_PER_TICKET',
    nameAr: 'Revenue per Billed Ticket',
    nameEn: 'Revenue per Billed Ticket',
    computedFrom: 'non-void invoice amount_minor divided by distinct billed ticket_id, by currency',
    unit: 'minor_currency_units_per_ticket',
  },
  CABLE_REEL_REMAINDER_METERS: {
    id: 'CABLE_REEL_REMAINDER_METERS',
    nameAr: 'Cable Reel Remainder',
    nameEn: 'Cable Reel Remainder',
    computedFrom: 'sum(material_reel_ledger.delta_millimeters) grouped by reel_id',
    unit: 'meters',
  },
  SPLITTER_LEG_UTILISATION: {
    id: 'SPLITTER_LEG_UTILISATION',
    nameAr: 'Splitter Leg Utilisation',
    nameEn: 'Splitter Leg Utilisation',
    computedFrom: "network_ports where port_type='splitter_leg': used / total",
    unit: 'percent',
  },
  PON_OPTICAL_MARGIN_DB: {
    id: 'PON_OPTICAL_MARGIN_DB',
    nameAr: 'PON Optical Margin',
    nameEn: 'PON Optical Margin',
    computedFrom: 'avg(current_rx_dbm - expected_rx_dbm) for path-bound assessments with measured field/NMS evidence',
    unit: 'dB',
  },
});

module.exports = { KPI_CATALOG };
