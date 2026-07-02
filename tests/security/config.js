'use strict';

/**
 * @file tests/security/config.js
 * @module @hms/security-tests/config
 *
 * Central, environment-driven runtime configuration for the HMS
 * `@hms/security-tests` harness.
 *
 * WHY THIS EXISTS
 * ---------------
 * The security suite probes the running system-under-test (the HMS API gateway
 * and the services behind its `/api` prefix) for authentication, authorization
 * (RBAC), input-validation, and data-leakage defects. To stay runnable both
 * LOCALLY and in CI (`../../.github/`) without code edits, every knob is read
 * from an environment variable and falls back to a safe localhost default. A
 * developer can therefore run the suite out-of-the-box against a freshly seeded
 * local docker-compose stack, while CI (or a deployed environment) overrides the
 * base URL, timeouts, and opt-in behaviours purely through the environment.
 *
 * DESIGN CONTRACT
 * ---------------
 *   - ZERO external dependencies: this module requires ONLY `node:path`. It
 *     performs no I/O and never throws at import time, so it is safe to
 *     `require()` from any consumer (http-client, auth, reporter, run, checks).
 *   - Reads `process.env` once, at first `require`, and exposes a FROZEN object
 *     so a check module can never accidentally mutate shared configuration.
 *   - The exact env-var name for the gateway base URL is NOT yet standardized
 *     across sibling suites, so several aliases are accepted for compatibility
 *     (see {@link module:@hms/security-tests/config.baseUrl}).
 *
 * PATIENT-DATA PRIVACY (FIRST-CLASS)
 * ----------------------------------
 * The QA strategy treats patient-data privacy as a top risk area. This module
 * defines {@link SENSITIVE_PATTERNS} — the credential/secret and internal-error
 * signatures that must NEVER appear in non-auth responses, error bodies, or
 * logs — which the leak-assertion checks apply against the SUT's output.
 *
 * MFA
 * ---
 * Privileged roles (admin, doctor) are protected by MFA. Completing the MFA
 * challenge during tests is OPT-IN ({@link completeMfa}) and additionally
 * requires an operator-supplied base32 TOTP secret per role
 * (see {@link getTotpSecret}); absent that, privileged flows are skipped rather
 * than failed.
 */

const path = require('node:path');

// ===========================================================================
// Phase 1 — Environment parsing helpers (internal, not exported)
// ---------------------------------------------------------------------------
// Small, dependency-free readers around `process.env`. Each treats an unset OR
// empty-string variable as "absent" so a blank value in a `.env` file behaves
// the same as an omitted one.
// ===========================================================================

/**
 * Read a string environment variable.
 *
 * @param {string} name - The environment variable name.
 * @param {*} fallback - Value returned when the variable is unset or empty.
 * @returns {string|*} `process.env[name]` when set and non-empty, else `fallback`.
 */
function str(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * Read the first set, non-empty variable among a list of candidate names. This
 * powers alias support where several env-var names may carry the same setting;
 * earlier names in the list win.
 *
 * @param {string[]} names - Candidate env-var names, in priority order.
 * @param {*} fallback - Value returned when none of `names` is set/non-empty.
 * @returns {string|*} The first resolved value, else `fallback`.
 */
function firstStr(names, fallback) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw !== undefined && raw !== '') {
      return raw;
    }
  }
  return fallback;
}

/**
 * Read an integer environment variable.
 *
 * @param {string} name - The environment variable name.
 * @param {number} fallback - Value returned when the variable is missing or is
 *   not a finite base-10 integer.
 * @returns {number} The parsed integer, else `fallback`.
 */
function int(name, fallback) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Truthy string tokens accepted by {@link bool}. */
const BOOL_TRUE = Object.freeze(['1', 'true', 'yes', 'on']);
/** Falsy string tokens accepted by {@link bool}. */
const BOOL_FALSE = Object.freeze(['0', 'false', 'no', 'off']);

