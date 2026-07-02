/**
 * @module @hms/shared/logger
 *
 * Centralized, structured (JSON) logging for the Hospital Management System
 * backend. Every shared module and, transitively, every backend microservice
 * logs through this module so that log format, log level, secret redaction and
 * timestamp shape are identical across the whole platform.
 *
 * The module exposes four things:
 *
 *  - {@link getLogger}    A memoized singleton {@link https://getpino.io pino}
 *                         instance. This is the low-level logger used by
 *                         everything else here.
 *  - {@link logger}       An ergonomic lazy proxy that forwards `logger.info`,
 *                         `logger.warn`, `logger.error`, `logger.debug`, …
 *                         to the singleton returned by {@link getLogger}.
 *  - {@link requestLogger} A factory that returns a `pino-http` Express
 *                         middleware bound to the singleton logger.
 *  - {@link auditLog}     A stateless helper that emits a structured audit
 *                         record for authentication / security events
 *                         (required by the Functional Requirements
 *                         Specification: "Session timeout and audit logging").
 *
 * Design contract (MUST be preserved by all edits):
 *
 * 1. Side-effect-free & lazy at import time. The base pino logger is NOT built
 *    when this module is required — it is created on the first call to
 *    {@link getLogger}. Building it eagerly would materialize configuration
 *    (via `./config`) before a consuming service has had a chance to load its
 *    environment (e.g. `require("dotenv").config()`), which would freeze the
 *    log level and bindings against an empty environment. See `./config` for
 *    the same lazy-config contract.
 *
 * 2. Memoized. The pino instance is created exactly once and cached; every
 *    subsequent {@link getLogger} call returns the identical reference so that
 *    `getLogger() === getLogger()`.
 *
 * 3. Secret-safe. A `redact` ruleset strips authentication headers, cookies,
 *    passwords, tokens and the platform's cryptographic secrets from every log
 *    line. Callers must still avoid logging raw request bodies that may carry
 *    patient PII — redaction only covers the enumerated paths below.
 *
 * 4. Transport-neutral JSON. Output is standard newline-delimited JSON on
 *    stdout. Pretty-printing (`pino-pretty`) is deliberately NOT a dependency
 *    of `@hms/shared`, so it is never required here; log shippers / container
 *    runtimes are expected to consume the JSON directly.
 *
 * External dependencies: `pino`, `pino-http` (both declared in package.json)
 * and the Node.js built-in `node:crypto`. The only internal dependency is
 * `./config`.
 */

"use strict";

const pino = require("pino");
const pinoHttp = require("pino-http");
const { randomUUID } = require("node:crypto");

/**
 * Fields that must never appear in plaintext in any log line.
 *
 * These are `pino` redaction paths (dotted, with `*` matching a single object
 * level). They cover:
 *
 *  - `req.headers.authorization` / `req.headers.cookie` — bearer tokens and
 *    session cookies attached by the HTTP request logger.
 *  - `password` / `*.password` — a top-level `password` field and any password
 *    nested one level deep (e.g. `{ user: { password } }`).
 *  - `token` / `*.token` — access/refresh tokens logged directly or nested.
 *  - `DATA_ENCRYPTION_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET` — the platform
 *    cryptographic secrets, in case a config/env object is ever logged.
 *
 * @type {ReadonlyArray<string>}
 */
const REDACT_PATHS = Object.freeze([
  "req.headers.authorization",
  "req.headers.cookie",
  "password",
  "*.password",
  "token",
  "*.token",
  "DATA_ENCRYPTION_KEY",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
]);

/**
 * Replacement string substituted for every redacted value.
 * @type {string}
 */
const REDACT_CENSOR = "[REDACTED]";

/**
 * Audit outcomes that should be logged at `warn` rather than `info`. A denied
 * or failed security action is operationally more interesting than a success.
 * @type {ReadonlyArray<string>}
 */
const AUDIT_WARN_OUTCOMES = Object.freeze(["failure", "denied"]);

/**
 * Module-scoped memoization cache for the singleton pino instance.
 * `null` means "not yet materialized".
 *
 * @type {(import("pino").Logger|null)}
 */
let cachedLogger = null;

/**
 * Build the base child bindings applied to every log line.
 *
 * Per the shared logging contract the default binding set is empty (no `pid` /
 * `hostname` noise). If a `SERVICE_NAME` environment variable is present it is
 * added as `service` so that logs aggregated across microservices can be
 * attributed to their origin. Reading `process.env` here (rather than at import
 * time) keeps the module lazy.
 *
 * @returns {{ service?: string }} The base bindings object.
 */
