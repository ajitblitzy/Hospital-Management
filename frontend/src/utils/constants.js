/**
 * @file frontend/src/utils/constants.js
 * @module utils/constants
 *
 * Single source of truth for the HMS React SPA's RBAC vocabulary and its
 * navigation / route / permission maps.
 *
 * This is the most foundational module in `frontend/src/`. It is pure
 * JavaScript (ESM) — it contains **no JSX, no React imports, no network
 * calls, and no secrets** — only deeply-frozen constants and maps. It is
 * consumed via relative imports by `store/`, `services/`, `hooks/`,
 * `components/`, `pages/`, and `routes/` (there are no path aliases in this
 * project). Importing this module is a pure, side-effect-free operation.
 *
 * Immutability: every exported value is deep-frozen with `Object.freeze(...)`
 * (including nested objects and arrays) so that consumers can never mutate
 * shared application vocabulary at runtime.
 *
 * @see backend/shared/rbac.js — canonical backend RBAC definitions the
 *      `ROLES` object below mirrors verbatim (see the CRITICAL note on ROLES).
 */

/* -------------------------------------------------------------------------- */
/* Phase 1 — Roles                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Canonical HMS user roles.
 *
 * 🔒 CRITICAL CROSS-WORKSPACE CONTRACT — this object MUST stay byte-for-byte
 * in sync with the backend common library `@hms/shared` (file
 * `backend/shared/rbac.js`, a *separate workspace that the browser app never
 * imports*). The backend `auth-service` places the string VALUES below into
 * the JWT `role` claim, and the database `roles` table is seeded with these
 * exact names. The frontend decodes the JWT (via `jwt-decode`) and compares
 * `decoded.role` against these VALUES in `store/authSlice` and `hooks/useRole`.
 * If the keys or values drift from the backend, ALL client-side RBAC silently
 * breaks. Keep exactly these 8 roles — no extras, no omissions, exact
 * spelling and casing (source: 01_Hospital_Management_Product_Vision_and_Scope).
 *
 * @constant
 * @type {Readonly<Record<string, string>>}
 */
export const ROLES = Object.freeze({
  HOSPITAL_ADMINISTRATOR: 'Hospital Administrator',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  RECEPTIONIST: 'Receptionist',
  LAB_TECHNICIAN: 'Lab Technician',
  PHARMACIST: 'Pharmacist',
  PATIENT: 'Patient',
  INSURANCE_COORDINATOR: 'Insurance Coordinator',
});

/**
 * The 8 role-claim strings as a frozen array (mirrors the backend
 * `ROLE_VALUES`). Handy for JWT `role` validation, role dropdowns, and tests.
 *
 * @constant
 * @type {ReadonlyArray<string>}
 */
export const ROLE_VALUES = Object.freeze(Object.values(ROLES));

/**
 * Display labels keyed by the role VALUE → human-readable text.
 *
 * Role values are already human-readable, so today this is an identity map;
 * it is centralized here so UI code never hardcodes role text and so future
 * localization or short-form labels live in exactly one place.
 *
 * @constant
 * @type {Readonly<Record<string, string>>}
 */
export const ROLE_LABELS = Object.freeze({
  [ROLES.HOSPITAL_ADMINISTRATOR]: 'Hospital Administrator',
  [ROLES.DOCTOR]: 'Doctor',
  [ROLES.NURSE]: 'Nurse',
  [ROLES.RECEPTIONIST]: 'Receptionist',
  [ROLES.LAB_TECHNICIAN]: 'Lab Technician',
  [ROLES.PHARMACIST]: 'Pharmacist',
  [ROLES.PATIENT]: 'Patient',
  [ROLES.INSURANCE_COORDINATOR]: 'Insurance Coordinator',
});

/* -------------------------------------------------------------------------- */
/* Phase 2 — Modules                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The 8 core HMS functional modules, keyed by a stable identifier →
 * exact human-readable module name (source:
 * 01_Hospital_Management_Product_Vision_and_Scope). No extras, no omissions.
 * Consumed by navigation, route-guarding, and the role→module permission map.
 *
 * @constant
 * @type {Readonly<Record<string, string>>}
 */
