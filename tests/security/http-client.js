'use strict';

/**
 * @hms/security-tests — Zero-dependency HTTP client (CommonJS).
 *
 * A minimal, promise-based HTTP client built ONLY on Node.js built-ins
 * (`node:http`, `node:https`, `node:url`). It is the single transport used by
 * the security-suite auth helper and every check suite in this directory.
 *
 * DESIGN CONTRACT — tuned for SECURITY TESTING:
 *   1. HTTP error statuses (4xx / 5xx) are NORMAL, expected results. They MUST
 *      NEVER cause the returned promise to reject — a `401`, `403` or `500` is
 *      resolved just like a `200`, with `ok:false`.
 *   2. Only genuine TRANSPORT failures (connection refused, DNS failure,
 *      timeout, socket error) are surfaced — and even then the promise still
 *      RESOLVES, carrying a populated `networkError`. This lets the suites
 *      gracefully SKIP when the system-under-test (SUT) is down instead of
 *      crashing the run.
 *   3. The returned promise NEVER rejects, for any reason. Every synchronous
 *      throw (e.g. an invalid URL) is caught and converted into a resolved
 *      `networkError` result.
 *
 * PATIENT-DATA PRIVACY / SECURITY (FIRST-CLASS):
 *   This client is a TEST utility only. It carries no credentials of its own,
 *   performs no logging of request/response bodies, and must only ever be
 *   pointed at synthetic/seeded environments — never at production systems
 *   holding real patient PII. Bearer tokens are attached solely via the
 *   explicit `withBearer()` helper by the caller.
 *
 * Every response (transport OK or transport failure) resolves to the SAME
 * shape so callers can treat results uniformly:
 *   {
 *     status,        // number — HTTP status (0 when there was no HTTP response)
 *     ok,            // boolean — status >= 200 && status < 300
 *     headers,       // object — response headers (lowercased keys, {} on failure)
 *     text,          // string — raw response body ('' on failure)
 *     json,          // any|undefined — parsed JSON body, or undefined
 *     durationMs,    // number — measured round-trip in milliseconds
 *     networkError,  // null on any HTTP response; { code, message } on transport failure
 *   }
 *
 * No external dependencies whatsoever.
 */

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

/**
 * Default per-request timeout (milliseconds). Callers may override per call via
 * `options.timeoutMs` (for example passing a suite-level `config.requestTimeoutMs`).
 * @type {number}
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Case-insensitive check for whether a header name is already present on a
 * plain headers object. HTTP header names are case-insensitive, so callers may
 * supply `Content-Type`, `content-type`, etc.
 *
 * @param {Object} headers - headers object to inspect.
 * @param {string} name - header name to look for.
 * @returns {boolean} true when a header with that (case-insensitive) name exists.
 */
function hasHeader(headers, name) {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

/**
 * Normalize an arbitrary request `body` into a wire-ready payload.
 *
 * Rules (mirrors the security-suite contract):
 *   - `body` null/undefined            → no payload is sent.
 *   - `rawBody === true`               → send verbatim, NEVER auto-JSON (used
 *                                        to craft malformed / hand-built bodies).
 *   - `body` is a string or Buffer     → send as-is, no auto Content-Type (this
 *                                        is the MALFORMED-JSON test path).
 *   - anything else (object/array/…)   → `JSON.stringify(body)` and signal that
 *                                        `Content-Type: application/json` should
 *                                        be applied when the caller did not set one.
 *
 * @param {*} body - the caller-supplied body.
 * @param {boolean} rawBody - when true, never auto-serialize.
 * @returns {{ payload: (string|Buffer|undefined), autoJson: boolean }}
 */
function buildPayload(body, rawBody) {
  if (body === undefined || body === null) {
    return { payload: undefined, autoJson: false };
  }
  if (rawBody) {
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      return { payload: body, autoJson: false };
    }
    // rawBody with a non-string/non-Buffer: coerce to string verbatim rather
    // than throwing — the caller explicitly opted out of auto-JSON.
    return { payload: String(body), autoJson: false };
  }
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    return { payload: body, autoJson: false };
  }
  // Plain object / array / number / boolean → JSON encode.
  return { payload: JSON.stringify(body), autoJson: true };
}

