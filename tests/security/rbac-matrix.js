'use strict';

/**
 * @file tests/security/rbac-matrix.js
 * @module tests/security/rbac-matrix
 *
 * SINGLE SOURCE OF TRUTH for the least-privilege Role-Based Access Control
 * (RBAC) access matrix that the HMS security test suite asserts against a
 * running deployment. The RBAC probes (`rbac.checks.js`) consume the {@link
 * ROUTES} table below to decide, for every (role, route) pair, whether the
 * caller MUST be granted or denied access, and how to interpret the observed
 * HTTP status code.
 *
 * WHY THIS MODULE IS PURE DATA
 * ----------------------------------------------------------------------------
 * Keeping the matrix in a dependency-free, side-effect-free module means the
 * expected-access truth table can be reviewed, diffed, and unit-tested in
 * isolation from any network, environment, or service wiring. The security
 * checks import it; nothing here imports anything.
 *
 * GROUNDING (derived during discovery — see the HMS documentation package)
 * ----------------------------------------------------------------------------
 *   - 8 user roles — `01_Hospital_Management_Product_Vision_and_Scope`.
 *   - Role-based access control + MFA for privileged users —
 *     `02_Hospital_Management_Functional_Requirements_Specification`.
 *   - Microservices "API gateway protection" + "Role-based authorization" —
 *     `03_Hospital_Management_Technical_Architecture`.
 * The concrete allowed-role sets were derived from the backend RBAC seed model
 * (49 permissions / role_permissions) and the API-gateway route table
 * (`backend/api-gateway/src/services.js`). The 8 role keys, their ordering,
 * their human labels, and the privileged (MFA) set are aligned 1:1 with the
 * seeded credentials fixture (`tests/fixtures/credentials.js` `roles` export).
 *
 * KEY ARCHITECTURE FACTS ENCODED HERE
 * ----------------------------------------------------------------------------
 *   - 8 role keys, ordered — see {@link ROLE_KEYS}.
 *   - Privileged roles are MFA-required — see {@link PRIVILEGED_ROLE_KEYS}
 *     (`admin`, `doctor`; `mfa_enabled = true` in the seed model).
 *   - The Hospital Administrator (`admin`) holds ALL 49 permissions, so admin
 *     is allowed on EVERY protected route and is never denied.
 *   - The API gateway performs only COARSE RBAC: any authenticated caller with
 *     a valid token passes the gateway. FINE-GRAINED authorization happens at
 *     the SERVICE level, which returns 403 for a wrong-role caller. Black-box
 *     probing therefore interprets status codes as:
 *       * 401 -> unauthenticated / invalid or missing token.
 *       * 403 -> authenticated but forbidden (fine-grained denial).
 *       * 503 -> downstream service unavailable => INCONCLUSIVE (not a pass or
 *                a fail; the probe cannot judge authorization).
 *   - Every service and the gateway expose `GET /health` and
 *     `GET /health/ready` (unauthenticated liveness/readiness probes; not part
 *     of the RBAC matrix).
 *
 * PURITY CONTRACT (must remain true)
 * ----------------------------------------------------------------------------
 *   - CommonJS only (`module.exports`); this file is NOT an ES module.
 *   - NO `require(...)` / `import`, NO I/O, NO network, NO `process.env` reads,
 *     NO logging, NO side effects at import time.
 *   - Only pure data and referentially-transparent helper functions.
 *   - Every exported data structure is deep-frozen so a consumer cannot mutate
 *     the shared matrix at runtime (defense against accidental cross-test
 *     contamination).
 *
 * @typedef {'PUBLIC'|'PROTECTED'|'AUTH_ONLY'|'AMBIGUOUS'} RouteKind
 *
 * @typedef {Object} RouteProbe
 * @property {string} method  HTTP method for the read probe, e.g. `'GET'`.
 * @property {string} path    Path (relative to the API base) to probe.
 *
 * @typedef {Object} Route
 * @property {string} key                 Stable route identifier (matches the
 *                                         gateway route key).
 * @property {string} mountPath           Path under the API base, e.g.
 *                                         `'/patients'` => `GET {apiBase}/patients`.
 * @property {RouteProbe} probe           Read probe used by `rbac.checks.js`.
 * @property {string|null} resource       Backing permission string for
 *                                         documentation, e.g. `'patients:read'`
 *                                         (`null` when not permission-backed).
 * @property {RouteKind} kind             How this route is validated.
 * @property {ReadonlyArray<string>} allowed  Role KEYS that MUST have access;
 *                                         every other role key MUST be denied.
 * @property {string} note                Optional caveat / assumption text.
 */

/* ============================================================================
 * Phase 1 — Roles
 * ========================================================================== */

/**
 * The eight (8) HMS role keys, in canonical order. This order is significant:
 * it matches the `roles` export of `tests/fixtures/credentials.js` and the
 * seeded demo users, and it defines the ordering returned by
 * {@link deniedRoles}.
 *
 * @constant
 * @type {ReadonlyArray<string>}
 */