export const MODULES = Object.freeze({
  PATIENT_REGISTRATION: 'Patient Registration',
  APPOINTMENT_SCHEDULING: 'Appointment Scheduling',
  ELECTRONIC_MEDICAL_RECORDS: 'Electronic Medical Records',
  BILLING_INSURANCE: 'Billing & Insurance',
  PHARMACY_MANAGEMENT: 'Pharmacy Management',
  LABORATORY_MANAGEMENT: 'Laboratory Management',
  INVENTORY_MANAGEMENT: 'Inventory Management',
  REPORTS_ANALYTICS: 'Reports & Analytics',
});

/**
 * The 8 module names as a frozen array. Useful for iteration, validation, and
 * granting full module access (e.g. the Hospital Administrator).
 *
 * @constant
 * @type {ReadonlyArray<string>}
 */
export const MODULE_VALUES = Object.freeze(Object.values(MODULES));

/* -------------------------------------------------------------------------- */
/* Phase 3 — Routes                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Canonical client-side route paths for the React Router route table.
 * Consumed by `routes/AppRoutes`, `routes/RoleRoute`, and the
 * `components/layout` navigation.
 *
 * Notes:
 * - `MFA` is a public route for the multi-factor challenge shown to privileged
 *   users (source: 02_Hospital_Management_Functional_Requirements_Specification).
 * - `FORBIDDEN` ('/403') is where `RoleRoute` redirects when a user lacks the
 *   permission required for a route.
 * - `NOT_FOUND` ('*') is the React Router catch-all wildcard for unmatched
 *   paths; it must remain the last route declared in the router.
 *
 * @constant
 * @type {Readonly<Record<string, string>>}
 */
export const ROUTES = Object.freeze({
  LOGIN: '/login',
  MFA: '/mfa',
  DASHBOARD: '/dashboard',
  PATIENTS: '/patients',
  APPOINTMENTS: '/appointments',
  EMR: '/emr',
  BILLING: '/billing',
  PHARMACY: '/pharmacy',
  LABORATORY: '/laboratory',
  INVENTORY: '/inventory',
  REPORTS: '/reports',
  FORBIDDEN: '/403',
  NOT_FOUND: '*',
});

/* -------------------------------------------------------------------------- */
/* Phase 4 — Module → route map                                               */
/* -------------------------------------------------------------------------- */

/**
 * Maps each module (by its VALUE) to its primary client route. Computed keys
 * are used so the object keys are the module VALUE strings, keeping this map
 * aligned with `MODULES` / `MODULE_VALUES`. Consumed when translating a
 * permitted module into a navigable destination.
 *
 * @constant
 * @type {Readonly<Record<string, string>>}
 */
export const MODULE_ROUTE_MAP = Object.freeze({
  [MODULES.PATIENT_REGISTRATION]: ROUTES.PATIENTS,
  [MODULES.APPOINTMENT_SCHEDULING]: ROUTES.APPOINTMENTS,
  [MODULES.ELECTRONIC_MEDICAL_RECORDS]: ROUTES.EMR,
  [MODULES.BILLING_INSURANCE]: ROUTES.BILLING,
  [MODULES.PHARMACY_MANAGEMENT]: ROUTES.PHARMACY,
  [MODULES.LABORATORY_MANAGEMENT]: ROUTES.LABORATORY,
  [MODULES.INVENTORY_MANAGEMENT]: ROUTES.INVENTORY,
  [MODULES.REPORTS_ANALYTICS]: ROUTES.REPORTS,
});

/* -------------------------------------------------------------------------- */
/* Phase 5 — Role → allowed modules (defense-in-depth RBAC mirror)            */
/* -------------------------------------------------------------------------- */

