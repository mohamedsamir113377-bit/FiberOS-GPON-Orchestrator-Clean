'use strict';

/**
 * FTTX materials & standards catalog — values attributed to:
 * - ITU-T Manual 2009 «Optical fibres, cables and systems» (attenuation table 1-2 p.39;
 *   bend guidance ~12× / 24× under tension p.86)
 * - FTTH Handbook Ed.9 2021 (bend 20× install / 10–15× static p.169; microduct blow
 *   1000 m empty / 100–300 m occupied p.175; splice limits p.288; connector RL/IL p.282;
 *   splitter 1×64 typical 18–20 dB p.261)
 * - Sterlite STL Application Note «FTTX NETWORKS» June 2014 (architectures, wavelengths,
 *   PON table; GPON rate row recorded as printed with asymmetry caution)
 *
 * Operators select profiles; no coefficient is invented beyond cited sources.
 */

const FIBER_ITU_G652 = Object.freeze({
  'G.652.A': Object.freeze({
    code: 'G.652.A',
    family: 'G.652',
    lowWaterPeak: false,
    attenuationDbPerKmMax: Object.freeze({
      1311: 0.423,
      1551: 0.278,
      1611: 0.289
    }),
    attenuationDbPerKmMin: Object.freeze({
      1311: 0.348,
      1551: 0.211,
      1611: 0.208
    }),
    source: 'ITU-T Manual 2009 Table 1-2 p.39 (G.652.A&B cable)'
  }),
  'G.652.B': Object.freeze({
    code: 'G.652.B',
    family: 'G.652',
    lowWaterPeak: false,
    attenuationDbPerKmMax: Object.freeze({ 1311: 0.423, 1551: 0.278, 1611: 0.289 }),
    attenuationDbPerKmMin: Object.freeze({ 1311: 0.348, 1551: 0.211, 1611: 0.208 }),
    source: 'ITU-T Manual 2009 Table 1-2 p.39 (G.652.A&B cable)'
  }),
  'G.652.C': Object.freeze({
    code: 'G.652.C',
    family: 'G.652',
    lowWaterPeak: true,
    attenuationDbPerKmMax: Object.freeze({
      1311: 0.423,
      1371: 0.386,
      1391: 0.372,
      1551: 0.277,
      1611: 0.283
    }),
    attenuationDbPerKmMin: Object.freeze({
      1311: 0.352,
      1371: 0.316,
      1391: 0.301,
      1551: 0.209,
      1611: 0.212
    }),
    source: 'ITU-T Manual 2009 Table 1-2 p.39 (G.652.C&D cable)'
  }),
  'G.652.D': Object.freeze({
    code: 'G.652.D',
    family: 'G.652',
    lowWaterPeak: true,
    attenuationDbPerKmMax: Object.freeze({
      1311: 0.423,
      1371: 0.386,
      1391: 0.372,
      1551: 0.277,
      1611: 0.283
    }),
    attenuationDbPerKmMin: Object.freeze({
      1311: 0.352,
      1371: 0.316,
      1391: 0.301,
      1551: 0.209,
      1611: 0.212
    }),
    source: 'ITU-T Manual 2009 Table 1-2 p.39 (G.652.C&D cable)'
  })
});

const FIBER_BEND_INSENSITIVE = Object.freeze({
  'G.657.A1': Object.freeze({
    code: 'G.657.A1',
    family: 'G.657',
    note: 'Bend-insensitive; use for tight indoor/last-drop bends per operator profile',
    source: 'ITU-T G.657 (referenced in Manual bend discussion)'
  }),
  'G.657.A2': Object.freeze({ code: 'G.657.A2', family: 'G.657', note: 'Tighter bend radius class', source: 'ITU-T G.657' }),
  'G.657.B3': Object.freeze({ code: 'G.657.B3', family: 'G.657', note: 'Extreme bend applications', source: 'ITU-T G.657' })
});

const CABLE_INSTALL_METHODS = Object.freeze([
  'DUCT_PULL',
  'DIRECT_BURY_PLOUGH',
  'DIRECT_BURY_TRENCH',
  'AERIAL',
  'MICRODUCT_BLOW',
  'MICRODUCT_FLOAT',
  'FIGURE_OF_EIGHT_PULL'
]);

