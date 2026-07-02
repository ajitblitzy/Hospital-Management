'use strict';

/**
 * @file backend/api-gateway/src/services.js
 * @module services
 *
 * Service registry / reverse-proxy ROUTE TABLE for the HMS API Gateway.
 *
 * This module is the single source of truth for the gateway's downstream
 * routing. It declares the nine (9) route configs — one per HMS microservice —
 * and resolves each route's target URL from the environment **lazily** (at
 * app-build time, NOT frozen at import).
 *
 * Design contract (must remain true):
 *   - CommonJS only (`require` / `module.exports`). This package is NOT
 *     `type: module`.
 *   - Require-safe: importing this file MUST NOT read per-service environment
 *     variables eagerly into frozen targets. Target URLs are (re)computed on
 *     every {@link getServices} / {@link buildTarget} call by reading the live
 *     `process.env`. This laziness is required for integration testability:
 *     tests set e.g. `PATIENT_SERVICE_URL=http://127.0.0.1:<ephemeralPort>`
 *     (or `<SERVICE>_SERVICE_HOST` / `<SERVICE>_SERVICE_PORT`) and then build
 *     the app, expecting requests to route to the ephemeral fake downstream.
 *     The ONLY thing computed at import time is the static
 *     {@link SERVICE_DEFINITIONS} array (structural metadata only).
 *   - Pure data / registry module: NO Express, NO body parsing, and NO proxy
 *     logic lives here. `routes.js` consumes {@link getServices} to mount each
 *     route; the proxy layer appends the request path via `req.originalUrl`.
 *   - The env var names, ports, prefixes, and compose service names below are
 *     intentionally explicit so they line up with the root `.env.example`,
 *     root `docker-compose.yml`, and README.
 *
 * Consumed by:
 *   - `routes.js` — calls {@link getServices} and mounts each route config.
 *   - Unit / integration tests — assert target building for a given env.
 */

/**
 * Static route definitions — structural metadata ONLY.
 *
 * There are intentionally NO reads of `process.env` at module scope: only the
 * structural shape (prefixes, compose service names, port-env names, default
 * ports, public flag, roles) is captured here. Live target URLs are derived
 * later by {@link buildTarget}.
 *
 * Ordering is significant and MUST be preserved — `routes.js` mounts routes in
 * this order, and more specific prefixes (none currently overlap) would need to
 * precede less specific ones.
 *
 * Field reference (per entry):
 *   - `key`         Stable identifier for the route (used by logging/metrics).
 *   - `prefix`      Public gateway path prefix (all under `/api`). The full
 *                   request path is forwarded unchanged by default.
 *   - `serviceName` Docker Compose service name; also the default upstream host
 *                   (Compose DNS resolves the service name on the shared
 *                   network) and the base for deriving `<SERVICE>_SERVICE_*`
 *                   env var names.
 *   - `portEnv`     Name of the environment variable that overrides the port.
 *                   Equals `<SERVICE>_SERVICE_PORT`; kept explicit for clarity
 *                   and to match `.env.example`.
 *   - `defaultPort` Port used when `portEnv` is not set in the environment.
 *   - `public`      When `true`, the route is reachable without a token (only
 *                   `auth` is public so login/refresh work pre-authentication).
 *                   All other routes are protected.
 *   - `roles`       Coarse-grained gateway RBAC allow-list. Intentionally EMPTY
 *                   for every route this milestone — the gateway performs
 *                   defense-in-depth only, while downstream services enforce
 *                   fine-grained authorization. The field is kept present so
 *                   `middleware/guards.js` can tighten access later without a
 *                   schema change. Role strings, when added, MUST be values
 *                   from `@hms/shared` `ROLES` (the 8 roles). `ROLES` is NOT
 *                   imported here to keep this module dependency-free; role
 *                   validation belongs in `middleware/guards.js`.
 *
 * Each entry (and the enclosing array) is deep-frozen so the registry cannot be
 * mutated at runtime.
 *
 * @constant
 * @type {ReadonlyArray<Readonly<{
 *   key: string,
 *   prefix: string,
 *   serviceName: string,
 *   portEnv: string,
 *   defaultPort: number,
 *   public: boolean,
 *   roles: ReadonlyArray<string>
 * }>>}
 */
