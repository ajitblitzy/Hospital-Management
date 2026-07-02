'use strict';

const { expect } = require('@playwright/test');
const BasePage = require('./BasePage');

/**
 * BillingPage — invoice generation, payment methods, and insurance-claim
 * actions (Doc 02 "Billing & Payments": invoice generation, insurance claims
 * management, support for multiple payment methods).
 *
 * Lives under the `/billing` module route. Invoice/line-item/claim data is
 * supplied by callers (e.g. derived from the @hms/test-fixtures `invoices`
 * dataset); nothing is hard-coded here. Payment methods align with the fixtures
 * enum: "card", "cash", "insurance".
 */
class BillingPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.path = '/billing';
    this.newPath = '/billing/new';
  }

  // ---------------------------------------------------------------------------
  // Locators
  // ---------------------------------------------------------------------------

  /** Button that opens the create-invoice form. */
  get createInvoiceButton() {
    return this.page
      .getByTestId('create-invoice')
      .or(this.page.getByRole('button', { name: /create invoice|new invoice|generate invoice/i }));
  }

  /** Button to add a line item to the current invoice. */
  get addLineItemButton() {
    return this.page
      .getByTestId('add-line-item')
      .or(this.page.getByRole('button', { name: /add (line )?item|add charge/i }));
  }

  /** Payment-method picker (MUI Select → role="combobox"). */
  get paymentMethodSelect() {
    return this.page
      .getByTestId('payment-method')
      .or(this.page.getByRole('combobox', { name: /payment method/i }))
      .or(this.page.getByLabel(/payment method/i));
  }

  /** Amount-paid / payment-amount field. */
  get amountPaidInput() {
    return this.page
      .getByTestId('amount-paid')
      .or(this.page.getByLabel(/amount paid|payment amount|amount/i));
  }

  /** Record-payment submit button. */
  get recordPaymentButton() {
    return this.page
      .getByTestId('record-payment')
      .or(this.page.getByRole('button', { name: /record payment|pay|take payment/i }));
  }

  /** Button that opens the insurance-claim action/dialog. */
  get insuranceClaimButton() {
    return this.page
      .getByTestId('submit-insurance-claim')
      .or(this.page.getByRole('button', { name: /insurance claim|submit claim|file claim/i }));
  }

  /** Generate/save-invoice submit button. */
  get generateButton() {
    return this.page
      .getByTestId('generate-invoice')
      .or(this.page.getByRole('button', { name: /generate|save invoice|create|submit/i }));
  }

  /** Element displaying the generated invoice number. */
  get invoiceNumberDisplay() {
    return this.page.getByTestId('invoice-number').or(this.page.getByText(/INV-\d+/i));
  }

  /** Element displaying the invoice total. */
  get invoiceTotalDisplay() {
    return this.page.getByTestId('invoice-total');
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /** Navigate to the billing module. @returns {Promise<this>} */
  async goto() {
    await super.goto(this.path);
    return this;
  }

  /**
   * Open the create-invoice form via the action button, falling back to the
   * create route.
   * @returns {Promise<this>}
   */
  async openInvoiceForm() {
    if (await this.createInvoiceButton.first().isVisible().catch(() => false)) {
      await this.createInvoiceButton.first().click();
    } else {
      await super.goto(this.newPath);
    }
    await this.waitForLoaded();
    return this;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Add a single line item. Fills the most-recently-added item row.
   * @param {{description?:string, quantity?:number|string, unit_price?:number|string}} item
   * @returns {Promise<this>}
   */
  async addLineItem(item = {}) {
    await this.addLineItemButton.first().click();
    if (item.description !== undefined) {
      await this.page.getByLabel(/description/i).last().fill(String(item.description));
    }
    if (item.quantity !== undefined) {
      await this.page.getByLabel(/quantity|qty/i).last().fill(String(item.quantity));
    }
    if (item.unit_price !== undefined) {
      await this.page.getByLabel(/unit price|price|rate/i).last().fill(String(item.unit_price));
    }
    return this;
  }

  /**
   * Generate an invoice from a set of line items (Doc 02: invoice generation).
   * @param {{patient?:string, line_items?:Array<object>}} details
   * @returns {Promise<string>} The generated invoice number.
   */
  async generateInvoice(details = {}) {
    await this.openInvoiceForm();
    if (details.patient) {
      const patientField = this.page
        .getByTestId('invoice-patient')
        .or(this.page.getByLabel(/patient/i));
      const role = await patientField.first().getAttribute('role').catch(() => null);
      if (role === 'combobox') {
        await this.chooseFromMuiSelect(patientField.first(), details.patient);
      } else {
        await patientField.first().fill(String(details.patient));
      }
    }
    for (const item of details.line_items || []) {
      await this.addLineItem(item);
    }
    await this.generateButton.first().click();
    await this.waitForLoaded();
    return this.getInvoiceNumber();
  }

  /**
   * Select a payment method (Doc 02: multiple payment methods).
   * @param {'card'|'cash'|'insurance'|string} method
   * @returns {Promise<this>}
   */
  async selectPaymentMethod(method) {
    await this.chooseFromMuiSelect(this.paymentMethodSelect.first(), new RegExp(method, 'i'));
    return this;
  }

  /**
   * Record a payment against the current invoice using a chosen method.
   * @param {{method?:string, amount?:number|string}} payment
   * @returns {Promise<this>}
   */
  async recordPayment(payment = {}) {
    if (payment.method) await this.selectPaymentMethod(payment.method);
    if (payment.amount !== undefined) {
      await this.amountPaidInput.first().fill(String(payment.amount));
    }
    await this.recordPaymentButton.first().click();
    await this.waitForLoaded();
    return this;
  }

  /**
   * Submit an insurance claim for the current invoice (Doc 02: insurance claims
   * management).
   * @param {{provider?:string, policy_number?:string, claimed_amount?:number|string}} [claim]
   * @returns {Promise<this>}
   */
  async submitInsuranceClaim(claim = {}) {
    await this.insuranceClaimButton.first().click();
    if (claim.provider !== undefined) {
      await this.page.getByLabel(/provider|insurer/i).first().fill(String(claim.provider));
    }
    if (claim.policy_number !== undefined) {
      await this.page.getByLabel(/policy number/i).first().fill(String(claim.policy_number));
    }
    if (claim.claimed_amount !== undefined) {
      await this.page.getByLabel(/claim(ed)? amount|amount/i).first().fill(String(claim.claimed_amount));
    }
    await this.page.getByRole('button', { name: /submit|file|save/i }).last().click();
    await this.waitForLoaded();
    return this;
  }

  // ---------------------------------------------------------------------------
  // Read-back / assertions
  // ---------------------------------------------------------------------------

  /** Read the generated invoice number (e.g. "INV-000007"). @returns {Promise<string>} */
  async getInvoiceNumber() {
    const el = this.invoiceNumberDisplay.first();
    await el.waitFor({ state: 'visible' });
    const text = ((await el.textContent()) || '').trim();
    const match = text.match(/INV-\d+/i);
    return match ? match[0] : text;
  }

  /** Read the invoice total as displayed. @returns {Promise<string>} */
  async getInvoiceTotal() {
    const el = this.invoiceTotalDisplay.first();
    await el.waitFor({ state: 'visible' });
    return ((await el.textContent()) || '').trim();
  }

  /** Assert the invoice was generated (confirmation toast). @returns {Promise<this>} */
  async expectInvoiceGenerated() {
    await this.expectToast(/invoice|generated|created|success/i);
    return this;
  }
}

module.exports = BillingPage;
module.exports.BillingPage = BillingPage;
