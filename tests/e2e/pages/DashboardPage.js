'use strict';

const { expect } = require('@playwright/test');
const BasePage = require('./BasePage');

/**
 * The core clinical/administrative modules of the HMS SPA, keyed for stable
 * reference by specs. `label` is the accessible nav-entry text; `path` is the
 * relative SPA route guarded by client-side RBAC. (Doc 01 core modules mapped
 * to Doc 03 gateway route groups.)
 * @type {Record<string, {label: RegExp, path: string}>}
 */
const MODULES = {
  dashboard: { label: /dashboard|home/i, path: '/dashboard' },
  patients: { label: /patients?/i, path: '/patients' },
  appointments: { label: /appointments?/i, path: '/appointments' },
  emr: { label: /medical records?|emr/i, path: '/emr' },
  billing: { label: /billing|invoices?|payments?/i, path: '/billing' },
  pharmacy: { label: /pharmacy/i, path: '/pharmacy' },
  laboratory: { label: /lab(oratory)?/i, path: '/laboratory' },
  inventory: { label: /inventory/i, path: '/inventory' },
  reports: { label: /reports?|analytics/i, path: '/reports' },
};

/**
 * DashboardPage — the authenticated landing shell and role-based navigation
 * menu of the HMS SPA (a.k.a. the navigation component).
 *
 * The frontend enforces client-side RBAC route guards, so the set of visible
 * navigation entries differs per role. This POM lets specs:
 *   - assert which modules a role can see (nav visibility → authorization),
 *   - navigate between modules,
 *   - assert direct access to a guarded route is granted or denied.
 *
 * It does not know role→module mappings itself; specs assert expectations using
 * data they own (e.g. role definitions from @hms/test-fixtures).
 */
class DashboardPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.path = '/dashboard';
    /** @type {Record<string, {label: RegExp, path: string}>} */
    this.modules = MODULES;
  }

  // ---------------------------------------------------------------------------
  // Locators
  // ---------------------------------------------------------------------------

  /** A single navigation entry by its accessible name. */
  navItem(name) {
    return this.navigation
      .getByRole('link', { name })
      .or(this.navigation.getByRole('menuitem', { name }))
      .or(this.navigation.getByRole('button', { name }));
  }

  /** The nav entry for a known module key (e.g. "pharmacy"). */
  moduleNavItem(moduleKey) {
    const mod = this._module(moduleKey);
    return this.navItem(mod.label);
  }

  // ---------------------------------------------------------------------------
  // State assertions
  // ---------------------------------------------------------------------------

  /** Assert the authenticated shell (app bar + navigation) is loaded. */
  async expectLoaded() {
    await expect(this.header).toBeVisible();
    await expect(this.navigation).toBeVisible();
    return this;
  }

  /**
   * Accessible names of every visible top-level navigation entry, trimmed.
   * Useful for asserting a role's menu against an expected set.
   * @returns {Promise<string[]>}
   */
  async visibleNavLabels() {
    const items = this.navigation.getByRole('link');
    const count = await items.count();
    const labels = [];
    for (let i = 0; i < count; i += 1) {
      const text = ((await items.nth(i).textContent()) || '').trim();
      if (text) labels.push(text);
    }
    return labels;
  }

  /** Assert a module's nav entry IS visible (role is authorized for it). */
  async expectNavItemVisible(moduleKey) {
    await expect(this.moduleNavItem(moduleKey).first()).toBeVisible();
    return this;
  }

  /** Assert a module's nav entry is NOT present (role is not authorized). */
  async expectNavItemHidden(moduleKey) {
    await expect(this.moduleNavItem(moduleKey).first()).toHaveCount(0);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigate to a module by clicking its nav entry and wait for its route.
   * @param {string} moduleKey e.g. "patients", "billing", "pharmacy".
   * @returns {Promise<this>}
   */
  async navigateTo(moduleKey) {
    const mod = this._module(moduleKey);
    await this.moduleNavItem(moduleKey).first().click();
    await this.waitForLoaded();
    await this.expectPath(mod.path);
    return this;
  }

  /**
   * Directly visit a module route (bypassing the menu) to exercise route
   * guards, and assert access is GRANTED (lands on the requested path).
   * @param {string} moduleKey
   * @returns {Promise<this>}
   */
  async expectModuleAccessible(moduleKey) {
    const mod = this._module(moduleKey);
    await this.goto(mod.path);
    await this.expectPath(mod.path);
    return this;
  }

  /**
   * Directly visit a module route and assert the RBAC guard DENIES access —
   * i.e. the app does NOT remain on the requested path (redirects to login,
   * dashboard, or a forbidden page) or renders an explicit "access denied"
   * message.
   * @param {string} moduleKey
   * @returns {Promise<this>}
   */
  async expectAccessDenied(moduleKey) {
    const mod = this._module(moduleKey);
    await this.goto(mod.path);
    const deniedBanner = this.page.getByText(/access denied|not authorized|forbidden|permission/i);
    const stayedOnRoute = this.currentPath().replace(/\/$/, '') === mod.path.replace(/\/$/, '');
    if (stayedOnRoute) {
      await expect(deniedBanner.first()).toBeVisible();
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** @param {string} moduleKey */
  _module(moduleKey) {
    const mod = this.modules[moduleKey];
    if (!mod) {
      throw new Error(
        `[DashboardPage] Unknown module "${moduleKey}". Valid: ${Object.keys(this.modules).join(', ')}`
      );
    }
    return mod;
  }
}

module.exports = DashboardPage;
module.exports.DashboardPage = DashboardPage;
module.exports.MODULES = MODULES;