const MECHANICAL_INSTALL_LIMITS = Object.freeze({
  bendRadiusDynamicMultiplier: 20,
  bendRadiusStaticMultiplierMin: 10,
  bendRadiusStaticMultiplierMax: 15,
  bendRadiusGeneralMultiplier: 12,
  bendRadiusUnderTensionMultiplier: 24,
  fibreMinBendRadiusMm: 30,
  microductBlowEmptyM: Object.freeze({ typicalMin: 1000, note: 'Empty sub-duct typical ≥1000 m' }),
  microductBlowOccupiedM: Object.freeze({ typicalMin: 100, typicalMax: 300, note: 'Occupied duct shorter reaches' }),
  sourceHandbook: 'FTTH Handbook Ed.9 p.169 (20× dynamic, 10–15× static); p.175 microduct',
  sourceItu: 'ITU-T Manual 2009 p.86 (~12× general, ~24× under tension)'
});

const SPLITTER_PROFILES = Object.freeze({
  '1x2': Object.freeze({ ratio: 2, typicalLossDbMin: 3.0, typicalLossDbMax: 3.8, source: 'Ideal 3.01 dB + excess' }),
  '1x4': Object.freeze({ ratio: 4, typicalLossDbMin: 6.0, typicalLossDbMax: 7.5, source: 'Ideal ~6.02 dB + excess' }),
  '1x8': Object.freeze({ ratio: 8, typicalLossDbMin: 9.0, typicalLossDbMax: 11.0, source: 'Ideal ~9.03 dB + excess' }),
  '1x16': Object.freeze({ ratio: 16, typicalLossDbMin: 12.0, typicalLossDbMax: 14.5, source: 'Common FTTH cascade' }),
  '1x32': Object.freeze({
    ratio: 32,
    typicalLossDbMin: 15.5,
    typicalLossDbMax: 17.5,
    referenceExampleDb: 17.1,
    source: 'ITU-T Manual example 1:32 = 17.1 dB (table 9-9); Handbook cascade practice'
  }),
  '1x64': Object.freeze({
    ratio: 64,
    typicalLossDbMin: 18.0,
    typicalLossDbMax: 20.0,
    source: 'FTTH Handbook Ed.9 p.261 typical 18–20 dB for 1×64'
  }),
  '1x128': Object.freeze({
    ratio: 128,
    typicalLossDbMin: 21.0,
    typicalLossDbMax: 24.0,
    source: 'STL note: up to 64× and even 128× possible; Class C+ OLT often required'
  })
});

const CONNECTOR_POLISH = Object.freeze({
  PC: Object.freeze({
    code: 'PC',
    angleDeg: 0,
    returnLossDbPluggedMin: 45,
    returnLossDbPluggedMax: 55,
    returnLossDbAgainstAirApprox: 14.7,
    insertionLossDbTypicalMin: 0.1,
    insertionLossDbTypicalMax: 0.5,
    source: 'FTTH Handbook Ed.9 p.282'
  }),
  APC: Object.freeze({
    code: 'APC',
    angleDeg: 8,
    angleDegAlt: 9,
    returnLossDbPluggedMin: 65,
    returnLossDbPluggedMax: 90,
    returnLossDbAgainstAirMin: 45,
    insertionLossDbTypicalMin: 0.1,
    insertionLossDbTypicalMax: 0.5,
    source: 'FTTH Handbook Ed.9 p.282'
  })
});

const SPLICE_METHODS = Object.freeze({
  FUSION_CORE: Object.freeze({ code: 'FUSION_CORE', maxLossDb: 0.03, source: 'Handbook p.288 active core alignment' }),
  FUSION_CLADDING: Object.freeze({ code: 'FUSION_CLADDING', maxLossDb: 0.05, source: 'Handbook p.288 clad alignment' }),
  FUSION_VGROOVE: Object.freeze({ code: 'FUSION_VGROOVE', maxLossDb: 0.1, source: 'Handbook p.288 fixed v-groove / ribbon' }),
  MECHANICAL: Object.freeze({ code: 'MECHANICAL', maxLossDb: 0.5, source: 'Handbook / Manual mechanical splice practice' }),
  PRACTICAL_FIELD: Object.freeze({ code: 'PRACTICAL_FIELD', maxLossDb: 0.1, source: 'Common field acceptance ≤0.1 dB' })
});

