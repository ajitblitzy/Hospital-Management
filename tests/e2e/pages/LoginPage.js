'use strict';

const { expect } = require('@playwright/test');
const BasePage = require('./BasePage');

/**
 * LoginPage — the `/login` screen of the HMS React (MUI v5) SPA.
 *
 * Covers the full authentication journey from Doc 02 "Authentication &
 * Authorization":
 *   - email + password credential login,
 *   - the multi-factor authentication (MFA) OTP challenge shown to privileged
 *     roles (Hospital Administrator, Doctor),
 *   - surfacing of auth error messages.
 *
 * This POM is consumed by the auth fixtures (tests/e2e/fixtures) to create
 * reusable storage-state per role, and by specs directly. Credentials are NEVER
 * hard-coded here — callers pass either individual values or a credential
 * object from @hms/test-fixtures of the shape:
 *   { key, role, username, email, password, mfaEnabled, privileged, ... }
 */
class LoginPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.path = '/login';
  }

  // ---------------------------------------------------------------------------
  // Locators (accessible-first, data-testid fallback)
  // ---------------------------------------------------------------------------

  /** Email field (MUI TextField label "Email"). */
  get emailInput() {
    return this.page
      .getByTestId('login-email')
      .or(this.page.getByLabel(/email/i));
  }

  /** Password field (MUI TextField label "Password"). */
  get passwordInput() {
    return this.page
      .getByTestId('login-password')
      .or(this.page.getByLabel(/password/i));
  }

  /** Primary submit button ("Sign in" / "Log in"). */
  get submitButton() {
    return this.page
      .getByTestId('login-submit')
      .or(this.page.getByRole('button', { name: /sign in|log ?in|continue/i }));
  }

  /** One-time-passcode field shown during the MFA challenge. */
  get otpInput() {
    return this.page
      .getByTestId('mfa-code')
      .or(this.page.getByLabel(/one[- ]?time|otp|verification code|authentication code|mfa/i));
  }

  /** MFA verify/confirm button. */
  get verifyButton() {
    return this.page
      .getByTestId('mfa-verify')
      .or(this.page.getByRole('button', { name: /verify|confirm|submit/i }));
  }

  /** Auth error message (MUI Alert role="alert"). */
  get errorAlert() {
    return this.page.getByTestId('login-error').or(this.page.getByRole('alert'));
  }

  // ---------------------------------------------------------------------------
  // Navigation / state
  // ---------------------------------------------------------------------------

  /** Navigate to the login page. @returns {Promise<this>} */
  async goto() {
    await super.goto(this.path);
    return this;
  }

  /** Assert the login form is loaded and interactive. @returns {Promise<this>} */
  async expectLoaded() {
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.submitButton).toBeVisible();
    return this;
  }

  /**
   * Whether the MFA OTP challenge is currently displayed. Privileged roles
   * (admin, doctor) trigger this step after a successful password submit.
   * @returns {Promise<boolean>}
   */
  async isMfaChallengeVisible() {
    return this.otpInput.first().isVisible().catch(() => false);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Enter credentials and submit the login form. Does NOT handle MFA (see
   * completeMfa / loginAs).
   * @param {string} email
   * @param {string} password
   * @returns {Promise<this>}
   */
  async login(email, password) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
    return this;
  }

  /**
   * Complete the MFA challenge by entering the one-time passcode and verifying.
   * The code is supplied by the caller (e.g. a dev/test OTP from env or the
   * fixtures package) — never hard-coded here.
   * @param {string} code
   * @returns {Promise<this>}
   */
  async completeMfa(code) {
    await this.otpInput.fill(String(code));
    await this.verifyButton.click();
    await this.waitForLoaded();
    return this;
  }

  /**
   * High-level login used by fixtures/specs. Accepts a @hms/test-fixtures
   * credential object and performs the password step, then completes MFA when
   * the account is privileged/MFA-enabled and a code is available.
   *
   * @param {{email:string, password:string, mfaEnabled?:boolean, privileged?:boolean}} credential
   * @param {{mfaCode?:string}} [options] Dev/test OTP for MFA-enabled roles.
   * @returns {Promise<this>}
   */
  async loginAs(credential, options = {}) {
    if (!credential || !credential.email || !credential.password) {
      throw new Error('[LoginPage] loginAs requires a credential with { email, password }');
    }
    await this.login(credential.email, credential.password);

    const expectsMfa = credential.mfaEnabled || credential.privileged;
    if (expectsMfa && options.mfaCode) {
      await this.otpInput.first().waitFor({ state: 'visible' });
      await this.completeMfa(options.mfaCode);
    }
    await this.waitForLoaded();
    return this;
  }

  /**
   * Read the visible auth error message (e.g. invalid credentials).
   * @returns {Promise<string>}
   */
  async getErrorMessage() {
    const alert = this.errorAlert.first();
    await alert.waitFor({ state: 'visible' });
    return ((await alert.textContent()) || '').trim();
  }

  /**
   * Assert an auth error containing the given text is shown.
   * @param {string|RegExp} [expected=/invalid|incorrect|failed|denied/i]
   * @returns {Promise<this>}
   */
  async expectError(expected = /invalid|incorrect|failed|denied|unauthor/i) {
    await expect(this.errorAlert.first()).toContainText(expected);
    return this;
  }
}

module.exports = LoginPage;
module.exports.LoginPage = LoginPage;
