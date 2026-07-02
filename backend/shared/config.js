/**
 * @module @hms/shared/config
 *
 * Centralized, lazy, memoized environment-configuration accessor for the
 * `@hms/shared` library. Every other shared module (db, redis, jwt, rbac,
 * encryption, queue, logger, app) — and, transitively, every backend
 * microservice that consumes them — reads its settings from here instead of
 * touching `process.env` directly. This guarantees a single, consistent
 * source of configuration and keeps environment-variable names in one place.
 *
 * Design contract (MUST be preserved by all edits):
 *
 * 1. Side-effect-free at import time. This module does NOT read `process.env`
 *    at the top level and does NOT open any connection or perform any I/O.
 *    Reading the environment happens lazily on the first call to
 *    {@link getConfig}. This lets a consuming service call
 *    `require("dotenv").config()` (or otherwise populate the environment)
 *    BEFORE the configuration object is materialized. This module deliberately
 *    does NOT import `dotenv`; loading `.env` files is the responsibility of
 *    each service's bootstrap code.
 *
 * 2. Memoized. The configuration object is computed exactly once on the first
 *    {@link getConfig} call and cached; subsequent calls return the identical
 *    cached reference. {@link resetConfig} clears the cache (used by tests).
 *
 * 3. Frozen. The returned object is deep-frozen so consumers cannot mutate
 *    shared configuration state.
 *
 * 4. Secret-safe. Secret values (JWT secrets, DB password, encryption key) are
 *    never logged by this module.
 *
 * Deployment note: the environment-variable NAMES here match the repository's
 * root `.env.example` verbatim. Inside the Docker Compose network the database
 * host resolves to the service name `postgres` and the cache host resolves to
 * `redis`, whereas on a developer's host machine both are `localhost`. Neither
 * host is hardcoded — the value always comes from `POSTGRES_HOST` / `REDIS_HOST`
 * (the operator sets `POSTGRES_HOST=postgres` and `REDIS_HOST=redis` in the
 * compose environment).
 */

"use strict";

/**
 * Placeholder value used for secrets in the committed `.env.example` template.
 * Real deployments MUST override these. {@link validateProductionConfig}
 * refuses to run in production while any secret still equals this value.
 *
 * @type {string}
 */
const PLACEHOLDER_SECRET = "change_me";

/**
 * PostgreSQL connection configuration.
 *
 * @typedef {Object} DbConfig
 * @property {string} url      Full connection string (`DATABASE_URL`).
 * @property {string} host     Server host (`POSTGRES_HOST`); `postgres` inside
 *                             compose, `localhost` on the host machine.
 * @property {number} port     Server port (`POSTGRES_PORT`).
 * @property {string} database Database name (`POSTGRES_DB`).
 * @property {string} user     Database user (`POSTGRES_USER`).
 * @property {string} password Database password (`POSTGRES_PASSWORD`).
 * @property {number} poolMax  Maximum pool size (`DATABASE_POOL_MAX`); an extra
 *                             tuning variable not present in `.env.example`.
 */

/**
 * Redis connection configuration.
 *
 * @typedef {Object} RedisConfig
 * @property {string} url                Full connection URL (`REDIS_URL`).
 * @property {string} host               Server host (`REDIS_HOST`); `redis`
 *                                       inside compose, `localhost` on the host.
 * @property {number} port               Server port (`REDIS_PORT`).
 * @property {(string|undefined)} password Password (`REDIS_PASSWORD`);
 *                                       `undefined` when unset/empty.
 */

/**
 * JSON Web Token / authentication configuration.
 *
 * @typedef {Object} JwtConfig
 * @property {string} secret           Access-token signing secret (`JWT_SECRET`).
 * @property {string} expiresIn        Access-token TTL (`JWT_EXPIRES_IN`).
 * @property {string} refreshSecret    Refresh-token signing secret
 *                                     (`JWT_REFRESH_SECRET`).
 * @property {string} refreshExpiresIn Refresh-token TTL (`JWT_REFRESH_EXPIRES_IN`).
 */

