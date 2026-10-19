/**
 * @fiberos/db — single canonical DATABASE_URL / DATABASE_URL_FILE boundary.
 *
 * Interpretation rules (identical for API, AI, worker, GIS and release tooling):
 *   1. DATABASE_URL_FILE is the authoritative production source (mounted secret).
 *   2. DATABASE_URL is the inline/legacy source.
 *   3. When BOTH are set they must normalise to the exact same connection string.
 *      Equal  -> accepted, FILE is the value used, and the agreement is recorded.
 *      Differ -> fail closed (…_BOTH_SET_CONFLICT). Silently preferring one of two
 *                different connection strings is how a service ends up talking to
 *                a different database than the readiness gate verified.
 *   4. An empty, unreadable, non-regular or unparsable source fails closed.
 *   5. The connection string and any credential are NEVER put into a log line or
 *      an error message; failures are reported by code and a redacted form only.
 */
'use strict';

const fs = require('node:fs');

const VALID_PROTOCOLS = Object.freeze(['postgres:', 'postgresql:']);
const MAX_URL_BYTES = 8192;
const SOURCE_NONE = 'NONE';
const SOURCE_INLINE = 'INLINE';
const SOURCE_FILE = 'FILE';
const SOURCE_AGREED = 'FILE_AND_INLINE_AGREE';

function codedError(code, options) {
  const e = new Error(code);
  e.code = code;
  e.statusCode = (options && options.statusCode) || 503;
  e.expose = true;
  return e;
}

/** Redact every credential component so a URL is safe for logs/diagnostics. */
function redactDatabaseUrl(value) {
  const text = String(value == null ? '' : value);
  if (!text) return '';
  try {
    const u = new URL(text);
    if (u.username) u.username = '***';
    if (u.password) u.password = '***';
    return u.toString();
  } catch (_) {
    return '<invalid-database-url>';
  }
}

/**
 * Validate one connection string. Never echoes the value on failure.
 * `requireConnectionTarget=false` is used only for diagnostics surfaces.
 */
function validateDatabaseUrl(value, name, options) {
  const label = String(name || 'DATABASE_URL');
  const raw = String(value == null ? '' : value);
  const trimmed = raw.trim();
  if (!trimmed) throw codedError(`${label}_EMPTY`);
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_URL_BYTES) throw codedError(`${label}_TOO_LONG`);
  // A trailing newline is normal for a mounted secret file and is removed by the
  // trim above; a control character or whitespace that survives trimming means the
  // secret was captured with an internal break or smart-quoted by a config system.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw codedError(`${label}_INVALID_CONTROL_CHARACTER`);
  if (/\s/.test(trimmed)) throw codedError(`${label}_INVALID_WHITESPACE`);
  let parsed;
  try { parsed = new URL(trimmed); } catch (_) { throw codedError(`${label}_INVALID`); }
  if (!VALID_PROTOCOLS.includes(parsed.protocol)) throw codedError(`${label}_PROTOCOL_INVALID`);
  if ((options && options.requireConnectionTarget) === false) {
    return { url: trimmed, redacted: redactDatabaseUrl(trimmed), host: parsed.hostname || '', port: parsed.port || '', database: '', user: parsed.username || '' };
  }
  if (!parsed.hostname) throw codedError(`${label}_HOST_MISSING`);
  if (!parsed.username) throw codedError(`${label}_USER_MISSING`);
  const database = parsed.pathname.replace(/^\//, '');
  if (!database) throw codedError(`${label}_DATABASE_MISSING`);
  return {
    url: trimmed,
    redacted: redactDatabaseUrl(trimmed),
    host: parsed.hostname,
    port: parsed.port || '',
    database,
    user: parsed.username
  };
}

/** Read a `*_FILE` secret path. Distinguishes absent / unreadable / empty. */
function readSecretFile(filePath, name) {
  const label = String(name || 'SECRET_FILE');
  const target = String(filePath == null ? '' : filePath).trim();
  if (!target) throw codedError(`${label}_PATH_EMPTY`);
  let stat;
  try { stat = fs.statSync(target); } catch (_) { throw codedError(`${label}_NOT_FOUND`); }
  if (!stat.isFile()) throw codedError(`${label}_NOT_REGULAR_FILE`);
  let text;
  try { text = fs.readFileSync(target, 'utf8'); } catch (_) { throw codedError(`${label}_UNREADABLE`); }
  if (!text.trim()) throw codedError(`${label}_EMPTY`);
  return text;
}

/**
 * Resolve one database variable pair. Throws a coded, credential-free error.
 * Returns { configured, source, url, redacted, host, port, database, user, agreed }.
 */
function resolveDatabaseUrl(env, name, options) {
  const source = env || process.env;
  const label = String(name || 'DATABASE_URL');
  const inlineRaw = String(source[label] == null ? '' : source[label]);
  const fileRaw = String(source[`${label}_FILE`] == null ? '' : source[`${label}_FILE`]);
  const inlineSet = inlineRaw.trim() !== '';
  const fileSet = fileRaw.trim() !== '';

  if (!inlineSet && !fileSet) {
    return { configured: false, source: SOURCE_NONE, url: '', redacted: '', host: '', port: '', database: '', user: '', agreed: false, code: `${label}_OR_${label}_FILE_REQUIRED` };
  }
  if (inlineSet && !fileSet) {
    const validated = validateDatabaseUrl(inlineRaw, label, options);
    return Object.assign({ configured: true, source: SOURCE_INLINE, agreed: false, code: null }, validated);
  }
  const fromFile = validateDatabaseUrl(readSecretFile(fileRaw, `${label}_FILE`), `${label}_FILE`, options);
  if (!inlineSet) {
    return Object.assign({ configured: true, source: SOURCE_FILE, agreed: false, code: null }, fromFile);
  }
  const fromInline = validateDatabaseUrl(inlineRaw, label, options);
  if (fromFile.url !== fromInline.url) throw codedError(`${label}_AND_${label}_FILE_BOTH_SET_CONFLICT`);
  return Object.assign({ configured: true, source: SOURCE_AGREED, agreed: true, code: null }, fromFile);
}

/** Non-throwing wrapper for gates that report rather than crash. */
function tryResolveDatabaseUrl(env, name, options) {
  try {
    return { ok: true, error: null, resolution: resolveDatabaseUrl(env, name, options) };
  } catch (error) {
    return { ok: false, error: { code: error.code || 'DATABASE_URL_RESOLUTION_FAILED' }, resolution: null };
  }
}

/** Connection-string read for non-DATABASE names (worker/service roles). */
function readSecretEnvValue(env, name) {
  const source = env || process.env;
  const inline = String(source[name] == null ? '' : source[name]).trim();
  const filePath = String(source[`${name}_FILE`] == null ? '' : source[`${name}_FILE`]).trim();
  const inlineSet = inline !== '';
  const fileSet = filePath !== '';

  if (!fileSet) return inline;
  const fileValue = readSecretFile(filePath, `${name}_FILE`).trim();
  if (inlineSet && inline !== fileValue) {
    throw codedError(`${name}_AND_${name}_FILE_BOTH_SET_CONFLICT`);
  }
  return fileValue;
}

module.exports = {
  VALID_PROTOCOLS,
  MAX_URL_BYTES,
  SOURCE_NONE,
  SOURCE_INLINE,
  SOURCE_FILE,
  SOURCE_AGREED,
  redactDatabaseUrl,
  validateDatabaseUrl,
  readSecretFile,
  readSecretEnvValue,
  resolveDatabaseUrl,
  tryResolveDatabaseUrl
};