function buildBaseBindings() {
  const base = {};
  const serviceName = process.env.SERVICE_NAME;
  if (typeof serviceName === "string" && serviceName.trim() !== "") {
    base.service = serviceName.trim();
  }
  return base;
}

/**
 * Return the shared singleton pino logger, creating it on first use.
 *
 * The logger is configured from `./config`:
 *  - `level` follows `config.logLevel` (which honors the `LOG_LEVEL`
 *    environment variable and defaults to `"info"`).
 *  - ISO-8601 timestamps via `pino.stdTimeFunctions.isoTime`.
 *  - The {@link REDACT_PATHS} redaction ruleset with a `[REDACTED]` censor.
 *  - Base bindings from {@link buildBaseBindings}.
 *
 * `./config` is required lazily inside this function (not at module top level)
 * so that the environment is read only when the logger is actually needed —
 * after the consuming service has loaded its `.env`.
 *
 * @returns {import("pino").Logger} The memoized singleton logger.
 */
function getLogger() {
  if (cachedLogger !== null) {
    return cachedLogger;
  }

  // Lazy require + lazy read: materialize configuration only on first use.
  const config = require("./config").getConfig();

  cachedLogger = pino({
    level: config.logLevel || "info",
    base: buildBaseBindings(),
    // Emit human/machine-friendly ISO-8601 timestamps instead of epoch millis.
    timestamp: pino.stdTimeFunctions.isoTime,
    // Strip secrets/credentials from every record. `censor` replaces the value
    // in place so the key is preserved (aiding debugging) without leaking data.
    redact: {
      paths: [...REDACT_PATHS],
      censor: REDACT_CENSOR,
    },
  });

  return cachedLogger;
}

/**
 * Ergonomic, lazy logger facade.
 *
 * This Proxy lets callers write the familiar `logger.info(...)`,
 * `logger.warn(...)`, `logger.error(...)`, `logger.debug(...)`,
 * `logger.child(...)` — etc. — while still deferring construction of the
 * underlying pino instance until the first property access. Every property
 * read is forwarded to the singleton from {@link getLogger}; functions are
 * bound to that instance so `this` is correct when they are invoked after
 * destructuring (e.g. `const { info } = logger`).
 *
 * @type {import("pino").Logger}
 */
const logger = new Proxy(
  {},
  {
    /**
     * Forward property access to the memoized pino instance.
     * @param {object} _target Unused proxy target.
     * @param {(string|symbol)} prop Property being accessed.
     * @returns {*} The (bound) member from the underlying logger.
     */
    get(_target, prop) {
      const instance = getLogger();
      const value = instance[prop];
      return typeof value === "function" ? value.bind(instance) : value;
    },
    /**
     * Reflect membership checks (`"info" in logger`) onto the real logger.
     * @param {object} _target Unused proxy target.
     * @param {(string|symbol)} prop Property being probed.
     * @returns {boolean} Whether the underlying logger exposes `prop`.
     */
    has(_target, prop) {
      return prop in getLogger();
    },
  },
);

/**
 * Default request-id generator for {@link requestLogger}.
 *
 * Reuses an inbound correlation id when one is present so a request can be
 * traced end-to-end across microservices, otherwise mints a fresh UUID. The
 * resolved id is echoed back on the response `X-Request-Id` header (best
 * effort) to aid client-side and cross-service tracing.
 *
 * Fully defensive: it tolerates minimal / mocked `req` and `res` objects and
 * never throws (missing `headers`, missing `setHeader`, already-sent headers
 * are all handled gracefully).
 *
 * @param {import("http").IncomingMessage} req The incoming request.
 * @param {import("http").ServerResponse} res The outgoing response.
 * @returns {string} The resolved request id.
 */
function defaultGenReqId(req, res) {
  const headers = (req && req.headers) || {};
  const inbound =
    (req && req.id) ||
    headers["x-request-id"] ||
    headers["x-correlation-id"] ||
    null;
  const id = inbound || randomUUID();

  if (res && typeof res.setHeader === "function" && !res.headersSent) {
    try {
      res.setHeader("X-Request-Id", id);
    } catch (_err) {
      // Response headers may already be locked/flushed on unusual code paths;
      // tracing headers are best-effort, so a failure here is non-fatal.
    }
  }

  return id;
}