/**
 * Maps each role (by its VALUE) to the frozen list of module VALUES that role
 * may access.
 *
 * ⚠️ ADVISORY / DEFENSE-IN-DEPTH ONLY. This is a CLIENT-SIDE mirror used purely
 * to improve UX — to filter the navigation Drawer and pre-empt access to
 * routes the user is not permitted to see. It is NOT a security boundary: the
 * backend API gateway and services remain the sole authoritative enforcers of
 * authorization. This map MUST be kept consistent with the backend RBAC policy
 * (roles → permissions); if they diverge, the backend wins and the user simply
 * sees a 403. Each role's list is individually `Object.freeze`d so nested
 * arrays are immutable too.
 *
 * @constant
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const ROLE_MODULE_MAP = Object.freeze({
  // Hospital Administrator: full access to all 8 modules.
  [ROLES.HOSPITAL_ADMINISTRATOR]: Object.freeze([...MODULE_VALUES]),
  [ROLES.DOCTOR]: Object.freeze([
    MODULES.PATIENT_REGISTRATION,
    MODULES.APPOINTMENT_SCHEDULING,
    MODULES.ELECTRONIC_MEDICAL_RECORDS,
    MODULES.LABORATORY_MANAGEMENT,
    MODULES.PHARMACY_MANAGEMENT,
    MODULES.REPORTS_ANALYTICS,
  ]),
  [ROLES.NURSE]: Object.freeze([
    MODULES.PATIENT_REGISTRATION,
    MODULES.APPOINTMENT_SCHEDULING,
    MODULES.ELECTRONIC_MEDICAL_RECORDS,
    MODULES.LABORATORY_MANAGEMENT,
  ]),
  [ROLES.RECEPTIONIST]: Object.freeze([
    MODULES.PATIENT_REGISTRATION,
    MODULES.APPOINTMENT_SCHEDULING,
    MODULES.BILLING_INSURANCE,
  ]),
  [ROLES.LAB_TECHNICIAN]: Object.freeze([
    MODULES.LABORATORY_MANAGEMENT,
    MODULES.ELECTRONIC_MEDICAL_RECORDS,
  ]),
  [ROLES.PHARMACIST]: Object.freeze([
    MODULES.PHARMACY_MANAGEMENT,
    MODULES.INVENTORY_MANAGEMENT,
  ]),
  [ROLES.PATIENT]: Object.freeze([
    MODULES.APPOINTMENT_SCHEDULING,
    MODULES.ELECTRONIC_MEDICAL_RECORDS,
    MODULES.BILLING_INSURANCE,
  ]),
  [ROLES.INSURANCE_COORDINATOR]: Object.freeze([
    MODULES.BILLING_INSURANCE,
    MODULES.REPORTS_ANALYTICS,
  ]),
});

/**
 * Alias of {@link ROLE_MODULE_MAP} exposed under the name the AAP also refers
 * to (`PERMISSIONS / ROLE_MODULE_MAP`). This is a *reference* to the very same
 * frozen object — not a copy — so `PERMISSIONS === ROLE_MODULE_MAP`. At this
 * stage `PERMISSIONS` is the module-access matrix (role → allowed modules); it
 * is intentionally NOT a finer-grained, action-level ACL.
 *
 * @constant
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const PERMISSIONS = ROLE_MODULE_MAP;

/* -------------------------------------------------------------------------- */
/* Phase 6 — Role → landing route                                             */
/* -------------------------------------------------------------------------- */

/**
 * Maps each role (by its VALUE) to the route the user lands on immediately
 * after a successful login. Every role currently lands on the role-aware
 * dashboard; the map is kept explicit (rather than a constant) so per-role
 * landing pages can be customized later without touching the auth/redirect
 * helper code.
 *
 * @constant
 * @type {Readonly<Record<string, string>>}
 */
export const ROLE_LANDING_MAP = Object.freeze({
  [ROLES.HOSPITAL_ADMINISTRATOR]: ROUTES.DASHBOARD,
  [ROLES.DOCTOR]: ROUTES.DASHBOARD,
  [ROLES.NURSE]: ROUTES.DASHBOARD,
  [ROLES.RECEPTIONIST]: ROUTES.DASHBOARD,
  [ROLES.LAB_TECHNICIAN]: ROUTES.DASHBOARD,
  [ROLES.PHARMACIST]: ROUTES.DASHBOARD,
  [ROLES.PATIENT]: ROUTES.DASHBOARD,
  [ROLES.INSURANCE_COORDINATOR]: ROUTES.DASHBOARD,
});

