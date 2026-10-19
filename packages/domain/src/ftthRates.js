/**
 * FTTH optical budget helpers — engineering constants, not live measurements.
 * source of measurement must still be declared at persistence time.
 */
'use strict';

const FIBER_ATTENUATION_DB_PER_KM = Object.freeze({
  1310: 0.35,
  1490: 0.25,
  1550: 0.20
});

const SPLITTER_LOSS_DB = Object.freeze({
  '1:2': 3.5,
  '1:4': 7.0,
  '1:8': 10.5,
  '1:16': 14.0,
  '1:32': 17.5,
  '1:64': 21.0,
  '1:128': 24.5
});

const SPLICE_LOSS_DB = 0.05;
const CONNECTOR_LOSS_DB = 0.30;

function powerBudget(params) {
  params = params || {};
  const km = Number(params.lengthKm || 0);
  const wl = Number(params.wavelength != null ? params.wavelength : 1490);
  if (FIBER_ATTENUATION_DB_PER_KM[wl] == null) {
    const e = new Error('FTTH_WAVELENGTH_UNSUPPORTED');
    e.code = 'FTTH_WAVELENGTH_UNSUPPORTED';
    e.statusCode = 400;
    e.allowed = Object.keys(FIBER_ATTENUATION_DB_PER_KM).map(Number);
    throw e;
  }
  const alpha = FIBER_ATTENUATION_DB_PER_KM[wl];
  const fiber = alpha * km;
  let splitter = 0;
  const list = params.splitters || (params.splitter ? [params.splitter] : []);
  let unknownSplitter = false;
  list.forEach(function (s) {
    const key = String(s);
    if (SPLITTER_LOSS_DB[key] != null) splitter += SPLITTER_LOSS_DB[key];
    else unknownSplitter = true;
  });
  if (unknownSplitter) {
    const e = new Error('FTTH_SPLITTER_RATIO_UNKNOWN');
    e.code = 'FTTH_SPLITTER_RATIO_UNKNOWN';
    e.statusCode = 400;
    e.allowed = Object.keys(SPLITTER_LOSS_DB);
    throw e;
  }
  const splices = Number(params.splices || 0) * SPLICE_LOSS_DB;
  const connectors = Number(params.connectors || 0) * CONNECTOR_LOSS_DB;
  const other = Number(params.otherLossDb || 0);
  const total = fiber + splitter + splices + connectors + other;
  const tx = Number(params.txDbm != null ? params.txDbm : 3);
  const rx = tx - total;
  return {
    txDbm: tx,
    fiberLossDb: Number(fiber.toFixed(3)),
    splitterLossDb: Number(splitter.toFixed(3)),
    spliceLossDb: Number(splices.toFixed(3)),
    connectorLossDb: Number(connectors.toFixed(3)),
    otherLossDb: other,
    totalLossDb: Number(total.toFixed(3)),
    rxDbm: Number(rx.toFixed(3)),
    wavelengthNm: wl,
    note: 'CALCULATED_NOT_MEASURED'
  };
}

module.exports = {
  FIBER_ATTENUATION_DB_PER_KM,
  SPLITTER_LOSS_DB,
  SPLICE_LOSS_DB,
  CONNECTOR_LOSS_DB,
  powerBudget
};
