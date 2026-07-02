'use strict';

const { expect } = require('@playwright/test');
const BasePage = require('./BasePage');

/**
 * PharmacyDispensePage — prescription dispensing workflow for the Pharmacist
 * (Doc 02 "Pharmacy Management": prescription management, medicine inventory
 * tracking).
 *
 * Lives under the `/pharmacy` module route. A pharmacist finds a prescription
 * (by its RX reference), reviews its items, dispenses one/all items, and
 * confirms — moving the prescription status from "active" to "dispensed"
 * (statuses align with the @hms/test-fixtures `prescriptions` dataset).
 *
 * Prescription identifiers and medicine SKUs are supplied by callers; nothing
 * is hard-coded here.
 */
class PharmacyDispensePage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.path = '/pharmacy';
  }

  // ---------------------------------------------------------------------------
  // Locators
  // ---------------------------------------------------------------------------

  /** Search field for locating a prescription by number/patient. */
  get searchInput() {
    return this.page
      .getByTestId('prescription-search')
      .or(this.page.getByRole('searchbox'))
      .or(this.page.getByLabel(/search|prescription|rx/i));
  }

  /**
   * A prescription row/card by its RX reference (e.g. "RX-000002").
   * @param {string} rxNumber
   */
  prescriptionRow(rxNumber) {
    return this.page
      .getByTestId('prescription-row')
      .filter({ hasText: rxNumber })
      .or(this.page.getByRole('row', { name: rxNumber }))
      .or(this.page.getByText(rxNumber));
  }

  /**
   * The "dispense" control for a single item, identified by medicine SKU/name.
   * @param {string} skuOrName
   */
  dispenseItemButton(skuOrName) {
    return this.page
      .getByTestId('dispense-item')
      .filter({ hasText: skuOrName })
      .or(
        this.page
          .getByRole('row', { name: skuOrName })
          .getByRole('button', { name: /dispense/i })
      );
  }

  /** Button to dispense all items / the whole prescription. */
  get dispenseAllButton() {
    return this.page
      .getByTestId('dispense-all')
      .or(this.page.getByRole('button', { name: /dispense all|dispense$/i }));
  }

  /** Final confirm button (often inside an MUI confirmation Dialog). */
  get confirmButton() {
    return this.page
      .getByTestId('confirm-dispense')
      .or(this.page.getByRole('dialog').getByRole('button', { name: /confirm|dispense|yes/i }))
      .or(this.page.getByRole('button', { name: /confirm dispense|confirm/i }));
  }

  /** Element displaying the prescription status ("active" / "dispensed"). */
  get statusDisplay() {
    return this.page
      .getByTestId('prescription-status')
      .or(this.page.getByText(/\b(active|dispensed|pending)\b/i));
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /** Navigate to the pharmacy module. @returns {Promise<this>} */
  async goto() {
    await super.goto(this.path);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Search for a prescription by reference or patient.
   * @param {string} query
   * @returns {Promise<this>}
   */
  async searchPrescription(query) {
    const box = this.searchInput.first();
    await box.fill(String(query));
    await box.press('Enter');
    await this.waitForLoaded();
    return this;
  }

  /**
   * Open a prescription's detail view by RX reference.
   * @param {string} rxNumber
   * @returns {Promise<this>}
   */
  async openPrescription(rxNumber) {
    await this.prescriptionRow(rxNumber).first().click();
    await this.waitForLoaded();
    return this;
  }

  /**
   * Dispense a single item by medicine SKU or name.
   * @param {string} skuOrName
   * @returns {Promise<this>}
   */
  async dispenseItem(skuOrName) {
    await this.dispenseItemButton(skuOrName).first().click();
    return this;
  }

  /** Dispense all items on the open prescription. @returns {Promise<this>} */
  async dispenseAll() {
    await this.dispenseAllButton.first().click();
    return this;
  }

  /**
   * Confirm the dispense action (acknowledging any MUI confirmation dialog) and
   * wait for the app to settle.
   * @returns {Promise<this>}
   */
  async confirmDispense() {
    await this.confirmButton.first().click();
    await this.waitForLoaded();
    return this;
  }

  /**
   * End-to-end dispense: find the prescription, open it, dispense all (or the
   * given items), and confirm.
   * @param {string} rxNumber
   * @param {{items?: string[]}} [options]
   * @returns {Promise<this>}
   */
  async dispensePrescription(rxNumber, options = {}) {
    await this.searchPrescription(rxNumber);
    await this.openPrescription(rxNumber);
    if (Array.isArray(options.items) && options.items.length > 0) {
      for (const item of options.items) {
        await this.dispenseItem(item);
      }
    } else {
      await this.dispenseAll();
    }
    await this.confirmDispense();
    return this;
  }

  // ---------------------------------------------------------------------------
  // Read-back / assertions
  // ---------------------------------------------------------------------------

  /** Read the current prescription status text. @returns {Promise<string>} */
  async getStatus() {
    const el = this.statusDisplay.first();
    await el.waitFor({ state: 'visible' });
    return ((await el.textContent()) || '').trim();
  }

  /** Assert the prescription is now dispensed (status + toast). @returns {Promise<this>} */
  async expectDispensed() {
    await this.expectToast(/dispensed|success|completed/i);
    return this;
  }
}

module.exports = PharmacyDispensePage;
module.exports.PharmacyDispensePage = PharmacyDispensePage;
