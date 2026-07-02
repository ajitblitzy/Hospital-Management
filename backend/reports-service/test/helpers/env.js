'use strict';

/**
 * Deterministic test environment for the reports-service test suite.
 * -----------------------------------------------------------------------------
 * Requiring this module applies stable, CI-friendly defaults to `process.env`.
 * Every value is written with a "set only if absent" guard so that a spec (or an
 * outer shell / CI) can override any of them by exporting the variable BEFORE
 * this file is required. Requiring it performs NO I/O and pulls in NO other
 * module (in particular it must NOT `require('@hms/shared')`), so it is safe to
 * load at the very top of any helper, spec, or Jest `setupFiles` entry.
 *
 * WHY this exists (grounding: doc 05 — deterministic, DB/Redis-free CI):
 *   - A stable `JWT_SECRET` guarantees the REAL `@hms/shared` jwt pipeline is
 *     self-consistent: tokens minted by `./tokens` (jwt.signAccessToken) are
 *     verifiable by the REAL `rbac.authenticate` (jwt.verifyAccessToken) because
 *     both read the same `getConfig().jwt.secret`.
 *   - `NODE_ENV=test` keeps the shared config in its non-production branch (it
 *     does not enforce production secret validation) and lets libraries quiet
 *     down.
 *   - Pinning the service port / log level keeps runs reproducible and silent.
 *
 * IMPORTANT ordering note: `@hms/shared` reads configuration LAZILY and MEMOIZES
 * it on the first `getConfig()` call. Requiring THIS module before anything
 * triggers that first read (e.g. before `./tokens` signs its first token) makes
 * the pinned secret authoritative. Even if some other module already memoized
 * config first, correctness still holds — sign and verify both use whatever the
 * single memoized secret is (the round-trip is internally consistent); the
 * pinned value only guarantees determinism. If a spec must change a secret AFTER
 * memoization, it should call `require('@hms/shared').config.resetConfig()`
 * itself (kept out of here to preserve the "no @hms/shared require" rule).
 */

/**
 * Assign `process.env[key] = value` only when the variable is currently unset
 * or empty, so externally-provided values always win.
 * @param {string} key
 * @param {string} value
 * @returns {string} the effective value now on `process.env`
 */
function setDefault(key, value) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
  return process.env[key];
}

// --- Runtime mode --------------------------------------------------------------
// Jest already sets NODE_ENV=test by default; enforce it defensively for any
// non-Jest runner and for shared config's environment-sensitive branches.
setDefault('NODE_ENV', 'test');

// --- Auth secrets (stable across the whole suite) ------------------------------
// Shared jwt signs with getConfig().jwt.secret (prod default 'change_me') and
// verifies with the SAME secret + issuer 'hms'. Pinning explicit test values
// keeps sign/verify consistent and deterministic.
setDefault('JWT_SECRET', 'test-jwt-secret');
setDefault('JWT_REFRESH_SECRET', 'test-jwt-refresh-secret');

// --- Reports-service deterministic knobs ---------------------------------------
setDefault('REPORTS_SERVICE_PORT', '4009'); // service's canonical port (config.port)
setDefault('PORT', '4009');

// --- Quiet, deterministic logging ---------------------------------------------
// pino treats 'silent' as "disable all logging"; keeps test output clean and
// avoids incidental serialization work in hot paths during tests.
setDefault('LOG_LEVEL', 'silent');

/**
 * A read-back snapshot of the values this module ensures. Handy for assertions
 * or for a spec that wants the effective secret without touching process.env
 * directly. Read AFTER the setDefault calls above so it reflects the effective
 * (possibly externally-overridden) values.
 */
const env = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  REPORTS_SERVICE_PORT: process.env.REPORTS_SERVICE_PORT,
  PORT: process.env.PORT,
  LOG_LEVEL: process.env.LOG_LEVEL,
};

module.exports = { setDefault, env };
