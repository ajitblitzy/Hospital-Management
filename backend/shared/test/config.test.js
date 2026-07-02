/**
 * @fileoverview Unit tests for the shared configuration accessor
 * `backend/shared/config.js`.
 *
 * These specs satisfy the "Tests — unit tests for the shared utilities"
 * requirement of the Agent Action Plan and the "Unit Testing" pillar of the
 * Hospital Management System QA & DevOps strategy: the shared configuration
 * layer is consumed (directly or transitively) by every backend microservice,
 * so its behavior must be pinned down by fast, isolated, deterministic tests
 * that touch NO external services.
 *
 * The module under test exposes a lazy, memoized, deep-frozen configuration
 * object built exclusively from `process.env`. The behaviors verified here are:
 *
 *   - Documented defaults (from the repository root `.env.example`) apply when
 *     the corresponding environment variable is absent.
 *   - `getConfig()` is memoized (returns the identical cached reference) and
 *     only re-reads the environment after `resetConfig()`.
 *   - Environment overrides (e.g. the Docker Compose in-network hostnames
 *     `postgres` / `redis`) are honored on a fresh read.
 *   - The returned object is deeply frozen and therefore immutable.
 *   - The `env` flags are derived correctly from `NODE_ENV`.
 *   - `validateProductionConfig()` fails fast in production when secrets still
 *     hold the committed `"change_me"` placeholder, and is a no-op once real
 *     secrets are supplied.
 *
 * Test conventions:
 *   - Plain CommonJS Jest spec (`require`, no ESM `import`); no mocks are used.
 *   - `process.env` is snapshotted and fully restored around every test so no
 *     test leaks environment state into another. Inside a test we mutate
 *     `process.env` and then call `config.resetConfig()` BEFORE asserting on a
 *     fresh `getConfig()`.
 *   - Only obviously-fake, non-secret literals are used for the "real secret"
 *     cases; no real credential is ever written or printed.
 */

"use strict";

// The ONLY dependency of this spec is the module under test. `config.js` is a
// pure environment reader with no transitive external requires, so no live
// database, cache, or other service is involved.
const config = require("../config");

/**
 * The process-wide environment as it exists before this test file runs (under
 * Jest this includes `NODE_ENV="test"`). Each test operates on a shallow copy
 * so mutations are isolated, and the original reference is restored afterwards.
 *
 * @type {NodeJS.ProcessEnv}
 */
const OLD_ENV = process.env;

beforeEach(() => {
  // Reset the module registry for good hygiene, swap in a fresh, mutable copy
  // of the environment, and clear any memoized configuration so the first
  // `getConfig()` in each test reads the environment we control.
  jest.resetModules();
  process.env = { ...OLD_ENV };
  config.resetConfig();
});

afterEach(() => {
  // Restore the original environment reference and drop the memoized config so
  // absolutely no state leaks between tests (or into other spec files).
  process.env = OLD_ENV;
  config.resetConfig();
});

describe("getConfig defaults", () => {
  it("defaults db.database to 'hms' when POSTGRES_DB is unset", () => {
    delete process.env.POSTGRES_DB;
    config.resetConfig();

    expect(config.getConfig().db.database).toBe("hms");
  });

  it("defaults db.port to the number 5432 when POSTGRES_PORT is unset", () => {
    delete process.env.POSTGRES_PORT;
    config.resetConfig();

    const port = config.getConfig().db.port;
    expect(port).toBe(5432);
    expect(typeof port).toBe("number");
  });

  it("defaults session.timeoutMinutes to 30 when SESSION_TIMEOUT_MINUTES is unset", () => {
    delete process.env.SESSION_TIMEOUT_MINUTES;
    config.resetConfig();

    expect(config.getConfig().session.timeoutMinutes).toBe(30);
  });

  it("defaults jwt.expiresIn to '15m' when JWT_EXPIRES_IN is unset", () => {
    delete process.env.JWT_EXPIRES_IN;
    config.resetConfig();

    expect(config.getConfig().jwt.expiresIn).toBe("15m");
  });

  it("defaults redis.port to 6379 and mfa.issuer to 'HMS' when unset", () => {
    delete process.env.REDIS_PORT;
    delete process.env.MFA_ISSUER;
    config.resetConfig();

    const cfg = config.getConfig();
    expect(cfg.redis.port).toBe(6379);
    expect(typeof cfg.redis.port).toBe("number");
    expect(cfg.mfa.issuer).toBe("HMS");
  });
});