/**
 * Serialize a `query` object onto a URL's search params. Array values expand to
 * repeated keys; null/undefined values (and array items) are skipped. Mutates
 * the provided `URL` instance in place.
 *
 * @param {URL} target - the URL whose search params are extended.
 * @param {Object} [query] - key/value pairs to append.
 */
function applyQuery(target, query) {
  if (!query || typeof query !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) {
          continue;
        }
        target.searchParams.append(key, String(item));
      }
    } else {
      target.searchParams.append(key, String(value));
    }
  }
}

/**
 * Attempt to parse a response body as JSON without ever throwing.
 *
 * Parsing is attempted when the `content-type` announces JSON OR the trimmed
 * body "looks like" a JSON object/array. On any parse failure `undefined` is
 * returned, matching the "never throw on a bad body" contract.
 *
 * @param {string} text - the raw response body.
 * @param {string} contentType - the (already lowercased) response content-type.
 * @returns {*|undefined} the parsed value, or undefined.
 */
function tryParseJson(text, contentType) {
  const trimmed = text.trim();
  const looksJson = trimmed.length > 0 && (trimmed[0] === '{' || trimmed[0] === '[');
  if (!contentType.includes('application/json') && !looksJson) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Perform an HTTP(S) request. The core primitive every helper delegates to.
 *
 * @param {string} method - HTTP verb (e.g. 'GET', 'POST'); uppercased internally.
 * @param {string} url - absolute URL (e.g. 'http://localhost:8080/api/patients').
 * @param {Object} [options] - request options.
 * @param {Object} [options.headers] - request headers.
 * @param {*} [options.body] - request body (see {@link buildPayload}).
 * @param {boolean} [options.rawBody] - send `body` verbatim, never auto-JSON.
 * @param {Object} [options.query] - query params appended to the URL.
 * @param {number} [options.timeoutMs] - per-request timeout override.
 * @param {boolean} [options.insecureTLS] - for https URLs, disable TLS cert
 *   verification (`rejectUnauthorized:false`). Intended for local self-signed
 *   endpoints only.
 * @returns {Promise<{status:number, ok:boolean, headers:Object, text:string,
 *   json:*, durationMs:number, networkError:(null|{code:string, message:string})}>}
 *   A promise that ALWAYS resolves (never rejects).
 */
async function request(method, url, options = {}) {
  const started = process.hrtime.bigint();
  const elapsedMs = () => Math.round(Number(process.hrtime.bigint() - started) / 1e6);
  const opt = options && typeof options === 'object' ? options : {};

  return new Promise((resolve) => {
    // `settled` guards against double-resolution — e.g. a timeout firing at the
    // same moment the socket errors, or an error after 'end'.
    let settled = false;
    let timedOut = false;

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    // Convert ANY transport-level failure into a RESOLVED networkError result.
    const failNetwork = (err) => {
      settle({
        status: 0,
        ok: false,
        headers: {},
        text: '',
        json: undefined,
        durationMs: elapsedMs(),
        networkError: {
          code: timedOut ? 'ETIMEDOUT' : (err && err.code) || 'EREQUEST',
          message: (err && err.message) || 'request failed',
        },
      });
    };

    try {
      const verb = String(method || 'GET').toUpperCase();
      const target = new URL(url);
      applyQuery(target, opt.query);

      const isHttps = target.protocol === 'https:';
      const transport = isHttps ? https : http;

      // Copy caller headers so we never mutate their object.
      const headers = { ...(opt.headers || {}) };
      const { payload, autoJson } = buildPayload(opt.body, opt.rawBody === true);
      if (payload !== undefined) {
        if (autoJson && !hasHeader(headers, 'content-type')) {
          headers['Content-Type'] = 'application/json';
        }
        // Always set a correct Content-Length for a string/Buffer body unless
        // the caller supplied one explicitly (allowing crafted/mismatched
        // lengths for negative security tests).
        if (!hasHeader(headers, 'content-length')) {
          headers['Content-Length'] = Buffer.byteLength(payload);
        }
      }

      const timeoutMs =
        Number.isFinite(opt.timeoutMs) && opt.timeoutMs > 0 ? opt.timeoutMs : DEFAULT_TIMEOUT_MS;

      const requestOptions = {
        method: verb,
        hostname: target.hostname,
        // Node applies the protocol default (80/443) when port is undefined.
        port: target.port ? Number(target.port) : undefined,
        // Preserve the full path INCLUDING the (possibly appended) query string.
        path: `${target.pathname}${target.search}`,
        headers,
      };
      // Optional, opt-in relaxation of TLS verification for local https targets.
      if (isHttps && opt.insecureTLS === true) {
        requestOptions.rejectUnauthorized = false;
      }

      const req = transport.request(requestOptions, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const buf = Buffer.concat(chunks);
            const text = buf.toString('utf8');
            const contentType = String(res.headers['content-type'] || '').toLowerCase();
            const status = res.statusCode || 0;
            settle({
              status,
              ok: status >= 200 && status < 300,
              // Node lowercases response header keys for us. NOTE: we DO NOT
              // follow redirects — a 3xx is reported as-is.
              headers: res.headers,
              text,
              json: tryParseJson(text, contentType),
              durationMs: elapsedMs(),
              networkError: null,
            });
          } catch (assembleErr) {
            // A failure while assembling the response (extremely unlikely) is
            // treated as a transport error so the promise still resolves.
            failNetwork(assembleErr);
          }
        });
        // A socket error mid-response is a transport failure.
        res.on('error', failNetwork);
      });

      req.on('error', failNetwork);

      // Timeout: mark the flag, then destroy the request. The destroy surfaces
      // via the 'error' handler above, where `timedOut` maps it to ETIMEDOUT.
      req.setTimeout(timeoutMs, () => {
        timedOut = true;
        req.destroy(new Error('timeout'));
      });

      if (payload !== undefined) {
        req.write(payload);
      }
      req.end();
    } catch (syncErr) {
      // Synchronous failures (e.g. `new URL('not a url')`) resolve — never throw.
      failNetwork(syncErr);
    }
  });
}

