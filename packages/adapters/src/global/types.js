'use strict';

/**
 * WHY THIS FILE EXISTS
 * ---------------------
 * You don't know which OLT/OTDR models each client company runs (Huawei vs
 * Nokia vs ZTE OLTs; EXFO vs Viavi vs Yokogawa OTDRs — and different firmware
 * revisions even within the same brand). Hardcoding one vendor's protocol or
 * byte layout means the system breaks the first time it meets a company that
 * uses something else.
 *
 * The fix is not "support every vendor" (impossible without real specs/access
 * to each one) — it's an architecture where NO vendor is required to make the
 * system work, and adding a new one never touches existing code.
 *
 * Every source of an optical reading — a photo, a manual entry, a live OLT
 * poll, an uploaded .SOR file — implements this same three-method contract.
 * The rest of the system (ticket closing, evidence storage, audit ledger)
 * only ever talks to this interface. It never knows or cares which vendor
 * produced the number.
 *
 * CONTRACT (duck-typed, no TS types available in this sandbox, enforced by
 * the registry's runtime checks + tests instead):
 *
 *   sourceId: string                 — stable machine key, e.g. 'MANUAL_ENTRY'
 *   priority: number                 — lower runs first when several could match
 *   canHandle(rawInput): boolean     — cheap, side-effect-free check
 *   extract(rawInput): {
 *     rxPowerDbm: number | null,     — null is valid: "adapter matched but has no power reading"
 *     confidenceTier: 'VERIFIED' | 'UNVERIFIED',
 *     sourceMeta: object,            — whatever provenance detail this source can offer
 *   }
 *   Adapters that recognize the input but cannot actually extract a value yet
 *   (e.g. no OCR provider configured, no vendor byte-layout spec yet) MUST
 *   throw a named error rather than return a fabricated number. See
 *   photoOcrAdapter.js and otdrFileAdapter.js for real examples of this.
 */

class UnsupportedInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedInputError';
  }
}

function assertValidAdapter(adapter) {
  const required = ['sourceId', 'priority', 'canHandle', 'extract'];
  const missing = required.filter((key) => adapter[key] === undefined);
  if (missing.length > 0) {
    throw new TypeError(`ERR_INVALID_ADAPTER: missing ${missing.join(', ')} on adapter`);
  }
}

module.exports = { UnsupportedInputError, assertValidAdapter };
