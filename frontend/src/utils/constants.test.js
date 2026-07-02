/**
 * @file frontend/src/utils/constants.test.js
 * @module utils/constants.test
 *
 * Contract-lock unit tests for the HMS RBAC vocabulary defined in
 * `./constants.js`. This is the most safety-critical test in `utils`: it pins
 * the application's role/module vocabulary to EXACTLY 8 roles and 8 modules and
 * verifies that every derived map (labels, routes, permissions, landing pages,
 * navigation, API paths) stays complete and internally consistent.
 *
 * Why this matters: the `ROLES` *values* are a cross-workspace contract shared
 * verbatim with the backend `@hms/shared` library (they populate the JWT
 * `role` claim and seed the `roles` table). If a role or module key/value
 * silently drifts — is renamed, added, or removed — client-side RBAC,
 * navigation filtering, and route guarding all break with no compile error.
 * These assertions are intentionally strict so any such drift (e.g. a 9th
 * role, or `'Doctor'` renamed to `'Physician'`) fails the suite immediately.
 *
 * The suite is pure ESM with NO JSX and NO DOM usage, so it runs under
 * Vitest's defaults regardless of the project's `jsdom`/`globals` config. The
 * Vitest primitives are imported explicitly for robustness.
 */

import { describe, it, expect } from 'vitest';
import * as C from './constants';

/**
 * Deterministic, import-order-independent comparison helper: returns a shallow
 * copy of `values` sorted lexicographically so equality checks (and their
 * failure diffs) never depend on declaration or iteration order.
 *
 * @param {Iterable<string>} values - Any iterable of strings to normalize.
 * @returns {string[]} A new, lexicographically sorted array.
 */
const sorted = (values) => [...values].sort();

/**
 * The exact, hardcoded set of role KEYS the vocabulary must expose. Hardcoding
 * (rather than deriving from `C.ROLES`) is deliberate — this literal is the
 * "lock" that fails the moment a role key is added, removed, or renamed.
 *
 * @type {string[]}
 */
const EXPECTED_ROLE_KEYS = [
  'HOSPITAL_ADMINISTRATOR',
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'LAB_TECHNICIAN',
  'PHARMACIST',
  'PATIENT',
  'INSURANCE_COORDINATOR',
];

/**
 * The exact, hardcoded set of module VALUES (human-readable names). Same
 * rationale as {@link EXPECTED_ROLE_KEYS}: it locks the module vocabulary so a
 * typo, addition, or rename in `MODULES` is caught immediately.
 *
 * @type {string[]}
 */
const EXPECTED_MODULE_VALUES = [
  'Patient Registration',
  'Appointment Scheduling',
  'Electronic Medical Records',
  'Billing & Insurance',
  'Pharmacy Management',
  'Laboratory Management',
  'Inventory Management',
  'Reports & Analytics',
];

/* -------------------------------------------------------------------------- */
/* Phase 1 — Roles                                                            */
/* -------------------------------------------------------------------------- */

