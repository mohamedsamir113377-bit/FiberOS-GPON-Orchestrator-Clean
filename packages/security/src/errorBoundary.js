'use strict';

// Public error boundary: never serialize raw database/provider/runtime messages.
// Known application errors keep their stable code; unexpected errors collapse to
// a generic server error while preserving the status class when explicitly set.
function publicError(error, fallback) {
  const e = error || {};
  const code = typeof e.code === 'string' && /^[A-Z][A-Z0-9_:-]{2,80}$/.test(e.code) ? e.code : null;
  const status = Number.isInteger(e.statusCode) && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
  if (code) return { status, body: { ok: false, error: code } };
  return { status, body: { ok: false, error: fallback || (status < 500 ? 'REQUEST_REJECTED' : 'INTERNAL_SERVER_ERROR') } };
}

module.exports = { publicError };