/**
 * Read a boolean environment variable with lenient, human-friendly parsing.
 * The value is lowercased and trimmed before comparison: `1|true|yes|on` →
 * `true`, `0|false|no|off` → `false`, and anything else (including unset/empty)
 * → `fallback`.
 *
 * @param {string} name - The environment variable name.
 * @param {boolean} [fallback=false] - Value returned when the variable is unset
 *   or does not match a known truthy/falsy token.
 * @returns {boolean} The parsed boolean, else `fallback`.
 */
function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = raw.trim().toLowerCase();
  if (BOOL_TRUE.includes(value)) {
    return true;
  }
  if (BOOL_FALSE.includes(value)) {
    return false;
  }
  return fallback;
}

/**
 * Remove any trailing slash(es) from a URL/string so base URLs concatenate
 * cleanly with a leading-slash path prefix.
 *
 * @param {string} u - The value to normalize.
 * @returns {string} `u` with all trailing `/` characters removed.
 */
function stripTrailingSlash(u) {
  return String(u).replace(/\/+$/, '');
}

/**
 * Normalize an API path prefix so it ALWAYS starts with a single `/` and has no
 * trailing slash. An empty/`"/"` input collapses to `"/"`.
 *
 * @param {string} p - The raw prefix (e.g. `"api"`, `"/api/"`, `"/api"`).
 * @returns {string} The normalized prefix (e.g. `"/api"`).
 */