describe('constants — Phase 1: Roles (RBAC vocabulary lock)', () => {
  it('defines EXACTLY 8 roles with the exact key set', () => {
    expect(Object.keys(C.ROLES)).toHaveLength(8);
    expect(sorted(Object.keys(C.ROLES))).toEqual(sorted(EXPECTED_ROLE_KEYS));
  });

  it('mirrors the backend role VALUES byte-for-byte', () => {
    expect(C.ROLES.HOSPITAL_ADMINISTRATOR).toBe('Hospital Administrator');
    expect(C.ROLES.DOCTOR).toBe('Doctor');
    expect(C.ROLES.NURSE).toBe('Nurse');
    expect(C.ROLES.RECEPTIONIST).toBe('Receptionist');
    expect(C.ROLES.LAB_TECHNICIAN).toBe('Lab Technician');
    expect(C.ROLES.PHARMACIST).toBe('Pharmacist');
    expect(C.ROLES.PATIENT).toBe('Patient');
    expect(C.ROLES.INSURANCE_COORDINATOR).toBe('Insurance Coordinator');
  });

  it('exposes ROLE_VALUES as a frozen 8-item list equal to Object.values(ROLES)', () => {
    expect(C.ROLE_VALUES).toHaveLength(8);
    expect(C.ROLE_VALUES).toEqual(Object.values(C.ROLES));
    expect(Object.isFrozen(C.ROLE_VALUES)).toBe(true);
  });

  it('freezes ROLES so consumers cannot mutate the vocabulary at runtime', () => {
    expect(Object.isFrozen(C.ROLES)).toBe(true);
  });

  it('provides a ROLE_LABELS entry for every role VALUE (keys === ROLE_VALUES)', () => {
    expect(sorted(Object.keys(C.ROLE_LABELS))).toEqual(sorted(C.ROLE_VALUES));
    for (const label of Object.values(C.ROLE_LABELS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 2 — Modules                                                          */
/* -------------------------------------------------------------------------- */

describe('constants — Phase 2: Modules (functional-area vocabulary lock)', () => {
  it('defines EXACTLY 8 modules with the exact module VALUES', () => {
    expect(Object.keys(C.MODULES)).toHaveLength(8);
    expect(sorted(Object.values(C.MODULES))).toEqual(
      sorted(EXPECTED_MODULE_VALUES),
    );
  });

  it('exposes MODULE_VALUES as a frozen 8-item list equal to Object.values(MODULES)', () => {
    expect(C.MODULE_VALUES).toHaveLength(8);
    expect(C.MODULE_VALUES).toEqual(Object.values(C.MODULES));
    expect(Object.isFrozen(C.MODULE_VALUES)).toBe(true);
  });

  it('freezes MODULES so consumers cannot mutate the vocabulary at runtime', () => {
    expect(Object.isFrozen(C.MODULES)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 3 — Routes & module→route map                                        */
/* -------------------------------------------------------------------------- */

describe('constants — Phase 3: Routes & module→route map', () => {
  it('maps every module to a route that exists in ROUTES', () => {
    const routeValues = Object.values(C.ROUTES);
    for (const route of Object.values(C.MODULE_ROUTE_MAP)) {
      expect(routeValues).toContain(route);
    }
  });

  it('has exactly 8 module→route keys, one per module VALUE', () => {
    expect(Object.keys(C.MODULE_ROUTE_MAP)).toHaveLength(8);
    expect(sorted(Object.keys(C.MODULE_ROUTE_MAP))).toEqual(
      sorted(C.MODULE_VALUES),
    );
  });

  it('pins the critical route constants', () => {
    expect(C.ROUTES.NOT_FOUND).toBe('*');
    expect(C.ROUTES.FORBIDDEN).toBe('/403');
    expect(C.ROUTES.LOGIN).toBe('/login');
    expect(C.ROUTES.DASHBOARD).toBe('/dashboard');
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 4 — Role→module map / PERMISSIONS                                    */
/* -------------------------------------------------------------------------- */

describe('constants — Phase 4: Role→module map / PERMISSIONS', () => {
  it('has exactly 8 role→module keys, one per role VALUE', () => {
    expect(Object.keys(C.ROLE_MODULE_MAP)).toHaveLength(8);
    expect(sorted(Object.keys(C.ROLE_MODULE_MAP))).toEqual(
      sorted(C.ROLE_VALUES),
    );
  });

  it('references only known modules in every role array', () => {
    // Collect any (role -> module) pairs whose module is not a known VALUE, so
    // a failure diff pinpoints exactly which role introduced the bad entry.
    const unknown = [];
    for (const [role, modules] of Object.entries(C.ROLE_MODULE_MAP)) {
      expect(Array.isArray(modules)).toBe(true);
      for (const mod of modules) {
        if (!C.MODULE_VALUES.includes(mod)) {
          unknown.push(`${role} -> ${mod}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('grants the Hospital Administrator all 8 module values', () => {
    const adminModules = C.ROLE_MODULE_MAP[C.ROLES.HOSPITAL_ADMINISTRATOR];
    expect(adminModules).toHaveLength(8);
    expect(sorted(adminModules)).toEqual(sorted(C.MODULE_VALUES));
  });

  it('freezes each role module array', () => {
    for (const modules of Object.values(C.ROLE_MODULE_MAP)) {
      expect(Object.isFrozen(modules)).toBe(true);
    }
  });

  it('exposes PERMISSIONS as the very same object as ROLE_MODULE_MAP', () => {
    expect(C.PERMISSIONS).toBe(C.ROLE_MODULE_MAP);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 5 — Landing map, nav items, API paths                                */
/* -------------------------------------------------------------------------- */

describe('constants — Phase 5: Landing map, nav items, API paths', () => {
  it('has a landing route for all 8 roles, each an existing ROUTES value', () => {
    expect(Object.keys(C.ROLE_LANDING_MAP)).toHaveLength(8);
    expect(sorted(Object.keys(C.ROLE_LANDING_MAP))).toEqual(
      sorted(C.ROLE_VALUES),
    );
    const routeValues = Object.values(C.ROUTES);
    for (const route of Object.values(C.ROLE_LANDING_MAP)) {
      expect(routeValues).toContain(route);
    }
  });

  it('defines 9 nav items: exactly one dashboard (module null) plus 8 module items', () => {
    expect(C.NAV_ITEMS).toHaveLength(9);
    expect(Object.isFrozen(C.NAV_ITEMS)).toBe(true);

    const routeValues = Object.values(C.ROUTES);
    const nullModuleItems = C.NAV_ITEMS.filter((item) => item.module === null);
    expect(nullModuleItems).toHaveLength(1);
    // The single always-visible item is the Dashboard.
    expect(nullModuleItems[0].route).toBe(C.ROUTES.DASHBOARD);

    for (const item of C.NAV_ITEMS) {
      expect(Object.isFrozen(item)).toBe(true);
      // Every descriptor exposes non-empty string key / label / icon fields.
      for (const field of ['key', 'label', 'icon']) {
        expect(typeof item[field]).toBe('string');
        expect(item[field].length).toBeGreaterThan(0);
      }
      // The route always points at a real ROUTES value.
      expect(routeValues).toContain(item.route);
      // `module` is either null (dashboard) or a known module VALUE.
      if (item.module !== null) {
        expect(C.MODULE_VALUES).toContain(item.module);
      }
    }
  });

  it('exposes 9 API path segments, none starting with a slash', () => {
    const segments = Object.values(C.API_PATHS);
    expect(segments).toHaveLength(9);
    for (const segment of segments) {
      expect(typeof segment).toBe('string');
      expect(segment.length).toBeGreaterThan(0);
      expect(segment.startsWith('/')).toBe(false);
    }
  });
});
