'use strict';

/**
 * @module laboratory-service/config
 *
 * Service-local configuration for the Laboratory Management microservice
 * (`@hms/laboratory-service`).
 *
 * This is intentionally a TINY, dependency-free leaf module. It is the first
 * file loaded from `src/` and is imported by `app.js` and `index.js` for the
 * service name and listen port. Keeping it free of any `require()` calls
 * (including `@hms/shared`) guarantees it can be imported from anywhere in the
 * service without risking circular dependencies.
 *
 * Cross-cutting configuration — database, Redis, JWT, session, and encryption
 * settings — is owned by `@hms/shared` `getConfig()` and MUST NOT be
 * duplicated here. Only values that are specific to this service live in this
 * file.
 *
 * The module is side-effect-free apart from reading a single environment
 * variable (`LABORATORY_SERVICE_PORT`) during evaluation. It performs no
 * logging, reads no secrets, and does not load `dotenv` — the process
 * environment is expected to be populated by Docker/Compose `env_file` before
 * this module is required.
 */

/**
 * Base path at which the lab-reports router is mounted by `app.js` (via the
 * `@hms/shared` `createApp` route configuration). Exported as the single
 * source of truth so that `app.js` and `labReport.routes.js` cannot drift.
 *
 * @type {string}
 */
const LAB_REPORTS_BASE_PATH = '/lab-reports';

module.exports = {
  /**
   * Canonical service identifier. Matches the backend service catalog in
   * `backend/README.md` and the `serviceName` passed to the `@hms/shared`
   * `createApp`/`startServer` helpers by `app.js`/`index.js`.
   *
   * @type {string}
   */
  serviceName: 'laboratory-service',

  /**
   * TCP port the service listens on.
   *
   * Resolved from the `LABORATORY_SERVICE_PORT` environment variable (declared
   * in the repo-root `.env.example`). The `Number(...) || 4007` pattern coerces
   * the raw string env value to a number and falls back to the default `4007` —
   * which matches the Dockerfile `EXPOSE 4007` and the backend service catalog —
   * whenever the variable is unset, empty, or non-numeric.
   *
   * @type {number}
   */
  port: Number(process.env.LABORATORY_SERVICE_PORT) || 4007,

  LAB_REPORTS_BASE_PATH,
};
