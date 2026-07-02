'use strict';

const { expect } = require('@playwright/test');
const BasePage = require('./BasePage');

/**
 * AppointmentBookingPage — online appointment booking against a doctor calendar
 * (Doc 02 "Appointment Management": doctor calendar management, online
 * appointment booking).
 *
 * Lives under the `/appointments` module route; the booking form is opened via
 * a "Book Appointment" action (or the `/appointments/new` route). The flow
 * chooses a department and doctor (MUI <Select>s), a date (MUI date picker) and
 * time slot, records a reason, and confirms — reading back the generated
 * appointment reference.
 *
 * Booking details are supplied by callers (e.g. derived from the
 * @hms/test-fixtures `doctors`/`departments`/`appointments` datasets); nothing
 * is hard-coded here.
 */
class AppointmentBookingPage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.path = '/appointments';
    this.newPath = '/appointments/new';
  }

  // ---------------------------------------------------------------------------
  // Locators
  // ---------------------------------------------------------------------------

  /** Button that opens the booking form from the appointments list. */
  get bookButton() {
    return this.page
      .getByTestId('book-appointment')
      .or(this.page.getByRole('button', { name: /book appointment|new appointment|schedule/i }));
  }

  /** Department picker (MUI Select → role="combobox"). */
  get departmentSelect() {
    return this.page
      .getByTestId('appointment-department')
      .or(this.page.getByRole('combobox', { name: /department/i }))
      .or(this.page.getByLabel(/department/i));
  }

  /** Doctor picker (MUI Select/Autocomplete). */
  get doctorSelect() {
    return this.page
      .getByTestId('appointment-doctor')
      .or(this.page.getByRole('combobox', { name: /doctor|physician|provider/i }))
      .or(this.page.getByLabel(/doctor|physician|provider/i));
  }

  /** Date field (MUI date picker text input). */
  get dateInput() {
    return this.page
      .getByTestId('appointment-date')
      .or(this.page.getByLabel(/date|appointment date/i));
  }

  /** Reason / notes free-text field. */
  get reasonInput() {
    return this.page
      .getByTestId('appointment-reason')
      .or(this.page.getByLabel(/reason|notes|purpose/i));
  }

  /** Confirm/book submit button. */
  get confirmButton() {
    return this.page
      .getByTestId('appointment-confirm')
      .or(this.page.getByRole('button', { name: /confirm|book|schedule|save/i }));
  }

  /** Element displaying the generated appointment reference after booking. */
  get confirmationDisplay() {
    return this.page.getByTestId('appointment-number').or(this.page.getByText(/APT-\d+/i));
  }

  /**
   * A bookable time-slot button by its visible label (e.g. "09:00").
   * @param {string|RegExp} slot
   */
  timeSlot(slot) {
    return this.page
      .getByTestId('time-slot')
      .filter({ hasText: slot })
      .or(this.page.getByRole('button', { name: slot }));
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /** Navigate to the appointments module. @returns {Promise<this>} */
  async goto() {
    await super.goto(this.path);
    return this;
  }

  /**
   * Open the booking form via the "Book Appointment" action, falling back to
   * the create route.
   * @returns {Promise<this>}
   */
  async openBookingForm() {
    if (await this.bookButton.first().isVisible().catch(() => false)) {
      await this.bookButton.first().click();
    } else {
      await super.goto(this.newPath);
    }
    await expect(this.departmentSelect.first().or(this.doctorSelect.first())).toBeVisible();
    return this;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Choose a department by name (MUI Select). @returns {Promise<this>} */
  async selectDepartment(name) {
    await this.chooseFromMuiSelect(this.departmentSelect.first(), name);
    return this;
  }

  /** Choose a doctor by name (MUI Select). @returns {Promise<this>} */
  async selectDoctor(name) {
    await this.chooseFromMuiSelect(this.doctorSelect.first(), name);
    return this;
  }

  /**
   * Set the appointment date by typing into the MUI date-picker input.
   * @param {string} dateStr Locale-formatted date string the picker accepts.
   * @returns {Promise<this>}
   */
  async selectDate(dateStr) {
    const input = this.dateInput.first();
    await input.click();
    await input.fill(String(dateStr));
    return this;
  }

  /** Pick a time slot by its visible label. @returns {Promise<this>} */
  async selectTimeSlot(slot) {
    await this.timeSlot(slot).first().click();
    return this;
  }

  /** Enter the visit reason / notes. @returns {Promise<this>} */
  async setReason(text) {
    await this.reasonInput.first().fill(String(text));
    return this;
  }

  /** Confirm the booking and wait for the app to settle. @returns {Promise<this>} */
  async confirmBooking() {
    await this.confirmButton.first().click();
    await this.waitForLoaded();
    return this;
  }

  /**
   * End-to-end booking. Any subset of steps may be provided; only supplied
   * values are applied.
   * @param {{department?:string, doctor?:string, date?:string, timeSlot?:string, reason?:string}} details
   * @returns {Promise<string>} The generated appointment reference.
   */
  async bookAppointment(details = {}) {
    await this.openBookingForm();
    if (details.department) await this.selectDepartment(details.department);
    if (details.doctor) await this.selectDoctor(details.doctor);
    if (details.date) await this.selectDate(details.date);
    if (details.timeSlot) await this.selectTimeSlot(details.timeSlot);
    if (details.reason) await this.setReason(details.reason);
    await this.confirmBooking();
    return this.getConfirmationNumber();
  }

  /**
   * Read the generated appointment reference (e.g. "APT-000007").
   * @returns {Promise<string>}
   */
  async getConfirmationNumber() {
    const el = this.confirmationDisplay.first();
    await el.waitFor({ state: 'visible' });
    const text = ((await el.textContent()) || '').trim();
    const match = text.match(/APT-\d+/i);
    return match ? match[0] : text;
  }

  /** Assert the booking succeeded (confirmation toast). @returns {Promise<this>} */
  async expectBooked() {
    await this.expectToast(/booked|scheduled|confirmed|success/i);
    return this;
  }
}

module.exports = AppointmentBookingPage;
module.exports.AppointmentBookingPage = AppointmentBookingPage;