/**
 * Default log-level selector for {@link requestLogger}.
 *
 * Maps completed HTTP requests to a severity: server errors (5xx) or any
 * thrown error → `error`; client errors (4xx) → `warn`; everything else
 * (2xx / 3xx) → `info`.
 *
 * @param {import("http").IncomingMessage} _req The request (unused).
 * @param {import("http").ServerResponse} res The response.
 * @param {(Error|undefined)} err Error raised while handling the request.
 * @returns {("info"|"warn"|"error")} The pino level name to log at.
 */
function defaultCustomLogLevel(_req, res, err) {
  const status = (res && res.statusCode) || 0;
  if (err || status >= 500) {
    return "error";
  }
  if (status >= 400) {
    return "warn";
  }
  return "info";
}

/**
 * Create a `pino-http` Express/Connect middleware bound to the shared logger.
 *
 * This is a FACTORY: call it once at service bootstrap and mount the returned
 * middleware (`app.use(requestLogger())`). The middleware attaches a `req.log`
 * child logger, generates/propagates a request id and emits one structured
 * "request completed" line per request at a severity derived from the response
 * status (see {@link defaultCustomLogLevel}).
 *
 * Sensible defaults are provided and every one of them can be overridden by
 * passing standard `pino-http` options; caller-supplied options win (shallow
 * merge). For example, a caller may pass a custom `genReqId`, `autoLogging`,
 * `serializers`, or even its own `logger`.
 *
 * Authorization / cookie headers are already stripped by the base logger's
 * redaction ruleset (see {@link REDACT_PATHS}), so request logs never leak
 * credentials.
 *
 * @param {import("pino-http").Options} [options={}] Extra `pino-http` options
 *        merged over the defaults.
 * @returns {import("pino-http").HttpLogger} An Express middleware of the form
 *          `(req, res, next)`.
 */
function requestLogger(options = {}) {
  return pinoHttp({
    logger: getLogger(),
    genReqId: defaultGenReqId,
    customLogLevel: defaultCustomLogLevel,
    ...(options || {}),
  });
}

/**
 * @typedef {("success"|"failure"|"denied")} AuditOutcome
 */

/**
 * @typedef {Object} AuditEvent
 * @property {string} [action]    The security action, e.g. `"LOGIN"`,
 *                                `"LOGOUT"`, `"SESSION_TIMEOUT"`,
 *                                `"MFA_CHALLENGE"`, `"ACCESS_DENIED"`.
 * @property {string} [actor]     Identifier of the acting principal (user id).
 * @property {string} [role]      Role of the actor at the time of the event.
 * @property {string} [resource]  The resource acted upon (route / entity id).
 * @property {AuditOutcome} [outcome] Result of the action.
 * @property {string} [ip]        Source IP address.
 * @property {string} [userAgent] Client user-agent string.
 * @property {string} [requestId] Correlating request id (see the request
 *                                logger's `X-Request-Id`).
 * @property {object} [details]   Extra non-sensitive structured context.
 */

/**
 * Emit a structured audit-log record for an authentication / security event.
 *
 * Required by the Functional Requirements Specification
 * ("Authentication & Authorization → Session timeout and audit logging"). The
 * record is a single JSON log line tagged with `audit: true` so that log
 * pipelines can route/retain audit events distinctly. `failure` and `denied`
 * outcomes are logged at `warn`; all others at `info`.
 *
 * IMPORTANT — coordination boundary: this helper ONLY emits a structured log
 * line. It deliberately does NOT read from or write to the relational
 * `audit_log` table. That table and any durable audit persistence are owned by
 * the database layer (`../database/`) and are a per-service concern, so the
 * shared library stays schema-agnostic and free of any DB coupling. Services
 * that require durable audit trails persist them separately, in addition to
 * (not instead of) calling this helper.
 *
 * The function is stateless and defensive: it accepts a partial event, tolerates
 * a missing/`null` argument, and never throws.
 *
 * @param {AuditEvent} [event] The audit event to record.
 * @returns {void}
 */
function auditLog(event) {
  // Tolerate `undefined`/`null`/non-object callers without throwing. (A default
  // parameter only guards `undefined`, so `null` is normalized explicitly.)
  const e = event && typeof event === "object" ? event : {};
  const {
    action,
    actor,
    role,
    resource,
    outcome,
    ip,
    userAgent,
    requestId,
    details,
  } = e;

  const level = AUDIT_WARN_OUTCOMES.includes(outcome) ? "warn" : "info";

  getLogger()[level](
    {
      audit: true,
      action,
      actor,
      role,
      resource,
      outcome,
      ip,
      userAgent,
      requestId,
      details,
      timestamp: new Date().toISOString(),
    },
    "audit",
  );
}

module.exports = {
  getLogger,
  logger,
  requestLogger,
  auditLog,
};
