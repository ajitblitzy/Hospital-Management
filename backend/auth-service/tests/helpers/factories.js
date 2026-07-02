'use strict';

/**
 * @file backend/auth-service/tests/helpers/factories.js
 * @module tests/helpers/factories
 *
 * Ergonomic data-builder factories for the auth-service Jest suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * `./fixtures` exposes canonical, deep-frozen sample data. Frozen data is ideal
 * for shared, read-only assertions but cannot be mutated, and reusing the SAME
 * object reference across tests risks cross-test state bleed. These factories
 * close that gap: each returns a FRESH, fully MUTABLE, DETERMINISTIC object
 * built from canonical defaults and merged with caller-supplied overrides. That
 * keeps specs intention-revealing (for example `makeUser({ role: 'Nurse' })`)
 * and DRY.
 *
 * DESIGN CONTRACT
 * ---------------
 *   - Fresh & mutable: every call deep-clones its base before returning, so the
 *     result is a brand-new, non-frozen object. Mutating one result never
 *     affects another call or the frozen `./fixtures` source.
 *   - Deterministic: defaults are fixed literals / fixture-sourced constants —
 *     no `Date.now()`, no `Math.random()`, no `crypto`. Two calls with the same
 *     overrides always produce deeply-equal objects.
 *   - Fully overridable: a single `overrides` object argument replaces any
 *     top-level key (see the merge contract below).
 *   - Credential-free users: `makeUser` NEVER emits `passwordHash`, `password`,
 *     `mfaSecret`, or any secret/salt field unless the caller explicitly passes
 *     it in `overrides`. The default template lists only safe, API-shaped keys,
 *     so the safe-user invariant holds by construction.
 *   - Pure & hermetic: requiring this module performs NO database, Redis, or
 *     network access, uses no timers or randomness, and does NOT require
 *     `@hms/shared`. Its only dependency is `./fixtures`.
 *
 * MERGE CONTRACT
 * --------------
 * Merging is a single-level (shallow) `Object.assign` of `overrides` onto a deep
 * clone of the default base. Top-level keys in `overrides` replace the default
 * value wholesale; a nested object is therefore replaced in its entirety rather
 * than deep-merged. To customise a nested field, pass the complete nested object
 * (for example `makeAuditEntry({ details: { reason: 'expired' } })`).
 *
 * Plain CommonJS: no ESM, no Jest globals. Filename is `factories.js` (not
 * `*.test.js`) so the Jest runner never treats it as a spec.
 */

const fixtures = require('./fixtures');

/**
 * Deep-clone a JSON-safe value. The auth-service fixtures contain only plain
 * objects, arrays, strings, numbers, booleans, and `null`, so a
 * `JSON.parse(JSON.stringify(...))` round-trip is a correct, dependency-free
 * deep copy. It also strips frozen-ness, guaranteeing the returned value is a
 * fresh, mutable structure detached from the (deep-frozen) fixture source.
 *
 * @template T
 * @param {T} value - The JSON-safe value to clone.
 * @returns {T} A deep, mutable copy of `value`.
 */
const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * Build a fresh object by deep-cloning `base` and applying a single-level merge
 * of `overrides` on top. See the module-level MERGE CONTRACT: top-level keys in
 * `overrides` replace the corresponding default wholesale (nested objects are
 * not deep-merged).
 *
 * @param {object} base - The default template to clone.
 * @param {object} [overrides] - Top-level keys to override on the clone.
 * @returns {object} A fresh, mutable object combining `base` and `overrides`.
 */
const build = (base, overrides) => Object.assign(clone(base), overrides || {});

/*
 * ---------------------------------------------------------------------------
 * Deterministic default constants
 * ---------------------------------------------------------------------------
 * Sourced from `./fixtures` wherever cross-factory alignment matters, so the
 * default identifiers line up across builders: the default user id equals the
 * token `sub` and the session `userId`, and the default session id equals the
 * token `sid`. Every value here is a static literal — no clock, no randomness.
 */
const DEFAULT_USER_ID = fixtures.USERS.doctor.id;
const DEFAULT_SESSION_ID = fixtures.SESSIONS.doctor.id;
const DEFAULT_ROLE = fixtures.ROLES.DOCTOR;
const DEFAULT_CREATED_AT = fixtures.USERS.doctor.createdAt;
const DEFAULT_UPDATED_AT = fixtures.USERS.doctor.updatedAt;
const DEFAULT_SESSION_EXPIRES_AT = fixtures.SESSIONS.doctor.expiresAt;
const DEFAULT_PERMISSION = fixtures.PERMISSIONS[0];
const DEFAULT_IP = '127.0.0.1';
const DEFAULT_USER_AGENT = 'jest-test-agent';
// Distinct id namespace for role records: `./fixtures` models roles as plain
// display strings and carries no role-record ids of its own.
const DEFAULT_ROLE_ID = '40000000-0000-0000-0000-000000000001';
// Mirrors the request id of the canonical success audit entry in `./fixtures`.
const DEFAULT_REQUEST_ID = '30000000-0000-0000-0000-000000000001';

/**
 * Canonical, credential-free safe-user template.
 *
 * A plain, module-local object (intentionally NOT frozen); `build` deep-clones
 * it on every call so callers always receive an independent, mutable object and
 * this template is never handed out directly. Only safe, API-shaped keys are
 * listed here — there is deliberately NO `passwordHash`, `password`,
 * `mfaSecret`, or salt — so `makeUser` satisfies the safe-user invariant by
 * construction. `mfaEnabled` defaults to `false`; enable it per test via an
 * override.
 *
 * @type {{ id: string, email: string, firstName: string, lastName: string,
 *   role: string, status: string, mfaEnabled: boolean, createdAt: string,
 *   updatedAt: string }}
 */
