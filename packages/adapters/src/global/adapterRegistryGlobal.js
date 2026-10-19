'use strict';

const { assertValidAdapter } = require('./types');

class AdapterRegistry {
  constructor() {
    this._adapters = [];
  }

  register(adapter) {
    assertValidAdapter(adapter);
    this._adapters.push(adapter);
    this._adapters.sort((a, b) => a.priority - b.priority);
    return this;
  }

  /**
   * Returns the first matching adapter's extracted reading, tagged with
   * which adapter produced it (full provenance — never silently guess which
   * source a reading came from).
   *
   * If NO adapter recognizes the input, this does NOT throw — it returns a
   * clear "needs manual entry" result so the field technician can still close
   * the ticket by typing the number in by hand. An unknown OLT/OTDR vendor
   * must never block a real field job.
   */
  resolve(rawInput) {
    for (const adapter of this._adapters) {
      if (adapter.canHandle(rawInput)) {
        try {
          const result = adapter.extract(rawInput);
          return {
            matched: true,
            sourceId: adapter.sourceId,
            ...result,
          };
        } catch (err) {
          // This adapter recognized the format but couldn't actually parse it
          // (e.g. unimplemented vendor byte layout). Keep trying other
          // adapters instead of failing the whole resolution outright.
          continue;
        }
      }
    }
    return {
      matched: false,
      sourceId: 'MANUAL_ENTRY_REQUIRED',
      rxPowerDbm: null,
      confidenceTier: 'UNVERIFIED',
      sourceMeta: { reason: 'no registered adapter recognized this input' },
    };
  }

  listRegistered() {
    return this._adapters.map((a) => ({ sourceId: a.sourceId, priority: a.priority }));
  }
}

module.exports = { AdapterRegistry };