const ROLE_KEYS = Object.freeze([
  'admin',
  'doctor',
  'nurse',
  'receptionist',
  'labTechnician',
  'pharmacist',
  'patient',
  'insurance',
]);

/**
 * Privileged roles: these accounts are MFA-required (`mfa_enabled = true` in
 * the backend seed model / `PRIVILEGED_ROLES`). Exposed so auth/MFA checks and
 * reporting can distinguish privileged accounts from standard ones.
 *
 * @constant
 * @type {ReadonlyArray<string>}
 */
const PRIVILEGED_ROLE_KEYS = Object.freeze(['admin', 'doctor']);

/**
 * Human-readable role labels (roleKey -> exact role name string) for reporting.
 * The strings match the seeded role names in `tests/fixtures/credentials.js`.
 *
 * @constant
 * @type {Readonly<Object<string, string>>}
 */
const ROLE_LABELS = Object.freeze({
  admin: 'Hospital Administrator',
  doctor: 'Doctor',
  nurse: 'Nurse',
  receptionist: 'Receptionist',
  labTechnician: 'Lab Technician',
  pharmacist: 'Pharmacist',
  patient: 'Patient',
  insurance: 'Insurance Coordinator',
});

/* ============================================================================
 * Phase 2 — Route kinds
 * ========================================================================== */

/**
 * Route validation kinds. Each string tells the RBAC probes how strictly a
 * route's per-role matrix may be asserted:
 *   - `PUBLIC`     No authentication required (reachable without a token).
 *   - `PROTECTED`  JWT required AND a reliable per-role authorization matrix
 *                  exists; assert both allow (not 401/403) and deny (403).
 *   - `AUTH_ONLY`  JWT required, but there is NO reliable per-role matrix;
 *                  assert only that an authenticated caller is not 401.
 *   - `AMBIGUOUS`  Documented best-effort assumption; the per-role matrix is an
 *                  assumption that should be verified manually.
 *
 * @constant
 * @type {Readonly<{PUBLIC: string, PROTECTED: string, AUTH_ONLY: string, AMBIGUOUS: string}>}
 */
const KIND = Object.freeze({
  PUBLIC: 'PUBLIC',
  PROTECTED: 'PROTECTED',
  AUTH_ONLY: 'AUTH_ONLY',
  AMBIGUOUS: 'AMBIGUOUS',
});

/* ============================================================================
 * Phase 3 — ROUTES table
 * ========================================================================== */

/**
 * Deep-freeze a single route literal, including its nested `probe` and
 * `allowed` structures, so the exported {@link ROUTES} registry is fully
 * immutable. Pure: it only touches the object handed to it and returns it.
 *
 * @param {Route} route A route literal to freeze in place.
 * @returns {Readonly<Route>} The same object, deeply frozen.
 */
function freezeRoute(route) {
  route.probe = Object.freeze(route.probe);
  route.allowed = Object.freeze(route.allowed);
  return Object.freeze(route);
}

/**
 * The gateway route table with the least-privilege access matrix. `allowed`
 * lists the role KEYS that MUST be granted access to each route; every role key
 * NOT listed MUST be denied. The nine (9) keys mirror the API-gateway route
 * table exactly: auth, patients, appointments, laboratory, pharmacy, billing,
 * reports, inventory, emr.
 *
 * @constant
 * @type {ReadonlyArray<Readonly<Route>>}
 */