const SERVICE_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'auth',         prefix: '/api/auth',         serviceName: 'auth-service',        portEnv: 'AUTH_SERVICE_PORT',        defaultPort: 4001, public: true,  roles: Object.freeze([]) }),
  Object.freeze({ key: 'patients',     prefix: '/api/patients',     serviceName: 'patient-service',     portEnv: 'PATIENT_SERVICE_PORT',     defaultPort: 4002, public: false, roles: Object.freeze([]) }),
  Object.freeze({ key: 'appointments', prefix: '/api/appointments', serviceName: 'appointment-service', portEnv: 'APPOINTMENT_SERVICE_PORT', defaultPort: 4003, public: false, roles: Object.freeze([]) }),
  Object.freeze({ key: 'emr',          prefix: '/api/emr',          serviceName: 'emr-service',         portEnv: 'EMR_SERVICE_PORT',         defaultPort: 4004, public: false, roles: Object.freeze([]) }),
  Object.freeze({ key: 'billing',      prefix: '/api/billing',      serviceName: 'billing-service',     portEnv: 'BILLING_SERVICE_PORT',     defaultPort: 4005, public: false, roles: Object.freeze([]) }),
  Object.freeze({ key: 'pharmacy',     prefix: '/api/pharmacy',     serviceName: 'pharmacy-service',    portEnv: 'PHARMACY_SERVICE_PORT',    defaultPort: 4006, public: false, roles: Object.freeze([]) }),
  Object.freeze({ key: 'laboratory',   prefix: '/api/laboratory',   serviceName: 'laboratory-service',  portEnv: 'LABORATORY_SERVICE_PORT',  defaultPort: 4007, public: false, roles: Object.freeze([]) }),
  Object.freeze({ key: 'inventory',    prefix: '/api/inventory',    serviceName: 'inventory-service',   portEnv: 'INVENTORY_SERVICE_PORT',   defaultPort: 4008, public: false, roles: Object.freeze([]) }),
  Object.freeze({ key: 'reports',      prefix: '/api/reports',      serviceName: 'reports-service',     portEnv: 'REPORTS_SERVICE_PORT',     defaultPort: 4009, public: false, roles: Object.freeze([]) }),
]);

/**
 * Derive a `<SERVICE>_SERVICE_<SUFFIX>` environment variable name from a
 * compose service name.
 *
 * The service name is upper-cased and its dashes converted to underscores, then
 * the suffix is appended with a separating underscore.
 *
 * @example
 * envVarName('auth-service', 'URL');    // => 'AUTH_SERVICE_URL'
 * envVarName('patient-service', 'HOST') // => 'PATIENT_SERVICE_HOST'
 * envVarName('patient-service', 'PORT') // => 'PATIENT_SERVICE_PORT'
 *
 * @param {string} serviceName Compose service name, e.g. `'patient-service'`.
 * @param {string} suffix      Variable suffix, e.g. `'URL'`, `'HOST'`, `'PORT'`.
 * @returns {string} The derived environment variable name.
 */
function envVarName(serviceName, suffix) {
  return serviceName.toUpperCase().replace(/-/g, '_') + '_' + suffix;
}

/**
 * Resolve the downstream base URL for a single route definition.
 *
 * Reads the LIVE `process.env` on every call (never cached) so that changing an
 * environment variable is reflected on the next {@link getServices} /
 * {@link buildTarget} invocation without re-`require`-ing this module.
 *
 * Resolution precedence:
 *   1. `<SERVICE>_SERVICE_URL` — a full URL override (for non-compose
 *      deployments, or to point at an ephemeral test server). Leading/trailing
 *      whitespace is trimmed and any trailing slash(es) are stripped so the
 *      result concatenates cleanly with the proxied path (which begins with
 *      `/`). When present and non-empty, host/port are ignored.
 *   2. Otherwise `http://<host>:<port>` where:
 *        - host = `<SERVICE>_SERVICE_HOST` if set, else the compose
 *          `serviceName` (Docker Compose DNS resolves the service name).
 *        - port = `process.env[portEnv]` if set, else `defaultPort`.
 *      The result carries NO trailing slash and NO path — the request path is
 *      appended later by the proxy via `req.originalUrl`.
 *
 * @param {{ serviceName: string, portEnv: string, defaultPort: (number|string) }} def
 *   A route definition (typically an element of {@link SERVICE_DEFINITIONS}).
 * @returns {string} The resolved base URL, e.g. `'http://patient-service:4002'`.
 */
function buildTarget(def) {
  const urlOverride = process.env[envVarName(def.serviceName, 'URL')];
  if (urlOverride && urlOverride.trim()) {
    return urlOverride.trim().replace(/\/+$/, '');
  }
  const host = process.env[envVarName(def.serviceName, 'HOST')] || def.serviceName;
  const port = process.env[def.portEnv] || def.defaultPort;
  return `http://${host}:${port}`;
}

/**
 * Build the live list of route configs for the gateway to mount.
 *
 * Call this at app-build time. Each returned config is a fresh plain object with
 * a freshly-resolved `target` (see {@link buildTarget}), so successive calls
 * observe the current environment — this is what makes routing testable against
 * ephemeral downstreams. The `roles` array is copied (not shared) so callers may
 * safely inspect/adapt it without mutating {@link SERVICE_DEFINITIONS}.
 *
 * @returns {Array<{
 *   key: string,
 *   prefix: string,
 *   serviceName: string,
 *   target: string,
 *   public: boolean,
 *   roles: string[]
 * }>} One config per microservice, in {@link SERVICE_DEFINITIONS} order.
 */
function getServices() {
  return SERVICE_DEFINITIONS.map((def) => ({
    key: def.key,
    prefix: def.prefix,
    serviceName: def.serviceName,
    target: buildTarget(def),
    public: def.public,
    roles: Array.isArray(def.roles) ? def.roles.slice() : [],
  }));
}

module.exports = { SERVICE_DEFINITIONS, envVarName, buildTarget, getServices };