/**
 * Session configuration.
 *
 * @typedef {Object} SessionConfig
 * @property {number} timeoutMinutes Idle session timeout in minutes
 *                                   (`SESSION_TIMEOUT_MINUTES`).
 */

/**
 * Multi-factor-authentication configuration. `@hms/shared` does not implement
 * MFA itself; it merely exposes this value for services that do.
 *
 * @typedef {Object} MfaConfig
 * @property {string} issuer TOTP issuer label (`MFA_ISSUER`).
 */

/**
 * Data-at-rest encryption configuration.
 *
 * @typedef {Object} EncryptionConfig
 * @property {string} key Symmetric encryption key (`DATA_ENCRYPTION_KEY`).
 */

/**
 * The complete, immutable HMS configuration shape returned by {@link getConfig}.
 *
 * @typedef {Object} HmsConfig
 * @property {("development"|"test"|"production")} env The active environment
 *                                       (`NODE_ENV`).
 * @property {boolean} isProduction      `true` when `env === "production"`.
 * @property {boolean} isTest            `true` when `env === "test"`.
 * @property {boolean} isDevelopment     `true` when `env === "development"`.
 * @property {string} logLevel           Log level (`LOG_LEVEL`).
 * @property {DbConfig} db               PostgreSQL settings.
 * @property {RedisConfig} redis         Redis settings.
 * @property {JwtConfig} jwt             JWT / auth settings.
 * @property {SessionConfig} session     Session settings.
 * @property {MfaConfig} mfa             MFA settings.
 * @property {EncryptionConfig} encryption Data-encryption settings.
 */

/**
 * Read a string environment variable.
 *
 * Returns the trimmed-non-empty value of `process.env[name]`, otherwise the
 * provided fallback. An unset variable OR a blank/whitespace-only value both
 * resolve to the fallback, which keeps behavior predictable when an operator
 * leaves a variable defined but empty.
 *
 * @param {string} name     Environment-variable name.
 * @param {string} fallback Default value when the variable is missing/blank.
 * @returns {string} The resolved string value.
 */
function str(name, fallback) {
  const raw = process.env[name];
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw;
  }
  return fallback;
}

/**
 * Read an integer environment variable.
 *
 * Parses `process.env[name]` as an integer. A missing/blank value, or any
 * value that does not parse to a finite number, falls back to the provided
 * default. Fractional inputs are truncated toward zero.
 *
 * @param {string} name     Environment-variable name.
 * @param {number} fallback Default value when the variable is missing/invalid.
 * @returns {number} The resolved integer value.
 */
function num(name, fallback) {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
}

/**
 * Recursively freeze an object and every nested object so the returned
 * configuration is deeply immutable.
 *
 * @template T
 * @param {T} target Object to deep-freeze.
 * @returns {Readonly<T>} The same object, deeply frozen.
 */
function deepFreeze(target) {
  Object.getOwnPropertyNames(target).forEach((key) => {
    const value = target[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value);
    }
  });
  return Object.freeze(target);
}

/**
 * Materialize the configuration object from the current environment.
 *
 * This is where — and the ONLY place where — `process.env` is read for the
 * structured values (via {@link str} / {@link num} and the inline Redis
 * password read). It is invoked lazily by {@link getConfig}; it is never run
 * at import time.
 *
 * @returns {HmsConfig} A freshly built (not yet frozen) configuration object.
 */