const ROUTES = Object.freeze([
  freezeRoute({
    key: 'auth',
    mountPath: '/auth',
    probe: { method: 'POST', path: '/auth/login' },
    resource: null,
    kind: KIND.PUBLIC,
    // Public authentication route: every role (indeed, anonymous callers) may
    // reach login/refresh, so all role keys are "allowed" at the matrix level.
    allowed: ROLE_KEYS.slice(),
    note: 'Public authentication route (login/refresh); no token required.',
  }),
  freezeRoute({
    key: 'patients',
    mountPath: '/patients',
    probe: { method: 'GET', path: '/patients' },
    resource: 'patients:read',
    kind: KIND.PROTECTED,
    // NOT pharmacist.
    allowed: ['admin', 'doctor', 'nurse', 'receptionist', 'labTechnician', 'patient', 'insurance'],
    note: '',
  }),
  freezeRoute({
    key: 'appointments',
    mountPath: '/appointments',
    probe: { method: 'GET', path: '/appointments' },
    resource: 'appointments:read',
    kind: KIND.PROTECTED,
    // NOT pharmacist, NOT insurance.
    allowed: ['admin', 'doctor', 'nurse', 'receptionist', 'labTechnician', 'patient'],
    note: '',
  }),
  freezeRoute({
    key: 'laboratory',
    mountPath: '/laboratory',
    probe: { method: 'GET', path: '/laboratory' },
    resource: 'laboratory_reports:read',
    kind: KIND.PROTECTED,
    // NOT receptionist, NOT pharmacist, NOT insurance.
    allowed: ['admin', 'doctor', 'nurse', 'labTechnician', 'patient'],
    note: '',
  }),
  freezeRoute({
    key: 'pharmacy',
    mountPath: '/pharmacy',
    probe: { method: 'GET', path: '/pharmacy' },
    resource: 'prescriptions:read',
    kind: KIND.PROTECTED,
    // NOT receptionist, NOT labTechnician, NOT insurance.
    allowed: ['admin', 'doctor', 'nurse', 'pharmacist', 'patient'],
    note: '',
  }),
  freezeRoute({
    key: 'billing',
    mountPath: '/billing',
    probe: { method: 'GET', path: '/billing' },
    resource: 'invoices:read',
    kind: KIND.PROTECTED,
    // NOT doctor, NOT nurse, NOT labTechnician, NOT pharmacist.
    allowed: ['admin', 'receptionist', 'patient', 'insurance'],
    note: '',
  }),
  freezeRoute({
    key: 'reports',
    mountPath: '/reports',
    probe: { method: 'GET', path: '/reports' },
    resource: 'reports:read',
    kind: KIND.PROTECTED,
    // NOT nurse, NOT receptionist, NOT labTechnician, NOT patient, NOT insurance.
    allowed: ['admin', 'doctor', 'pharmacist'],
    note: '',
  }),
  freezeRoute({
    key: 'inventory',
    mountPath: '/inventory',
    probe: { method: 'GET', path: '/inventory' },
    resource: 'medicines:read',
    kind: KIND.AMBIGUOUS,
    allowed: ['admin', 'pharmacist'],
    note: 'ASSUMPTION: inventory/medicines read restricted to admin + pharmacist; matrix ambiguous in specs — verify manually.',
  }),
  freezeRoute({
    key: 'emr',
    mountPath: '/emr',
    probe: { method: 'GET', path: '/emr' },
    resource: null,
    kind: KIND.AUTH_ONLY,
    // Treated as authenticated-only: EMR spans admissions + clinical data with
    // no single clean permission resource, so no reliable per-role matrix.
    allowed: ROLE_KEYS.slice(),
    note: 'AUTH_ONLY: assert authenticated access is not 401; do not assert per-role 403 (no clean permission resource).',
  }),
]);

/* ============================================================================
 * Phase 4 — Pure helpers
 * ========================================================================== */

/**
 * Whether a role key is allowed on a route per the access matrix.
 *
 * @param {string} roleKey     One of {@link ROLE_KEYS}.
 * @param {Route} route        A route object (typically from {@link getRoute}).
 * @returns {boolean} `true` iff `route.allowed` includes `roleKey`. Returns
 *                    `false` for a missing/malformed route rather than throwing,
 *                    so callers can probe unknown routes safely.
 */
function isAllowed(roleKey, route) {
  if (!route || !Array.isArray(route.allowed)) {
    return false;
  }
  return route.allowed.includes(roleKey);
}

/**
 * The role keys that MUST be denied access to a route: every key in
 * {@link ROLE_KEYS} that is not in `route.allowed`. The result preserves
 * canonical {@link ROLE_KEYS} order.
 *
 * @param {Route} route A route object (typically from {@link getRoute}).
 * @returns {string[]} Denied role keys (a fresh array; empty when all roles are
 *                     allowed, all roles when the route is missing/malformed).
 */
function deniedRoles(route) {
  const allowed = route && Array.isArray(route.allowed) ? route.allowed : [];
  return ROLE_KEYS.filter((k) => !allowed.includes(k));
}

/**
 * Find a route by its `key`.
 *
 * @param {string} key A route key, e.g. `'billing'`.
 * @returns {Readonly<Route>|undefined} The matching route, or `undefined`.
 */
function getRoute(key) {
  return ROUTES.find((r) => r.key === key);
}

/**
 * The routes that carry an assertable per-role matrix: `PROTECTED` routes plus
 * the `AMBIGUOUS` (best-effort assumption) route. `PUBLIC` and `AUTH_ONLY`
 * routes are excluded because they have no reliable per-role deny matrix.
 *
 * @returns {Array<Readonly<Route>>} A fresh array of matching routes.
 */
function protectedRoutes() {
  return ROUTES.filter((r) => r.kind === KIND.PROTECTED || r.kind === KIND.AMBIGUOUS);
}

/* ============================================================================
 * Phase 5 — Exports
 * ========================================================================== */

module.exports = {
  ROLE_KEYS,
  PRIVILEGED_ROLE_KEYS,
  ROLE_LABELS,
  KIND,
  ROUTES,
  isAllowed,
  deniedRoles,
  getRoute,
  protectedRoutes,
};
