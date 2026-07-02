/**
 * @module utils/rbac
 *
 * Pure, null-safe Role-Based Access Control (RBAC) helper functions for the
 * Hospital Management System (HMS) React single-page application.
 *
 * This module is the SPA's client-side authorization vocabulary expressed as
 * executable logic. It contains **no JSX, no React imports, no network calls,
 * and no secrets** — only small, total (never-throwing) functions that derive
 * every decision from the deeply-frozen maps declared in `./constants.js`.
 * Because `constants.js` is the single source of truth for roles, modules,
 * routes, and navigation, this file NEVER hard-codes or duplicates that
 * vocabulary; it only reads from it. Importing this module is a pure,
 * side-effect-free operation.
 *
 * ADVISORY / DEFENSE-IN-DEPTH ONLY. Every helper here exists purely to improve
 * UX — to hide navigation the user cannot use and to pre-empt routes they are
 * not permitted to open. It is NOT a security boundary: the backend API gateway
 * and services remain the sole authoritative enforcers of authorization (see
 * "03_Hospital_Management_Technical_Architecture" -> Security Architecture:
 * "Role-based authorization"). If this client mirror ever diverges from the
 * backend policy, the backend wins and the user simply receives a 403.
 *
 * Design contract — all exported helpers are PURE and TOTAL:
 *   - They never mutate their arguments or the frozen `constants.js` values.
 *   - They never throw. A falsy, unknown, or otherwise unexpected `userRole`
 *     (including `null`, `undefined`, `''`, or even an inherited object key such
 *     as `'toString'`) always degrades to the safe/empty result rather than
 *     raising. This lets consumers call them during the first render — before
 *     the JWT has been decoded and the role is known — without extra guards.
 *
 * Consumers:
 *   - routes/RoleRoute             gates protected routes and redirects
 *                                  unauthorized users to `ROUTES.FORBIDDEN`
 *                                  ('/403'), using `hasRole` / `canAccessModule`.
 *   - hooks/useRole               exposes `hasRole(role, allowed)` to components.
 *   - hooks/usePermissions        exposes `canAccessModule(role, module)`.
 *   - components/layout/AppLayout  builds the role-filtered MUI navigation
 *                                  `Drawer` from `getNavItemsForRole(role)`.
 *   - store/authSlice (indirectly) uses `getLandingRoute(role)` to choose the
 *                                  post-login redirect target.
 *
 * @see frontend/src/utils/constants.js — the frozen RBAC / navigation maps.
 * @see backend/shared/rbac.js — canonical backend policy this mirror tracks
 *      (a separate workspace the browser app never imports).
 */

import {
  ROLE_MODULE_MAP,
  ROLE_LANDING_MAP,
  ROUTES,
  NAV_ITEMS,
} from './constants';

/* -------------------------------------------------------------------------- */
/* Phase 1 — hasRole                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Test whether a user's role satisfies an allow-list.
 *
 * The allow-list may be expressed either as a single role VALUE string (e.g.
 * `'Doctor'`) or as an array of role VALUE strings (e.g. `['Nurse', 'Doctor']`).
 * Role VALUES are the exact human-readable strings from `constants.ROLES`
 * (which mirror the backend JWT `role` claim) — this helper compares those
 * VALUES, not the `ROLES.*` object keys.
 *
 * Null-safety: a falsy `userRole` (`null` / `undefined` / `''`) never matches
 * anything and yields `false`. An empty, `null`, or `undefined` `allowed`
 * grants no access and also yields `false`. The function never throws.
 *
 * @param {(string|null|undefined)} userRole - The current user's role VALUE
 *   (typically `decoded.role` from the JWT), or a falsy value before auth.
 * @param {(string|ReadonlyArray<string>|null|undefined)} allowed - A single
 *   permitted role VALUE, or an array of permitted role VALUES.
 * @returns {boolean} `true` iff `userRole` is truthy and is permitted by
 *   `allowed`; otherwise `false`.
 *
 * @example
 * hasRole('Doctor', 'Doctor');            // -> true
 * hasRole('Doctor', ['Nurse', 'Doctor']); // -> true
 * hasRole('Patient', ['Doctor']);         // -> false
 * hasRole(null, 'Doctor');                // -> false
 * hasRole('Doctor', []);                  // -> false
 */
export function hasRole(userRole, allowed) {
  // A falsy user role can never satisfy any allow-list; bail out first so the
  // rest of the function only ever reasons about a concrete role string.
  if (!userRole) {
    return false;
  }

  // Array allow-list -> membership test. An empty array yields `false`.
  if (Array.isArray(allowed)) {
    return allowed.includes(userRole);
  }

  // Single-value allow-list -> strict equality. A `null`/`undefined` `allowed`
  // falls through to here and can never strictly equal a non-empty string, so
  // it correctly resolves to `false` without needing a dedicated branch.
  return userRole === allowed;
}

