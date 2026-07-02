'use strict';

const { expect } = require('@playwright/test');

/**
 * Escape a literal string for safe use inside a RegExp.
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * BasePage — shared foundation for every HMS Page Object Model.
 *
 * The Hospital Management System frontend is a Material UI (MUI) v5 React SPA
 * served at Playwright's configured `baseURL` (FRONTEND_URL, default
 * http://localhost:3000). Concrete pages extend this class to inherit the
 * common application-shell interactions: relative navigation, the top app-bar /
 * account menu, the role-based navigation drawer, MUI Snackbar/Alert "toast"
 * readers, MUI <Select> handling, and generic loading waits.
 *
 * Selector strategy (per the suite conventions):
 *   - Prefer accessible, user-facing selectors: getByRole / getByLabel /
 *     getByText / getByPlaceholder (the app is MUI-based).
 *   - Fall back to getByTestId (`data-testid`, the configured testIdAttribute)
 *     for stable containers or otherwise-ambiguous elements, via Locator.or().
 *   - Never hard-code credentials or absolute environment URLs here; navigation
 *     uses RELATIVE paths resolved against the Playwright baseURL, and data
 *     (credentials, patient/appointment records, …) is supplied by callers
 *     (fixtures/specs sourced from @hms/test-fixtures).
 */
class BasePage {
  /**
   * @param {import('@playwright/test').Page} page Playwright page handle.
   */
  constructor(page) {
    /** @type {import('@playwright/test').Page} */
    this.page = page;
  }

  // ---------------------------------------------------------------------------
  // Shared application-shell locators (MUI v5)
  // ---------------------------------------------------------------------------

  /** Top application bar / header (MUI AppBar → role="banner"). */
  get header() {
    return this.page.getByTestId('app-header').or(this.page.getByRole('banner'));
  }

  /** Account/profile menu trigger in the app bar (opens the logout menu). */
  get userMenuButton() {
    return this.page
      .getByTestId('user-menu-button')
      .or(
        this.page.getByRole('button', {
          name: /account|profile|user menu|account of current user|open settings/i,
        })
      );
  }

  /** Primary navigation region (MUI Drawer/List → role="navigation"). */
  get navigation() {
    return this.page.getByTestId('app-nav').or(this.page.getByRole('navigation'));
  }

  /** MUI Snackbar content renders an Alert with role="alert" (toast). */
  get snackbar() {
    return this.page.getByRole('alert');
  }

  /** MUI CircularProgress / LinearProgress expose role="progressbar". */
  get loadingIndicator() {
    return this.page.getByRole('progressbar');
  }

  // ---------------------------------------------------------------------------
  // Navigation & URL helpers
  // ---------------------------------------------------------------------------

  /**
   * Navigate to a RELATIVE path (resolved against the Playwright baseURL) and
   * wait for the SPA to settle. Never pass an absolute URL here.
   * @param {string} [path='/']
   * @returns {Promise<this>}
   */
  async goto(path = '/') {
    await this.page.goto(path);
    await this.waitForLoaded();
    return this;
  }

  /** Current pathname (no origin), e.g. "/appointments". @returns {string} */
  currentPath() {
    return new URL(this.page.url()).pathname;
  }

  /**
   * Assert the browser is on the expected path (string prefix or RegExp).
   * @param {string|RegExp} expected
   * @returns {Promise<this>}
   */
  async expectPath(expected) {
    if (expected instanceof RegExp) {
      await expect(this.page).toHaveURL(expected);
    } else {
      await expect(this.page).toHaveURL(new RegExp(`${escapeRegExp(expected)}/?($|[?#])`));
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Loading / generic waits
  // ---------------------------------------------------------------------------

  /**
   * Best-effort wait for the page to finish loading: DOM ready plus any visible
   * MUI progress indicator disappearing. Safe to call after every navigation.
   * @returns {Promise<this>}
   */
  async waitForLoaded() {
    await this.page.waitForLoadState('domcontentloaded');
    const spinner = this.loadingIndicator.first();
    if (await spinner.isVisible().catch(() => false)) {
      await spinner.waitFor({ state: 'hidden' }).catch(() => {});
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // Account menu / logout (shared across authenticated pages)
  // ---------------------------------------------------------------------------

  /** Open the account/profile menu in the app bar. @returns {Promise<this>} */
  async openUserMenu() {
    await this.userMenuButton.click();
    return this;
  }

  /**
   * Log the current user out via the account menu and wait for the app to
   * settle (typically redirects back to /login).
   * @returns {Promise<this>}
   */
  async logout() {
    await this.openUserMenu();
    await this.page.getByRole('menuitem', { name: /log ?out|sign ?out/i }).click();
    await this.waitForLoaded();
    return this;
  }

  // ---------------------------------------------------------------------------
  // Snackbar / toast helpers (MUI Snackbar + Alert)
  // ---------------------------------------------------------------------------

  /**
   * Wait for the first visible toast and return its trimmed text.
   * @returns {Promise<string>}
   */
  async getToastMessage() {
    const toast = this.snackbar.first();
    await toast.waitFor({ state: 'visible' });
    return ((await toast.textContent()) || '').trim();
  }

  /**
   * Assert a toast containing the given text (string substring or RegExp)
   * becomes visible.
   * @param {string|RegExp} expected
   * @returns {Promise<this>}
   */
  async expectToast(expected) {
    await expect(this.snackbar.first()).toContainText(expected);
    return this;
  }

  /**
   * Dismiss the current toast if a close affordance is present (otherwise let
   * MUI auto-hide it).
   * @returns {Promise<this>}
   */
  async dismissToast() {
    const closeButton = this.snackbar.getByRole('button', { name: /close|dismiss/i }).first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
    }
    return this;
  }

  // ---------------------------------------------------------------------------
  // MUI <Select> helper (reused by booking / billing pages)
  // ---------------------------------------------------------------------------

  /**
   * Open a MUI <Select> (role="combobox") and choose an option by accessible
   * name. MUI renders options in a popover listbox (role="listbox" /
   * role="option") appended to the document body.
   * @param {import('@playwright/test').Locator} combobox The Select trigger.
   * @param {string|RegExp} optionName Visible option label.
   * @returns {Promise<this>}
   */
  async chooseFromMuiSelect(combobox, optionName) {
    await combobox.click();
    const listbox = this.page.getByRole('listbox');
    await listbox.waitFor({ state: 'visible' });
    await listbox.getByRole('option', { name: optionName }).first().click();
    return this;
  }
}

module.exports = BasePage;
module.exports.BasePage = BasePage;
module.exports.escapeRegExp = escapeRegExp;