function buildConfig() {
  const env = str("NODE_ENV", "development");

  // `REDIS_PASSWORD` defaults to an empty string in `.env.example`; an empty
  // or whitespace-only value means "no password" and is normalized to
  // `undefined` so downstream Redis clients omit AUTH entirely.
  const rawRedisPassword = process.env.REDIS_PASSWORD;
  const redisPassword =
    typeof rawRedisPassword === "string" && rawRedisPassword.trim() !== ""
      ? rawRedisPassword
      : undefined;

  return {
    env,
    isProduction: env === "production",
    isTest: env === "test",
    isDevelopment: env === "development",
    logLevel: str("LOG_LEVEL", "info"),
    db: {
      url: str(
        "DATABASE_URL",
        "postgresql://hms_user:change_me@localhost:5432/hms",
      ),
      host: str("POSTGRES_HOST", "localhost"),
      port: num("POSTGRES_PORT", 5432),
      database: str("POSTGRES_DB", "hms"),
      user: str("POSTGRES_USER", "hms_user"),
      password: str("POSTGRES_PASSWORD", PLACEHOLDER_SECRET),
      poolMax: num("DATABASE_POOL_MAX", 10),
    },
    redis: {
      url: str("REDIS_URL", "redis://localhost:6379"),
      host: str("REDIS_HOST", "localhost"),
      port: num("REDIS_PORT", 6379),
      password: redisPassword,
    },
    jwt: {
      secret: str("JWT_SECRET", PLACEHOLDER_SECRET),
      expiresIn: str("JWT_EXPIRES_IN", "15m"),
      refreshSecret: str("JWT_REFRESH_SECRET", PLACEHOLDER_SECRET),
      refreshExpiresIn: str("JWT_REFRESH_EXPIRES_IN", "7d"),
    },
    session: {
      timeoutMinutes: num("SESSION_TIMEOUT_MINUTES", 30),
    },
    mfa: {
      issuer: str("MFA_ISSUER", "HMS"),
    },
    encryption: {
      key: str("DATA_ENCRYPTION_KEY", PLACEHOLDER_SECRET),
    },
  };
}

/**
 * Module-scoped memoization cache. `null` means "not yet materialized".
 *
 * @type {(HmsConfig|null)}
 */
let cachedConfig = null;

/**
 * Return the shared HMS configuration.
 *
 * On the first call the configuration is read from `process.env`, deep-frozen,
 * and cached. Every subsequent call returns the identical cached, frozen
 * object. Call {@link resetConfig} first if the environment changed and a fresh
 * read is required (primarily in tests).
 *
 * @returns {HmsConfig} The memoized, deeply frozen configuration object.
 */
function getConfig() {
  if (cachedConfig !== null) {
    return cachedConfig;
  }
  cachedConfig = /** @type {HmsConfig} */ (deepFreeze(buildConfig()));
  return cachedConfig;
}

/**
 * Clear the memoized configuration so the next {@link getConfig} call re-reads
 * the environment. Intended for unit tests that mutate `process.env` between
 * assertions; production code has no reason to call this.
 *
 * @returns {void}
 */
function resetConfig() {
  cachedConfig = null;
}

/**
 * Optional production hardening. When `NODE_ENV === "production"`, throws a
 * clear error if any required secret still equals the `.env.example`
 * placeholder ("change_me"). Outside production it is a no-op.
 *
 * This is NOT invoked automatically at import (that would violate the
 * side-effect-free rule). Service bootstrap code (e.g. `app.js`'s
 * `startServer`) should call it explicitly to fail fast on misconfiguration.
 * The thrown error names the offending environment variables only — it never
 * includes the secret values themselves.
 *
 * @returns {HmsConfig} The validated configuration (for convenient chaining).
 * @throws {Error} If, in production, one or more secrets are still placeholders.
 */
function validateProductionConfig() {
  const config = getConfig();
  if (!config.isProduction) {
    return config;
  }

  const offenders = [];
  if (config.jwt.secret === PLACEHOLDER_SECRET) {
    offenders.push("JWT_SECRET");
  }
  if (config.jwt.refreshSecret === PLACEHOLDER_SECRET) {
    offenders.push("JWT_REFRESH_SECRET");
  }
  if (config.encryption.key === PLACEHOLDER_SECRET) {
    offenders.push("DATA_ENCRYPTION_KEY");
  }
  if (config.db.password === PLACEHOLDER_SECRET) {
    offenders.push("POSTGRES_PASSWORD");
  }

  if (offenders.length > 0) {
    throw new Error(
      "Insecure production configuration: the following secrets still use the " +
        `placeholder "${PLACEHOLDER_SECRET}" and must be overridden with real ` +
        `values before starting in production: ${offenders.join(", ")}.`,
    );
  }

  return config;
}

module.exports = {
  getConfig,
  resetConfig,
  validateProductionConfig,
};