/* -------------------------------------------------------------------------- */
/* Phase 2 — canAccessModule                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Test whether a role is permitted to access a given HMS functional module.
 *
 * The decision is read directly from the frozen `ROLE_MODULE_MAP` in
 * `constants.js` (role VALUE -> frozen array of module VALUES). Both `userRole`
 * and `module` are compared as VALUE strings (e.g. `'Pharmacist'` and
 * `'Pharmacy Management'`), matching the `constants.ROLES` / `constants.MODULES`
 * values.
 *
 * Null-safety: an unknown or falsy `userRole` has no entry in the map and
 * yields `false`. The `Array.isArray` guard additionally means an inherited
 * object key (e.g. `'toString'`, which would resolve to a prototype function
 * rather than a role list) safely yields `false` instead of throwing. Never
 * throws.
 *
 * @param {(string|null|undefined)} userRole - The user's role VALUE.
 * @param {(string|null|undefined)} module - The module VALUE to check
 *   (a `constants.MODULES` value).
 * @returns {boolean} `true` iff `userRole` maps to a module list that includes
 *   `module`; otherwise `false`.
 *
 * @example
 * canAccessModule('Hospital Administrator', 'Reports & Analytics'); // -> true
 * canAccessModule('Pharmacist', 'Pharmacy Management');             // -> true
 * canAccessModule('Pharmacist', 'Billing & Insurance');             // -> false
 * canAccessModule('unknown-role', 'Pharmacy Management');           // -> false
 */
export function canAccessModule(userRole, module) {
  // Look up the role's frozen module list. Unknown/falsy roles resolve to
  // `undefined`; inherited keys resolve to non-array values — the
  // `Array.isArray` guard rejects both and short-circuits before `.includes`,
  // keeping the function total (never throws) for any input.
  const allowedModules = ROLE_MODULE_MAP[userRole];
  return Array.isArray(allowedModules) && allowedModules.includes(module);
}

/* -------------------------------------------------------------------------- */
/* Phase 3 — getLandingRoute                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the client route a user should land on immediately after login.
 *
 * The route is read from the frozen `ROLE_LANDING_MAP` (role VALUE -> route).
 * When the role is missing from the map — because it is `null`/`undefined`, is
 * an unrecognized string, or resolves to a non-string inherited key — the
 * function falls back to `ROUTES.DASHBOARD`.
 *
 * Fallback rationale (documented choice): we deliberately default to
 * `ROUTES.DASHBOARD` rather than `ROUTES.LOGIN`. All eight known roles already
 * map to the dashboard, so `DASHBOARD` is the consistent, least-surprising
 * destination, and authentication is still enforced downstream by
 * `ProtectedRoute` / `RoleRoute` (an unauthenticated user who reaches
 * `/dashboard` is bounced to `/login` by the auth guard, so this fallback can
 * never leak a protected view). Returning `DASHBOARD` keeps this helper a pure
 * routing mapper with no auth concerns of its own.
 *
 * @param {(string|null|undefined)} userRole - The user's role VALUE.
 * @returns {string} The mapped landing route, or `ROUTES.DASHBOARD` as the safe
 *   fallback. Always a non-empty route string; never throws.
 *
 * @example
 * getLandingRoute('Doctor');    // -> '/dashboard'
 * getLandingRoute(undefined);   // -> '/dashboard' (documented fallback)
 */
export function getLandingRoute(userRole) {
  // Only index the map for a truthy role, then require the result to be an
  // actual route string. This rejects both missing entries (`undefined`) and
  // non-string inherited keys, guaranteeing a valid route is always returned.
  const landingRoute = userRole ? ROLE_LANDING_MAP[userRole] : undefined;
  return typeof landingRoute === 'string' ? landingRoute : ROUTES.DASHBOARD;
}

/* -------------------------------------------------------------------------- */
/* Phase 4 — getNavItemsForRole                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build the ordered list of navigation items visible to a given role.
 *
 * Filters the frozen `NAV_ITEMS` descriptor array down to the items the role
 * should see:
 *   - Items whose `module` is `null` are ALWAYS visible to any authenticated
 *     user (e.g. the Dashboard entry).
 *   - Items with a `module` VALUE are visible only when
 *     `canAccessModule(userRole, item.module)` is `true`.
 *
 * The result preserves the source ordering of `NAV_ITEMS`. A falsy `userRole`
 * yields only the always-visible (`module === null`) items and never throws.
 *
 * Immutability: this returns a NEW array (via `Array.prototype.filter`) so the
 * caller may safely hold — or, if it wishes, sort — its own copy without ever
 * mutating the frozen `NAV_ITEMS` array. The elements inside the returned array
 * are the SAME frozen item references from `NAV_ITEMS` (referential integrity
 * is preserved; the item objects are not cloned).
 *
 * @param {(string|null|undefined)} userRole - The user's role VALUE.
 * @returns {Array<Readonly<{ key: string, label: string, route: string,
 *   module: (string|null), icon: string }>>} A fresh array (distinct from
 *   `NAV_ITEMS`) of the frozen nav-item objects the role may see.
 *
 * @example
 * getNavItemsForRole('Pharmacist').map((i) => i.key);
 * //   -> ['dashboard', 'pharmacy', 'inventory']
 * getNavItemsForRole(null).map((i) => i.key);
 * //   -> ['dashboard']
 */
export function getNavItemsForRole(userRole) {
  // `filter` returns a new array while keeping each surviving element as the
  // original frozen reference from `NAV_ITEMS` — so the caller receives an
  // independent list with no clone or mutation of shared navigation vocabulary.
  return NAV_ITEMS.filter(
    (item) => item.module === null || canAccessModule(userRole, item.module),
  );
}