const DEFAULT_USER = {
  id: DEFAULT_USER_ID,
  email: fixtures.USERS.doctor.email,
  firstName: fixtures.USERS.doctor.firstName,
  lastName: fixtures.USERS.doctor.lastName,
  role: DEFAULT_ROLE,
  status: 'active',
  mfaEnabled: false,
  createdAt: DEFAULT_CREATED_AT,
  updatedAt: DEFAULT_UPDATED_AT,
};

/*
 * ---------------------------------------------------------------------------
 * Factories
 * ---------------------------------------------------------------------------
 */

/**
 * Build a fresh, mutable, credential-free safe user.
 *
 * The default is an "active" Doctor with MFA disabled and no credential fields.
 * `role` defaults to `'Doctor'` (a member of `fixtures.ROLE_NAMES`). Every field
 * is overridable, and callers may add fields — including credential fields, for
 * negative-path specs — by passing them in `overrides`.
 *
 * @param {object} [overrides={}] - Top-level fields to override on the default.
 * @returns {object} A fresh safe-user object.
 */
const makeUser = (overrides = {}) => build(DEFAULT_USER, overrides);

/**
 * Build a fresh role record. `name` defaults to `'Doctor'` (a member of
 * `fixtures.ROLE_NAMES`).
 *
 * @param {object} [overrides={}] - Top-level fields to override on the default.
 * @returns {{ id: string, name: string, description: string, createdAt: string }}
 *   A fresh role record.
 */
const makeRole = (overrides = {}) =>
  build(
    {
      id: DEFAULT_ROLE_ID,
      name: DEFAULT_ROLE,
      description: 'Doctor role',
      createdAt: DEFAULT_CREATED_AT,
    },
    overrides,
  );

/**
 * Build a fresh permission record. `name` defaults to `'patients:read'`, using
 * the `resource:action` naming style shared with `fixtures.PERMISSIONS`.
 *
 * @param {object} [overrides={}] - Top-level fields to override on the default.
 * @returns {{ id: string, name: string, description: string }} A fresh
 *   permission record.
 */
const makePermission = (overrides = {}) =>
  build(
    {
      id: DEFAULT_PERMISSION.id,
      name: DEFAULT_PERMISSION.name,
      description: DEFAULT_PERMISSION.description,
    },
    overrides,
  );

/**
 * Build a fresh session record. `id` is the session id (the JWT `sid`).
 * `expiresAt` defaults to a fixed far-future ISO timestamp so validity checks
 * stay deterministic and clock-free.
 *
 * @param {object} [overrides={}] - Top-level fields to override on the default.
 * @returns {{ id: string, userId: string, role: string, createdAt: string,
 *   expiresAt: string, ip: string, userAgent: string }} A fresh session record.
 */
const makeSession = (overrides = {}) =>
  build(
    {
      id: DEFAULT_SESSION_ID,
      userId: DEFAULT_USER_ID,
      role: DEFAULT_ROLE,
      createdAt: DEFAULT_CREATED_AT,
      expiresAt: DEFAULT_SESSION_EXPIRES_AT,
      ip: DEFAULT_IP,
      userAgent: DEFAULT_USER_AGENT,
    },
    overrides,
  );

/**
 * Build a fresh JWT claims object matching the `@hms/shared` convention:
 * `sub` = user id, `role` = one of the eight canonical roles, and `sid` =
 * session id. The registered `iat` / `exp` claims are intentionally omitted —
 * the token signer adds those at sign time. This payload is also consumed by
 * `sharedMock.js` as the default `req.user` and as the return value of the
 * mocked `verifyAccessToken` / `decodeToken`.
 *
 * @param {object} [overrides={}] - Top-level claims to override on the default.
 * @returns {{ sub: string, role: string, sid: string }} A fresh token-payload
 *   object.
 */
const makeTokenPayload = (overrides = {}) =>
  build(
    {
      sub: DEFAULT_USER_ID,
      role: DEFAULT_ROLE,
      sid: DEFAULT_SESSION_ID,
    },
    overrides,
  );

/**
 * Build a fresh audit-log entry mirroring the shared `auditLog` input shape.
 * `outcome` defaults to `'success'` and `details` to an empty object. Pass a
 * complete `details` object in `overrides` to customise it (nested values are
 * replaced wholesale — see the module MERGE CONTRACT).
 *
 * @param {object} [overrides={}] - Top-level fields to override on the default.
 * @returns {{ action: string, actor: string, role: string, resource: string,
 *   outcome: string, ip: string, userAgent: string, requestId: string,
 *   details: object }} A fresh audit-log entry.
 */
const makeAuditEntry = (overrides = {}) =>
  build(
    {
      action: 'auth.login.success',
      actor: DEFAULT_USER_ID,
      role: DEFAULT_ROLE,
      resource: 'auth/session',
      outcome: 'success',
      ip: DEFAULT_IP,
      userAgent: DEFAULT_USER_AGENT,
      requestId: DEFAULT_REQUEST_ID,
      details: {},
    },
    overrides,
  );

module.exports = {
  makeUser,
  makeRole,
  makePermission,
  makeSession,
  makeTokenPayload,
  makeAuditEntry,
};