const FTTX_ARCHITECTURES = Object.freeze({
  FTTN: Object.freeze({ code: 'FTTN', meaning: 'Fibre to the node / last amplifier', source: 'STL FTTX NETWORKS p.2' }),
  FTTC: Object.freeze({ code: 'FTTC', meaning: 'Fibre to the curb/closet/cabinet (>300 m of client)', source: 'STL p.2' }),
  FTTB: Object.freeze({ code: 'FTTB', meaning: 'Fibre to the building boundary', source: 'STL p.2' }),
  FTTH: Object.freeze({ code: 'FTTH', meaning: 'Fibre to the living space boundary', source: 'STL p.2' }),
  FTTP: Object.freeze({ code: 'FTTP', meaning: 'Fibre to the premises (includes FTTH+FTTB)', source: 'STL p.2' }),
  FTTD: Object.freeze({ code: 'FTTD', meaning: 'Fibre to the desk', source: 'STL p.2' }),
  FTTA: Object.freeze({ code: 'FTTA', meaning: 'Fibre to the antenna (DAS / mobile)', source: 'STL p.2' })
});

const TOPOLOGY_TYPES = Object.freeze({
  P2P_ACTIVE: Object.freeze({
    code: 'P2P_ACTIVE',
    wavelengths: Object.freeze({
      downstreamVoiceDataNm: 1310,
      downstreamVideoNm: 1550,
      upstreamNm: 1310,
      fibers: 2
    }),
    source: 'STL FTTX NETWORKS p.2'
  }),
  P2MP_PON: Object.freeze({
    code: 'P2MP_PON',
    wavelengths: Object.freeze({
      downstreamVoiceDataNm: 1490,
      downstreamVideoNm: 1550,
      upstreamNm: 1310,
      fibers: 1
    }),
    source: 'STL FTTX NETWORKS p.2'
  })
});

const PON_TECHNOLOGIES = Object.freeze({
  BPON: Object.freeze({
    code: 'BPON',
    downstreamMbps: 1244.16,
    upstreamMbps: 622.08,
    specification: 'ITU-T G.983',
    protocol: 'ATM',
    source: 'STL Table 1 p.5'
  }),
  GPON: Object.freeze({
    code: 'GPON',
    downstreamMbps: 2488.32,
    upstreamMbps: 2488.32,
    upstreamMbpsCommonAsymmetric: 1244.16,
    specification: 'ITU-T G.984',
    protocol: 'ATM or GEM',
    note: 'STL table prints 2488.32/2488.32; many deployments use asymmetric 2.488/1.244 Gbps — operator must declare',
    source: 'STL Table 1 p.5'
  }),
  EPON: Object.freeze({
    code: 'EPON',
    downstreamMbps: 1250,
    upstreamMbps: 1250,
    specification: 'IEEE 802.3ah-2004',
    protocol: 'MPCP',
    source: 'STL Table 1 p.5'
  }),
  '10G-EPON': Object.freeze({ code: '10G-EPON', note: 'Next-gen mentioned by STL', source: 'STL p.5' }),
  '10G-GPON': Object.freeze({ code: '10G-GPON', note: 'Next-gen mentioned by STL', source: 'STL p.5' })
});

function listFiberStandards() {
  return Object.freeze({
    g652: Object.values(FIBER_ITU_G652),
    g657: Object.values(FIBER_BEND_INSENSITIVE)
  });
}

function getFiberAttenuationMax(fiberCode, wavelengthNm) {
  const f = FIBER_ITU_G652[fiberCode];
  if (!f) {
    const e = new Error('FIBER_STANDARD_UNKNOWN');
    e.code = 'FIBER_STANDARD_UNKNOWN';
    throw e;
  }
  const wl = Math.round(Number(wavelengthNm));
  const table = f.attenuationDbPerKmMax;
  if (table[wl] != null) return table[wl];
  // nearest tabulated key
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) {
    if (Math.abs(k - wl) < Math.abs(best - wl)) best = k;
  }
  return table[best];
}