function normalizeApiPrefix(p) {
  const trimmed = stripTrailingSlash(String(p).trim());
  if (trimmed === '') {
    return '/';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

// ===========================================================================
// Phase 2 — Resolved configuration scalars
// ---------------------------------------------------------------------------
// Everything defaults to the local docker-compose stack; override via env for
// CI or deployed environments.
// ===========================================================================

/**
 * Gateway base URL WITHOUT the `/api` prefix (used for infra endpoints such as
 * `/health`, and as the root for {@link apiBase}). Several aliases are accepted
 * because the base-URL var name is not yet standardized across sibling suites;
 * `SECURITY_BASE_URL` wins, then `API_BASE_URL`, `API_GATEWAY_URL`,
 * `GATEWAY_URL`, and finally `BASE_URL`. Trailing slashes are stripped.
 *
 * @type {string}
 */
const baseUrl = stripTrailingSlash(
  firstStr(
    [
      'SECURITY_BASE_URL',
      'API_BASE_URL',
      'API_GATEWAY_URL',
      'GATEWAY_URL',
      'BASE_URL',
    ],
    'http://localhost:8080',
  ),
);

/**
 * Normalized API path prefix (leading `/`, no trailing `/`). Defaults to
 * `/api`; override via `SECURITY_API_PREFIX` or `API_PREFIX`.
 *
 * @type {string}
 */
const apiPrefix = normalizeApiPrefix(
  firstStr(['SECURITY_API_PREFIX', 'API_PREFIX'], '/api'),
);

/**
 * Fully-qualified application API base — `baseUrl` + `apiPrefix`
 * (e.g. `http://localhost:8080/api`). All application routes hang off this
 * (e.g. `${apiBase}/auth/login`, `${apiBase}/patients`).
 *
 * @type {string}
 */
const apiBase = `${baseUrl}${apiPrefix}`;

/**
 * Public frontend URL (informational; used by checks that assert on
 * CORS/redirect targets). Defaults to `http://localhost:3000`.
 *
 * @type {string}
 */
const frontendUrl = firstStr(['FRONTEND_URL'], 'http://localhost:3000');

/**
 * Per-request timeout, in milliseconds, for the suite's HTTP client. Reads
 * `TEST_REQUEST_TIMEOUT_MS` first, then `SECURITY_REQUEST_TIMEOUT_MS`, and
 * finally defaults to 15000.
 *
 * @type {number}
 */
const requestTimeoutMs = int(
  'TEST_REQUEST_TIMEOUT_MS',
  int('SECURITY_REQUEST_TIMEOUT_MS', 15000),
);

/**
 * Directory for machine-readable output (JUnit XML). Defaults to the gitignored
 * `./test-results`; override via `TEST_RESULTS_DIR` or `SECURITY_RESULTS_DIR`.
 *
 * @type {string}
 */
const resultsDir = firstStr(
  ['TEST_RESULTS_DIR', 'SECURITY_RESULTS_DIR'],
  './test-results',
);

/**
 * Absolute-or-relative path of the JUnit report the reporter writes. Built with
 * `path.join` so the OS-native separator is used.
 *
 * @type {string}
 */
const junitPath = path.join(resultsDir, 'junit-security.xml');

/**
 * Infra liveness endpoint exposed by the gateway and every service. NOT under
 * the `/api` prefix — probe as `${baseUrl}${healthPath}`.
 *
 * @type {string}
 */
const healthPath = '/health';

/**
 * Infra readiness endpoint (dependencies wired up). Probe as
 * `${baseUrl}${readyPath}`.
 *
 * @type {string}
 */
const readyPath = '/health/ready';

/**
 * When `true` AND a TOTP secret is available for the role
 * (see {@link getTotpSecret}), the auth helper completes the MFA challenge for
 * privileged roles rather than skipping the flow. OPT-IN via
 * `SECURITY_COMPLETE_MFA`.
 *
 * @type {boolean}
 */
const completeMfa = bool('SECURITY_COMPLETE_MFA', false);

/**
 * When `true`, `run.js` treats an unreachable system-under-test as "tests
 * skipped" (soft) instead of hard-failing the run. OPT-IN via
 * `SECURITY_ALLOW_NO_SUT` — useful for lint-only / offline CI stages.
 *
 * @type {boolean}
 */
const allowNoSut = bool('SECURITY_ALLOW_NO_SUT', false);

/**
 * Emit extra diagnostic logging from the harness. OPT-IN via `SECURITY_VERBOSE`.
 *
 * @type {boolean}
 */
const verbose = bool('SECURITY_VERBOSE', false);

/**
 * Whether to actively probe rate limiting. OPT-IN via `SECURITY_TEST_RATE_LIMIT`
 * because hammering endpoints can disrupt other concurrently running tests.
 *
 * @type {boolean}
 */
const testRateLimit = bool('SECURITY_TEST_RATE_LIMIT', false);

/**
 * Expected max requests per window before the gateway returns HTTP 429. Used by
 * the rate-limit probe when {@link testRateLimit} is enabled. Override via
 * `RATE_LIMIT_MAX`.
 *
 * @type {number}
 */
const rateLimitMax = int('RATE_LIMIT_MAX', 100);

/**
 * Strict mode for the security-header check: when `true`, missing hardening
 * headers (e.g. HSTS, X-Content-Type-Options) fail the run instead of warning.
 * OPT-IN via `SECURITY_EXPECT_HEADERS`.
 *
 * @type {boolean}
 */
const expectSecurityHeaders = bool('SECURITY_EXPECT_HEADERS', false);

// ===========================================================================
// Phase 3 — Per-role TOTP secret resolver
// ---------------------------------------------------------------------------
// The env-prefix convention mirrors the fixtures EXACTLY
// (tests/fixtures/credentials.js + tests/performance/config.js): the full
// per-role variable is `TEST_<PREFIX>_TOTP_SECRET` (e.g. TEST_ADMIN_TOTP_SECRET).
// ===========================================================================

/**
 * Map of role key → environment-variable PREFIX. Kept in exact lockstep with
 * the seeded-credentials convention used across the test suites so the same
 * `TEST_<PREFIX>_*` variables resolve consistently everywhere.
 *
 * @constant
 * @type {Readonly<Record<string, string>>}
 */
const ROLE_ENV_PREFIX = Object.freeze({
  admin: 'ADMIN',
  doctor: 'DOCTOR',
  nurse: 'NURSE',
  receptionist: 'RECEPTIONIST',
  labTechnician: 'LABTECH',
  pharmacist: 'PHARMACIST',
  patient: 'PATIENT',
  insurance: 'INSURANCE',
});

/**
 * Resolve the base32 TOTP secret for a role, used to compute a live MFA code
 * when {@link completeMfa} is enabled.
 *
 * Resolution order:
 *   1. Per-role `TEST_<PREFIX>_TOTP_SECRET` (preferred).
 *   2. Global `SECURITY_TOTP_SECRET` fallback (documented convenience — only
 *      consulted when the per-role secret is absent).
 *   3. `null` when neither is set (privileged MFA flows are then skipped, not
 *      failed).
 *
 * Never throws: an unknown `roleKey` simply skips the per-role lookup and falls
 * through to the global fallback / `null`.
 *
 * @param {string} roleKey - A key from {@link ROLE_ENV_PREFIX} (e.g. `'admin'`).
 * @returns {string|null} The base32 TOTP secret, or `null` when unavailable.
 */
function getTotpSecret(roleKey) {
  const prefix = ROLE_ENV_PREFIX[roleKey];
  if (prefix) {
    const perRole = str(`TEST_${prefix}_TOTP_SECRET`, null);
    if (perRole) {
      return perRole;
    }
  }
  // Global fallback (opt-in convenience): only used when the per-role secret is
  // absent. Prefer per-role secrets; return null when neither is configured.
  return str('SECURITY_TOTP_SECRET', null);
}

// ===========================================================================
// Phase 4 — Sensitive-data patterns (patient-data privacy)
// ---------------------------------------------------------------------------
// Signatures of credential/secret leakage and leaked internal error details
// (SQL, ORM, stack frames, driver error codes) that must NEVER surface in
// non-auth responses, error bodies, or logs. The leak-assertion checks scan the
// SUT's output against these patterns.
//
// IMPORTANT NUANCE — `accessToken` / `refreshToken` are DELIBERATELY EXCLUDED:
// they are LEGITIMATELY returned by the auth login/MFA success endpoints, so
// treating them as leakage would produce false positives. The leak scan is
// applied to NON-AUTH data endpoints and error bodies, not to the auth success
// payload, so the JWT tokens are intentionally absent from this list.
// ===========================================================================

/**
 * Ordered list of leakage signatures. Each entry is a `RegExp`; a match against
 * a scanned response/error/log indicates a potential data-leak defect.
 *
 * @constant
 * @type {ReadonlyArray<RegExp>}
 */
const SENSITIVE_PATTERNS = Object.freeze([
  // --- Credential / secret material ---
  /password_hash/i,
  /passwordhash/i,
  /password_salt/i,
  /"password"\s*:/i,
  /mfa_secret/i,
  /totp_secret/i,
  /\bsecret\b/i,
  /private[_-]?key/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // --- Leaked internal error / SQL / stack-trace details ---
  /\bat\s+.+\(.+:\d+:\d+\)/, // JS stack frame, e.g. "at fn (file.js:10:5)"
  /\bSELECT\b.+\bFROM\b/i, // Raw SQL echoed back to the client
  /\bsequelize\b/i, // ORM internals surfaced in an error
  /ER_[A-Z_]+/, // MySQL/MariaDB driver error codes
  /syntax error at or near/i, // PostgreSQL syntax-error text
  /ECONNREFUSED/, // Leaked downstream connection failure
]);

// ===========================================================================
// Phase 5 — Frozen public configuration + exports
// ===========================================================================

/**
 * The resolved scalar configuration, frozen so consumers cannot mutate shared
 * state. Spread into the module exports below alongside the maps/helpers.
 *
 * @type {Readonly<object>}
 */
const config = Object.freeze({
  baseUrl,
  apiPrefix,
  apiBase,
  frontendUrl,
  requestTimeoutMs,
  resultsDir,
  junitPath,
  healthPath,
  readyPath,
  completeMfa,
  allowNoSut,
  verbose,
  testRateLimit,
  rateLimitMax,
  expectSecurityHeaders,
});

/**
 * Public surface of the config module: every scalar setting, the role→env
 * prefix map, the TOTP resolver, and the sensitive-data patterns. The exported
 * object is frozen (safe for CommonJS require caching — freezing the module's
 * exports object does not affect the module registry).
 */
module.exports = Object.freeze({
  ...config,
  ROLE_ENV_PREFIX,
  getTotpSecret,
  SENSITIVE_PATTERNS,
});