/* -------------------------------------------------------------------------- */
/* Phase 7 — Navigation items (role-filtered sidebar Drawer)                  */
/* -------------------------------------------------------------------------- */

/**
 * Ordered descriptors for the `AppLayout` role-filtered MUI `Drawer`.
 *
 * Each item is a frozen object of shape `{ key, label, route, module, icon }`:
 * - `key`    — stable React list key / test selector.
 * - `label`  — human-readable navigation text.
 * - `route`  — destination path (always a value from {@link ROUTES}).
 * - `module` — the {@link MODULES} VALUE gating visibility, or `null` to mean
 *              "always visible to any authenticated user" (e.g. Dashboard).
 * - `icon`   — a STRING KEY, NOT an imported MUI icon component. This module is
 *              framework-agnostic pure JS, so the `components/layout` agent maps
 *              each string key (e.g. 'people') to the corresponding
 *              `@mui/icons-material` component.
 *
 * `rbac.getNavItemsForRole(role)` filters this array down to the items whose
 * `module` is `null` or is present in that role's `ROLE_MODULE_MAP` entry.
 * Both the array and every element are `Object.freeze`d.
 *
 * @constant
 * @type {ReadonlyArray<Readonly<{ key: string, label: string, route: string, module: (string|null), icon: string }>>}
 */
export const NAV_ITEMS = Object.freeze([
  Object.freeze({
    key: 'dashboard',
    label: 'Dashboard',
    route: ROUTES.DASHBOARD,
    module: null,
    icon: 'dashboard',
  }),
  Object.freeze({
    key: 'patients',
    label: 'Patients',
    route: ROUTES.PATIENTS,
    module: MODULES.PATIENT_REGISTRATION,
    icon: 'people',
  }),
  Object.freeze({
    key: 'appointments',
    label: 'Appointments',
    route: ROUTES.APPOINTMENTS,
    module: MODULES.APPOINTMENT_SCHEDULING,
    icon: 'event',
  }),
  Object.freeze({
    key: 'emr',
    label: 'Medical Records',
    route: ROUTES.EMR,
    module: MODULES.ELECTRONIC_MEDICAL_RECORDS,
    icon: 'description',
  }),
  Object.freeze({
    key: 'billing',
    label: 'Billing & Insurance',
    route: ROUTES.BILLING,
    module: MODULES.BILLING_INSURANCE,
    icon: 'receipt_long',
  }),
  Object.freeze({
    key: 'pharmacy',
    label: 'Pharmacy',
    route: ROUTES.PHARMACY,
    module: MODULES.PHARMACY_MANAGEMENT,
    icon: 'medication',
  }),
  Object.freeze({
    key: 'laboratory',
    label: 'Laboratory',
    route: ROUTES.LABORATORY,
    module: MODULES.LABORATORY_MANAGEMENT,
    icon: 'science',
  }),
  Object.freeze({
    key: 'inventory',
    label: 'Inventory',
    route: ROUTES.INVENTORY,
    module: MODULES.INVENTORY_MANAGEMENT,
    icon: 'inventory_2',
  }),
  Object.freeze({
    key: 'reports',
    label: 'Reports & Analytics',
    route: ROUTES.REPORTS,
    module: MODULES.REPORTS_ANALYTICS,
    icon: 'assessment',
  }),
]);

/* -------------------------------------------------------------------------- */
/* Phase 8 — API path segments (gateway)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Relative API gateway route SEGMENTS consumed by `services/`. These are bare
 * path segments — no leading slash and no `/api` prefix — because the shared
 * axios client prepends `${VITE_API_BASE_URL}/api/`. For example, `services/`
 * composes the login URL as `/api/auth/login` from `API_PATHS.AUTH`. The
 * segments match the backend API gateway's route table.
 *
 * @constant
 * @type {Readonly<Record<string, string>>}
 */
export const API_PATHS = Object.freeze({
  AUTH: 'auth',
  PATIENTS: 'patients',
  APPOINTMENTS: 'appointments',
  EMR: 'emr',
  BILLING: 'billing',
  PHARMACY: 'pharmacy',
  LABORATORY: 'laboratory',
  INVENTORY: 'inventory',
  REPORTS: 'reports',
});
