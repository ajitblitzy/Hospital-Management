'use strict';

/**
 * @file backend/auth-service/tests/helpers/env.js
 * @module tests/helpers/env
 *
 * Deterministic test-environment seeder for the auth-service test suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * Integration specs in this service exercise the REAL `@hms/shared` `jwt` and
 * `encryption` modules (they sign, verify, and encrypt for real rather than
 * mocking them). Those modules read their secrets from `@hms/shared`'s
 * `config.getConfig()`, which in turn reads `process.env` the first time it is
 * required. If the environment is not seeded, the shared config falls back to
 * insecure placeholder defaults (for example `'change_me'`), which makes
 * signing / encryption behaviour non-deterministic across machines and can
 * cause the shared layer to reject an unsafe configuration outright.
 *
 * This module seeds `process.env` with safe, dummy, deterministic values so the
 * real shared modules behave identically on every machine and in CI.
 *
 * ORDERING CONTRACT (IMPORTANT)
 * -----------------------------
 * `@hms/shared`'s configuration is resolved once, at first `require`, and then
 * memoised. Therefore this module MUST be required FIRST — before `@hms/shared`
 * (or anything that transitively requires it, such as the app or a route) — so
 * the seeded values are already in place when the shared config is built.
 *
 * The auth-service uses an INLINE test-runner configuration in
 * `../../package.json` that intentionally defines NO setup files. Consequently
 * the runner does NOT auto-load this module; consumers must load it EXPLICITLY,
 * for example:
 *
 *     // top of an integration spec, before requiring @hms/shared / the app
 *     require('../helpers/env');            // seeds process.env as a side effect
 *     const { jwt } = require('@hms/shared');
 *
 *   or via the helpers barrel:
 *
 *     require('../helpers');                 // re-exports and pulls in env seeding
 *
 * NON-CLOBBERING
 * --------------
 * Every assignment is non-clobbering (`process.env.X = process.env.X || value`),
 * so a value already provided by a developer shell or CI always wins. This keeps
 * the seeder safe to require multiple times and lets pipelines override any key.
 *
 * HERMETIC
 * --------
 * Requiring this file has exactly ONE effect: seeding the five variables below.
 * It performs no I/O — no filesystem, sockets, database, or Redis access — uses
 * no randomness, timers, or async work, and deliberately does NOT require
 * `@hms/shared`. It is plain CommonJS and references no test-runner globals, so
 * it can be required from any Node context, even one where the runner is not
 * installed.
 */

/**
 * Canonical, deterministic test-environment values for the auth-service suite.
 *
 * These keys mirror the `@hms/shared` configuration surface consumed by the
 * service — `jwt.secret` (JWT_SECRET), `jwt.refreshSecret` (JWT_REFRESH_SECRET),
 * `encryption.key` (DATA_ENCRYPTION_KEY), and `mfa.issuer` (MFA_ISSUER) — plus
 * `NODE_ENV`. The shared defaults for these keys are insecure placeholders such
 * as `'change_me'`; seeding the explicit dummy values below makes the REAL
 * shared `jwt` / `encryption` modules sign, verify, and encrypt
 * deterministically in tests. The object is frozen so specs can assert against
 * the canonical values (for example, comparing a decoded token's secret against
 * `TEST_ENV.JWT_SECRET`) without hardcoding string literals, and so it can never
 * be mutated at runtime.
 *
 * @constant
 * @type {Readonly<Record<string, string>>}
 */
const TEST_ENV = Object.freeze({
  NODE_ENV: 'test',
  JWT_SECRET: 'test-jwt-secret',
  JWT_REFRESH_SECRET: 'test-jwt-refresh-secret',
  DATA_ENCRYPTION_KEY: 'test-data-encryption-key',
  MFA_ISSUER: 'HMS',
});

/**
 * Seed `process.env` with the deterministic {@link TEST_ENV} values.
 *
 * The assignment is non-clobbering for every key: a value already present in
 * `process.env` (set by a developer shell or CI) is preserved and never
 * overwritten. The function is synchronous and idempotent — calling it any
 * number of times yields the same environment and only ever fills in the keys
 * that are currently unset (or falsy). No key outside {@link TEST_ENV} is
 * touched.
 *
 * @returns {NodeJS.ProcessEnv} The live `process.env` object, returned for
 *   convenience (for example, destructuring or chaining within a spec's setup).
 */
function seedTestEnv() {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    // Non-clobbering: only assign when the key is unset/falsy so that
    // developer- or CI-provided overrides always take precedence.
    process.env[key] = process.env[key] || value;
  }

  return process.env;
}

// Seed immediately on require so that a bare `require('./env')` (from the
// helpers barrel or an integration spec) puts the deterministic values in place
// before `@hms/shared` is loaded. `seedTestEnv` is still exported so consumers
// can invoke it again explicitly if needed.
seedTestEnv();

module.exports = { seedTestEnv, TEST_ENV };