function evaluateBendRadius({ cableDiameterMm, proposedRadiusMm, condition = 'STATIC' } = {}) {
  const d = Number(cableDiameterMm);
  const r = Number(proposedRadiusMm);
  if (!Number.isFinite(d) || d <= 0) {
    const e = new Error('CABLE_DIAMETER_INVALID');
    e.code = 'CABLE_DIAMETER_INVALID';
    throw e;
  }
  if (!Number.isFinite(r) || r <= 0) {
    const e = new Error('BEND_RADIUS_INVALID');
    e.code = 'BEND_RADIUS_INVALID';
    throw e;
  }
  const cond = String(condition).toUpperCase();
  let minMult;
  if (cond === 'DYNAMIC' || cond === 'INSTALLATION' || cond === 'UNDER_TENSION') {
    minMult = MECHANICAL_INSTALL_LIMITS.bendRadiusDynamicMultiplier;
  } else {
    minMult = MECHANICAL_INSTALL_LIMITS.bendRadiusStaticMultiplierMin;
  }
  const minRadius = d * minMult;
  const accepted = r >= minRadius;
  return Object.freeze({
    accepted,
    status: accepted ? 'ACCEPTED' : 'REJECTED_BEND_RADIUS',
    cableDiameterMm: d,
    proposedRadiusMm: r,
    minimumRadiusMm: minRadius,
    multiplierApplied: minMult,
    condition: cond,
    source: MECHANICAL_INSTALL_LIMITS.sourceHandbook
  });
}

function evaluateMicroductBlow({ pathLengthM, ductOccupied = false } = {}) {
  const L = Number(pathLengthM);
  if (!Number.isFinite(L) || L < 0) {
    const e = new Error('MICRODUCT_PATH_LENGTH_INVALID');
    e.code = 'MICRODUCT_PATH_LENGTH_INVALID';
    throw e;
  }
  if (ductOccupied) {
    const max = MECHANICAL_INSTALL_LIMITS.microductBlowOccupiedM.typicalMax;
    return Object.freeze({
      accepted: L <= max,
      status: L <= max ? 'WITHIN_TYPICAL_OCCUPIED' : 'EXCEEDS_TYPICAL_OCCUPIED',
      pathLengthM: L,
      typicalMaxM: max,
      source: MECHANICAL_INSTALL_LIMITS.sourceHandbook
    });
  }
  const min = MECHANICAL_INSTALL_LIMITS.microductBlowEmptyM.typicalMin;
  return Object.freeze({
    accepted: true,
    status: L >= min ? 'TYPICAL_EMPTY_REACH' : 'SHORTER_THAN_TYPICAL_EMPTY',
    pathLengthM: L,
    typicalMinM: min,
    source: MECHANICAL_INSTALL_LIMITS.sourceHandbook
  });
}

function resolveSplitterLossDb(profileKey, { useReferenceExample = true } = {}) {
  const p = SPLITTER_PROFILES[profileKey];
  if (!p) {
    const e = new Error('SPLITTER_PROFILE_UNKNOWN');
    e.code = 'SPLITTER_PROFILE_UNKNOWN';
    throw e;
  }
  if (useReferenceExample && p.referenceExampleDb != null) return p.referenceExampleDb;
  return (p.typicalLossDbMin + p.typicalLossDbMax) / 2;
}

function listOperatorSelectableCatalog() {
  return Object.freeze({
    fiberStandards: listFiberStandards(),
    cableInstallMethods: CABLE_INSTALL_METHODS,
    mechanicalLimits: MECHANICAL_INSTALL_LIMITS,
    splitters: SPLITTER_PROFILES,
    connectors: CONNECTOR_POLISH,
    spliceMethods: SPLICE_METHODS,
    architectures: FTTX_ARCHITECTURES,
    topologies: TOPOLOGY_TYPES,
    ponTechnologies: PON_TECHNOLOGIES,
    truthBoundary: 'CATALOG_FROM_CITED_STANDARDS; OPERATOR_MUST_DECLARE_VENDOR_DATASHEET_OVERRIDES'
  });
}

module.exports = {
  FIBER_ITU_G652,
  FIBER_BEND_INSENSITIVE,
  CABLE_INSTALL_METHODS,
  MECHANICAL_INSTALL_LIMITS,
  SPLITTER_PROFILES,
  CONNECTOR_POLISH,
  SPLICE_METHODS,
  FTTX_ARCHITECTURES,
  TOPOLOGY_TYPES,
  PON_TECHNOLOGIES,
  listFiberStandards,
  getFiberAttenuationMax,
  evaluateBendRadius,
  evaluateMicroductBlow,
  resolveSplitterLossDb,
  listOperatorSelectableCatalog
};