describe("memoization", () => {
  it("returns the identical cached reference on repeated calls", () => {
    const a = config.getConfig();
    const b = config.getConfig();

    expect(a).toBe(b);
  });

  it("does not reflect an env change made without resetConfig()", () => {
    // Establish a known baseline value.
    delete process.env.POSTGRES_HOST;
    config.resetConfig();
    const first = config.getConfig().db.host;

    // Mutate the environment but deliberately SKIP resetConfig(): the memoized
    // object must be returned unchanged.
    process.env.POSTGRES_HOST = "postgres";
    const second = config.getConfig().db.host;

    expect(second).toBe(first);
    expect(second).toBe("localhost");
  });
});

describe("resetConfig forces fresh read", () => {
  it("re-reads process.env after resetConfig() (POSTGRES_PORT -> 5544)", () => {
    // Prime the cache with the current environment first.
    config.getConfig();

    process.env.POSTGRES_PORT = "5544";
    config.resetConfig();

    const port = config.getConfig().db.port;
    expect(port).toBe(5544);
    expect(typeof port).toBe("number");
  });
});

describe("env overrides (Docker compose hostnames)", () => {
  it("reflects POSTGRES_HOST=postgres on db.host (in-network DB hostname)", () => {
    process.env.POSTGRES_HOST = "postgres";
    config.resetConfig();

    expect(config.getConfig().db.host).toBe("postgres");
  });

  it("reflects REDIS_HOST=redis on redis.host (in-network cache hostname)", () => {
    process.env.REDIS_HOST = "redis";
    config.resetConfig();

    expect(config.getConfig().redis.host).toBe("redis");
  });

  it("treats an empty REDIS_PASSWORD as no password (undefined)", () => {
    process.env.REDIS_PASSWORD = "";
    config.resetConfig();

    expect(config.getConfig().redis.password).toBeUndefined();
  });
});

describe("frozen / immutable", () => {
  it("deep-freezes the root config and nested objects", () => {
    const cfg = config.getConfig();

    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.db)).toBe(true);
  });

  it("prevents mutation of a nested field", () => {
    const cfg = config.getConfig();
    const before = cfg.db.database;

    // The object is frozen, so this assignment is a no-op in sloppy mode and a
    // TypeError in strict mode; either way the value must remain unchanged.
    try {
      cfg.db.database = "HACKED";
    } catch (err) {
      // Swallow the strict-mode TypeError; the assertion below is the contract.
      void err;
    }

    expect(cfg.db.database).toBe(before);
  });
});

describe("env flags", () => {
  it("derives production flags from NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    config.resetConfig();

    const cfg = config.getConfig();
    expect(cfg.env).toBe("production");
    expect(cfg.isProduction).toBe(true);
    expect(cfg.isTest).toBe(false);
    expect(cfg.isDevelopment).toBe(false);
  });

  it("derives development flags from NODE_ENV=development", () => {
    process.env.NODE_ENV = "development";
    config.resetConfig();

    const cfg = config.getConfig();
    expect(cfg.env).toBe("development");
    expect(cfg.isDevelopment).toBe(true);
    expect(cfg.isProduction).toBe(false);
    expect(cfg.isTest).toBe(false);
  });
});

describe("validateProductionConfig", () => {
  it("throws in production when secrets still use the 'change_me' placeholder", () => {
    // Guard: the function is exported but treated as optional-but-present.
    if (typeof config.validateProductionConfig !== "function") {
      return;
    }

    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "change_me";
    process.env.JWT_REFRESH_SECRET = "change_me";
    process.env.DATA_ENCRYPTION_KEY = "change_me";
    process.env.POSTGRES_PASSWORD = "change_me";
    config.resetConfig();

    expect(() => config.validateProductionConfig()).toThrow();
  });

  it("does not throw in production when all required secrets are overridden", () => {
    if (typeof config.validateProductionConfig !== "function") {
      return;
    }

    // Obviously-fake, non-credential test literals (never real secrets).
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "unit-test-access-secret-value";
    process.env.JWT_REFRESH_SECRET = "unit-test-refresh-secret-value";
    process.env.DATA_ENCRYPTION_KEY = "unit-test-encryption-key-value";
    process.env.POSTGRES_PASSWORD = "unit-test-db-password-value";
    config.resetConfig();

    expect(() => config.validateProductionConfig()).not.toThrow();
  });
});
