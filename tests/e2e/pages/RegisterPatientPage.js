'use strict';

const { expect } = require('@playwright/test');
const BasePage = require('./BasePage');

/**
 * RegisterPatientPage — patient registration screen (Doc 02 "Patient
 * Registration": create/update patient profiles, upload identification
 * documents, generate unique patient IDs).
 *
 * Lives under the `/patients` module route; the create form is opened via a
 * "Register Patient" / "New Patient" action (or the `/patients/new` route).
 *
 * `fillForm` accepts a patient record whose keys mirror the @hms/test-fixtures
 * `patients` dataset (snake_case), e.g. { first_name, last_name, date_of_birth,
 * gender, email, phone, address_line1, city, state, postal_code, country,
 * blood_group, national_id, insurance_provider, insurance_policy_number,
 * emergency_contact_name, emergency_contact_phone }. Only provided keys are
 * filled, so it supports both create and partial-update flows. No PII is
 * hard-coded here — data is supplied by callers.
 */
class RegisterPatientPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.path = '/patients';
    this.newPath = '/patients/new';
  }

  // ---------------------------------------------------------------------------
  // Locators
  // ---------------------------------------------------------------------------

  /** Button that opens the registration form from the patients list. */
  get registerButton() {
    return this.page
      .getByTestId('register-patient')
      .or(this.page.getByRole('button', { name: /register patient|new patient|add patient/i }));
  }

  /**
   * Map of logical (snake_case) field name → its input locator. Uses accessible
   * labels first, with a data-testid fallback keyed by the same name.
   * @param {string} name
   * @returns {import('@playwright/test').Locator}
   */
  field(name) {
    const byLabel = {
      first_name: /first name/i,
      last_name: /last name/i,
      date_of_birth: /date of birth|dob/i,
      gender: /gender|sex/i,
      email: /email/i,
      phone: /phone|mobile|contact number/i,
      address_line1: /address/i,
      city: /city/i,
      state: /state|province/i,
      postal_code: /postal code|zip/i,
      country: /country/i,
      blood_group: /blood group|blood type/i,
      national_id: /national id|identification number|id number/i,
      insurance_provider: /insurance provider|insurer/i,
      insurance_policy_number: /policy number|insurance policy/i,
      emergency_contact_name: /emergency contact name/i,
      emergency_contact_phone: /emergency contact phone|emergency contact number/i,
    };
    const label = byLabel[name];
    const byTestId = this.page.getByTestId(`patient-${name.replace(/_/g, '-')}`);
    return label ? byTestId.or(this.page.getByLabel(label)) : byTestId;
  }

  /** File input for the identification document upload control. */
  get idDocumentInput() {
    return this.page
      .getByTestId('patient-id-document')
      .or(this.page.locator('input[type="file"]'));
  }

  /** Save/submit button for the form. */
  get saveButton() {
    return this.page
      .getByTestId('patient-save')
      .or(this.page.getByRole('button', { name: /save|register|create|submit/i }));
  }

  /** Element that displays the generated unique patient ID after save. */
  get patientIdDisplay() {
    return this.page.getByTestId('patient-id-value').or(this.page.getByText(/PAT-\d+/i));
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /** Navigate to the patients module. @returns {Promise<this>} */
  async goto() {
    await super.goto(this.path);
    return this;
  }

  /**
   * Open the registration form, either by clicking the "Register Patient"
   * action or navigating to the create route as a fallback.
   * @returns {Promise<this>}
   */
  async openRegistrationForm() {
    if (await this.registerButton.first().isVisible().catch(() => false)) {
      await this.registerButton.first().click();
    } else {
      await super.goto(this.newPath);
    }
    await expect(this.field('first_name').first()).toBeVisible();
    return this;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Fill the patient profile form. Only keys present in `data` are filled.
   * `gender`, `blood_group`, and `country` are treated as MUI <Select>s when a
   * combobox is detected, otherwise filled as text.
   * @param {Record<string, string>} data snake_case patient fields.
   * @returns {Promise<this>}
   */
  async fillForm(data = {}) {
    const selectFields = new Set(['gender', 'blood_group', 'country']);
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;
      const input = this.field(key).first();
      if (selectFields.has(key)) {
        const role = await input.getAttribute('role').catch(() => null);
        if (role === 'combobox') {
          await this.chooseFromMuiSelect(input, String(value));
          continue;
        }
      }
      await input.fill(String(value));
    }
    return this;
  }

  /**
   * Upload an identification document (Doc 02: upload identification documents).
   * @param {string|string[]} filePath Absolute path(s) to the file(s).
   * @returns {Promise<this>}
   */
  async uploadIdDocument(filePath) {
    await this.idDocumentInput.first().setInputFiles(filePath);
    return this;
  }

  /** Submit the form and wait for the app to settle. @returns {Promise<this>} */
  async submit() {
    await this.saveButton.first().click();
    await this.waitForLoaded();
    return this;
  }

  /**
   * End-to-end registration: open the form, fill it, optionally upload an ID
   * document, submit, and return the generated unique patient ID.
   * @param {Record<string, string>} data
   * @param {{idDocument?: string}} [options]
   * @returns {Promise<string>} The generated patient ID (e.g. "PAT-000123").
   */
  async register(data, options = {}) {
    await this.openRegistrationForm();
    await this.fillForm(data);
    if (options.idDocument) {
      await this.uploadIdDocument(options.idDocument);
    }
    await this.submit();
    return this.getGeneratedPatientId();
  }

  /**
   * Read back the unique patient ID generated by the system after save.
   * @returns {Promise<string>}
   */
  async getGeneratedPatientId() {
    const el = this.patientIdDisplay.first();
    await el.waitFor({ state: 'visible' });
    const text = ((await el.textContent()) || '').trim();
    const match = text.match(/PAT-\d+/i);
    return match ? match[0] : text;
  }

  /** Assert the save succeeded (confirmation toast). @returns {Promise<this>} */
  async expectSaved() {
    await this.expectToast(/saved|registered|created|success/i);
    return this;
  }
}

module.exports = RegisterPatientPage;
module.exports.RegisterPatientPage = RegisterPatientPage;