/**
 * GET convenience wrapper.
 * @param {string} url - absolute URL.
 * @param {Object} [options] - see {@link request}.
 * @returns {Promise<Object>} resolved response object.
 */
function get(url, options) {
  return request('GET', url, options);
}

/**
 * POST convenience wrapper.
 * @param {string} url - absolute URL.
 * @param {*} [body] - request body (see {@link buildPayload}).
 * @param {Object} [options] - see {@link request}.
 * @returns {Promise<Object>} resolved response object.
 */
function post(url, body, options = {}) {
  return request('POST', url, { ...options, body });
}

/**
 * PUT convenience wrapper.
 * @param {string} url - absolute URL.
 * @param {*} [body] - request body (see {@link buildPayload}).
 * @param {Object} [options] - see {@link request}.
 * @returns {Promise<Object>} resolved response object.
 */
function put(url, body, options = {}) {
  return request('PUT', url, { ...options, body });
}

/**
 * PATCH convenience wrapper.
 * @param {string} url - absolute URL.
 * @param {*} [body] - request body (see {@link buildPayload}).
 * @param {Object} [options] - see {@link request}.
 * @returns {Promise<Object>} resolved response object.
 */
function patch(url, body, options = {}) {
  return request('PATCH', url, { ...options, body });
}

/**
 * DELETE convenience wrapper (named `del` because `delete` is a reserved word).
 * @param {string} url - absolute URL.
 * @param {Object} [options] - see {@link request}.
 * @returns {Promise<Object>} resolved response object.
 */
function del(url, options) {
  return request('DELETE', url, options);
}

/**
 * Build a headers object with a Bearer Authorization header, preserving any
 * headers already provided. Central helper for authenticated calls so suites
 * (and the auth helper) do not hand-roll the `Authorization` string.
 *
 * @param {string} token - the bearer token.
 * @param {Object} [headers] - existing headers to extend.
 * @returns {Object} a new headers object including `Authorization: Bearer <token>`.
 */
function withBearer(token, headers = {}) {
  return { ...headers, Authorization: `Bearer ${token}` };
}

module.exports = {
  request,
  get,
  post,
  put,
  patch,
  del,
  withBearer,
  DEFAULT_TIMEOUT_MS,
};
