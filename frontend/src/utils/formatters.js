/**
 * @file frontend/src/utils/formatters.js
 * @module utils/formatters
 *
 * Presentation-layer value formatters for the Hospital Management System (HMS)
 * React single-page application.
 *
 * This module centralizes how the SPA turns raw domain values — dates that come
 * back from the API as ISO-8601 strings or epoch milliseconds, monetary
 * amounts, plain numbers, and patient name / identifier fields — into the
 * human-readable strings shown in the UI. Keeping this logic in one place
 * guarantees a single, consistent presentation across every screen
 * (Appointments, Electronic Medical Records, Reports, Billing) and makes a
 * locale / currency / pattern change a one-file edit.
 *
 * Design contract — TOTALITY:
 *   Every exported formatter is *total*: it NEVER throws, regardless of input.
 *   Real API payloads are frequently partial (a `null` discharge date, a
 *   missing `lastName`, an amount that arrives as a string, and so on). Rather
 *   than letting a bad value crash a React render, each function degrades to a
 *   safe, empty presentation:
 *     - the date / time / currency / number / name helpers return `''`
 *     - the low-level {@link toDate} coercion returns `null`
 *   Callers can therefore render the result directly (e.g. `{formatDate(x)}`)
 *   with no defensive guards at the call site.
 *
 * Purity & dependencies:
 *   - Pure ESM JavaScript. **No JSX, no React, no `require`.** The only import
 *     is the tree-shakeable date-fns v3 package (declared as `date-fns@^3.6.0`
 *     in `frontend/package.json`). Currency and number formatting use the
 *     platform-native `Intl.NumberFormat`, so no extra dependency is needed and
 *     locale separators are never hard-coded.
 *   - No repository imports (this module does not import `constants.js`), no
 *     network calls, no secrets, and no import-time side effects — importing
 *     this file is a pure operation.
 *
 * Consumers (relative imports; this project uses no path aliases):
 *   - `components/` — shared table cells, chips, list items, detail panels.
 *   - `pages/Appointments` — visit dates and time slots.
 *   - `pages/EMR` (Electronic Medical Records) — record timestamps, patient
 *     name / ID headers.
 *   - `pages/Reports` — numeric aggregates and report generation dates.
 *   - `pages/Billing` — invoice / line-item currency amounts.
 *
 * @see 01_Hospital_Management_Product_Vision_and_Scope
 * @see 02_Hospital_Management_Functional_Requirements_Specification — patient
 *      identity / unique patient identifiers. This module normalizes IDs for
 *      *display* only; it never generates them.
 */

import { format, parseISO, isValid } from 'date-fns';

/* -------------------------------------------------------------------------- */
/* Phase 1 — Internal date coercion                                           */
/* -------------------------------------------------------------------------- */

/**
 * Coerce an arbitrary input into a valid {@link Date}, or `null` when the value
 * cannot represent a real calendar instant.
 *
 * This is the shared foundation for {@link formatDate}, {@link formatDateTime},
 * and {@link formatTime}: they all normalize their input through `toDate` first
 * so every date formatter accepts the same broad set of inputs and shares a
 * single definition of "valid". It is exported so tests and any caller that
 * needs a guaranteed-valid `Date` (or `null`) can reuse the exact same rules.
 *
 * Accepted inputs and how they resolve:
 *   - `null` / `undefined` / empty-or-whitespace string → `null` (nothing to
 *     show).
 *   - `Date` instance → returned as-is when it is a real date, else `null`
 *     (guards against `Invalid Date`, e.g. `new Date('nope')`).
 *   - `number` → treated as epoch **milliseconds**; only *finite* numbers are
 *     accepted (`NaN` / `Infinity` are numbers but never valid instants).
 *   - `string` → parsed as strict ISO-8601 via date-fns `parseISO`; if that is
 *     not valid it falls back to the engine's `new Date(str)` parser to also
 *     accept other recognizable formats (e.g. `'Jan 7, 2026'`).
 *   - any other type (boolean, plain object, array, symbol, …) → `null`.
 *
 * The whole body is wrapped in try/catch so the function is total and never
 * propagates a parsing error to the UI.
 *
 * @param {Date|string|number|null|undefined} value The raw value to coerce.
 * @returns {Date|null} A valid `Date`, or `null` when the input is missing or
 *   cannot be interpreted as a date.
 *
 * @example
 * toDate('2026-01-07');            // Date (2026-01-07T00:00:00)
 * toDate(1767744000000);           // Date (from epoch ms)
 * toDate(new Date('2026-01-07'));  // the same Date, echoed back
 * toDate('not-a-date');            // null
 * toDate(null);                    // null
 */
export function toDate(value) {
  try {
    // Explicit "no value" inputs: nothing to render.
    if (value === null || value === undefined) {
      return null;
    }

    // Already a Date — accept only if it represents a real instant
    // (rejects `Invalid Date`, e.g. from `new Date('nope')`).
    if (value instanceof Date) {
      return isValid(value) ? value : null;
    }

    // Epoch milliseconds. Only finite numbers can be a real timestamp;
    // NaN / Infinity are typeof 'number' but never valid dates.
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return null;
      }
      const fromEpoch = new Date(value);
      return isValid(fromEpoch) ? fromEpoch : null;
    }

    // Strings: prefer strict ISO-8601, then fall back to the engine's parser
    // for other recognizable formats. Whitespace-only strings count as empty.
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') {
        return null;
      }
      const iso = parseISO(trimmed);
      if (isValid(iso)) {
        return iso;
      }
      const loose = new Date(trimmed);
      return isValid(loose) ? loose : null;
    }

    // Booleans, plain objects, arrays, symbols, bigints, functions: no
    // meaningful date interpretation.
    return null;
  } catch {
    // Totality guarantee: any unexpected throw degrades to "no date".
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Phase 2 — Date / time formatters                                           */
/* -------------------------------------------------------------------------- */

/**
 * Format a value as a calendar date, e.g. `07 Jan 2026`.
 *
 * The input is coerced through {@link toDate}, so it accepts ISO-8601 strings,
 * epoch milliseconds, and `Date` instances. Invalid or missing input yields
 * `''` so the result is always safe to render.
 *
 * @param {Date|string|number|null|undefined} value The date to format.
 * @param {string} [pattern='dd MMM yyyy'] A date-fns format pattern. Override
 *   to change the display (e.g. `'yyyy-MM-dd'`, `'MMMM d, yyyy'`).
 * @returns {string} The formatted date, or `''` for invalid / missing input.
 *
 * @example
 * formatDate('2026-01-07');                 // '07 Jan 2026'
 * formatDate(new Date('2026-01-07'));       // '07 Jan 2026'
 * formatDate('2026-01-07', 'yyyy-MM-dd');   // '2026-01-07'
 * formatDate('not-a-date');                 // ''
 * formatDate(null);                         // ''
 */
export function formatDate(value, pattern = 'dd MMM yyyy') {
  const date = toDate(value);
  if (date === null) {
    return '';
  }
  try {
    return format(date, pattern);
  } catch {
    // An invalid / garbage pattern makes date-fns throw — degrade to ''.
    return '';
  }
}

/**
 * Format a value as a date **and** time, e.g. `07 Jan 2026, 14:30`.
 *
 * Time is rendered in 24-hour form by default. The input is coerced through
 * {@link toDate}; invalid or missing input yields `''`.
 *
 * @param {Date|string|number|null|undefined} value The date-time to format.
 * @param {string} [pattern='dd MMM yyyy, HH:mm'] A date-fns format pattern.
 * @returns {string} The formatted date-time, or `''` for invalid / missing
 *   input.
 *
 * @example
 * formatDateTime('2026-01-07T14:30:00');   // '07 Jan 2026, 14:30'
 * formatDateTime(null);                    // ''
 */
export function formatDateTime(value, pattern = 'dd MMM yyyy, HH:mm') {
  const date = toDate(value);
  if (date === null) {
    return '';
  }
  try {
    return format(date, pattern);
  } catch {
    return '';
  }
}

/**
 * Format a value as a time-of-day, e.g. `14:30`.
 *
 * 24-hour form by default. The input is coerced through {@link toDate};
 * invalid or missing input yields `''`.
 *
 * @param {Date|string|number|null|undefined} value The time to format.
 * @param {string} [pattern='HH:mm'] A date-fns format pattern (e.g. `'hh:mm a'`
 *   for 12-hour form with an AM/PM marker).
 * @returns {string} The formatted time, or `''` for invalid / missing input.
 *
 * @example
 * formatTime('2026-01-07T14:30:00');            // '14:30'
 * formatTime('2026-01-07T14:30:00', 'hh:mm a'); // '02:30 PM'
 * formatTime(null);                             // ''
 */

/* -------------------------------------------------------------------------- */
/* Phase 3 — Currency & number formatters (Intl)                              */
/* -------------------------------------------------------------------------- */

/**
 * Format a numeric amount as localized currency, e.g. `$1,234.50`.
 *
 * Uses the platform-native `Intl.NumberFormat`, so grouping and decimal
 * separators follow the requested locale and are never hard-coded.
 *
 * USD / `en-US` are the defaults because the HMS specifications (docs 01 & 02)
 * do not fix a single tenant currency; callers (e.g. the Billing screens) can
 * override the `currency` and `locale` per tenant or per user preference.
 *
 * Only finite numbers are formatted — a non-number or `NaN` / `Infinity`
 * yields `''`. An unsupported currency code makes `Intl` throw, which is caught
 * and also degrades to `''`.
 *
 * @param {number} amount The monetary amount (must be a finite number).
 * @param {string} [currency='USD'] An ISO-4217 currency code (e.g. `'EUR'`).
 * @param {string} [locale='en-US'] A BCP-47 locale tag (e.g. `'de-DE'`).
 * @returns {string} The formatted currency string, or `''` for invalid input.
 *
 * @example
 * formatCurrency(1234.5);                // '$1,234.50'
 * formatCurrency(1000, 'EUR', 'de-DE');  // '1.000,00 €'
 * formatCurrency('x');                   // ''
 * formatCurrency(NaN);                   // ''
 */
export function formatCurrency(amount, currency = 'USD', locale = 'en-US') {
  // Guard first: only real, finite numbers can be formatted as money.
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return '';
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    // An invalid currency code (or locale) makes Intl throw — degrade to ''.
    return '';
  }
}

/**
 * Format a number with localized grouping, e.g. `1,234,567`.
 *
 * A thin, safe wrapper over `Intl.NumberFormat`. Pass `options` to control
 * decimals, style, unit, and so on (any valid `Intl.NumberFormat` options
 * object). Only finite numbers are formatted; anything else yields `''`.
 *
 * @param {number} value The number to format (must be finite).
 * @param {string} [locale='en-US'] A BCP-47 locale tag.
 * @param {Intl.NumberFormatOptions} [options={}] `Intl.NumberFormat` options,
 *   e.g. `{ minimumFractionDigits: 2 }` or `{ style: 'percent' }`.
 * @returns {string} The formatted number, or `''` for invalid input.
 *
 * @example
 * formatNumber(1234567);                             // '1,234,567'
 * formatNumber(0.25, 'en-US', { style: 'percent' }); // '25%'
 * formatNumber(Infinity);                            // ''
 */
export function formatNumber(value, locale = 'en-US', options = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    // Invalid locale or options object — degrade to ''.
    return '';
  }
}

/* -------------------------------------------------------------------------- */
/* Phase 4 — Patient display helpers                                          */
/* -------------------------------------------------------------------------- */

/**
 * Build a patient's display name from either a record object or positional
 * first / last arguments.
 *
 * Two call styles are supported so the helper is convenient wherever patient
 * data appears:
 *   - Object form: `formatPatientName(patient)` reads `firstName` / `lastName`
 *     (the short `first` / `last` keys are also tolerated for lenient payloads).
 *   - Positional form: `formatPatientName(first, last)`.
 *
 * Each part is coerced to a string, trimmed, and dropped when empty; the kept
 * parts are joined with a single space and any internal whitespace runs are
 * collapsed. When nothing usable remains, returns `''`.
 *
 * @param {(string|number|{firstName?:string,lastName?:string,first?:string,last?:string}|null|undefined)} input
 *   Either a patient-like object, or the first name in the positional form.
 * @param {string|number} [last] The last name (positional form only; ignored
 *   when `input` is an object).
 * @returns {string} The formatted `"First Last"` name, or `''` when empty.
 *
 * @example
 * formatPatientName({ firstName: 'Ada', lastName: 'Lovelace' }); // 'Ada Lovelace'
 * formatPatientName('Ada', 'Lovelace');                          // 'Ada Lovelace'
 * formatPatientName({ first: 'Grace', last: 'Hopper' });         // 'Grace Hopper'
 * formatPatientName('Prince');                                   // 'Prince'
 * formatPatientName({});                                         // ''
 * formatPatientName(null);                                       // ''
 */
export function formatPatientName(input, last) {
  // Object form reads named fields; positional form uses the raw arguments.
  const isObject = input !== null && typeof input === 'object';
  const firstName = isObject ? (input.firstName ?? input.first) : input;
  const lastName = isObject ? (input.lastName ?? input.last) : last;

  return (
    [firstName, lastName]
      // Keep only stringifiable scalar parts (drops null / undefined / objects).
      .filter((part) => typeof part === 'string' || typeof part === 'number')
      .map((part) => String(part).trim())
      .filter((part) => part.length > 0)
      .join(' ')
      // Collapse any internal runs of whitespace down to a single space.
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Normalize a patient identifier for *display*, e.g. `PAT-000123`.
 *
 * This is presentation-only normalization, NOT ID generation: the canonical,
 * unique patient identifier is owned by the backend / database (see doc 02,
 * "unique patient identifiers"). This helper only makes an existing id render
 * consistently across the UI.
 *
 * Rules (deterministic):
 *   1. `null` / `undefined` / empty-after-trim → `''`.
 *   2. Already prefixed (case-insensitive `startsWith(prefix)`) → returned
 *      as-is (trimmed), so an id is never double-prefixed.
 *   3. A purely numeric id → zero-padded to a minimum width of 6 and prefixed,
 *      producing a stable, sortable label, e.g. `123` → `PAT-000123`. Numbers
 *      longer than 6 digits are kept in full (the padding is a minimum, not a
 *      cap).
 *   4. Any other non-empty token → prefixed verbatim, e.g. `'a1b2'` →
 *      `PAT-a1b2`.
 *
 * @param {string|number|null|undefined} id The raw patient identifier.
 * @param {string} [prefix='PAT'] The display prefix (e.g. `'MRN'`). Falls back
 *   to `'PAT'` when blank.
 * @returns {string} The normalized identifier, or `''` when there is no id.
 *
 * @example
 * formatPatientId(123);           // 'PAT-000123'
 * formatPatientId('123');         // 'PAT-000123'
 * formatPatientId('PAT-000123');  // 'PAT-000123' (unchanged)
 * formatPatientId('a1b2');        // 'PAT-a1b2'
 * formatPatientId(123, 'MRN');    // 'MRN-000123'
 * formatPatientId(null);          // ''
 */
export function formatPatientId(id, prefix = 'PAT') {
  // Rule 1 — nothing to display.
  if (id === null || id === undefined) {
    return '';
  }
  const raw = String(id).trim();
  if (raw === '') {
    return '';
  }

  // Normalize the prefix; fall back to the default when blank.
  const safePrefix = String(prefix ?? '').trim() || 'PAT';

  // Rule 2 — already prefixed (case-insensitive): keep the caller's value.
  if (raw.toLowerCase().startsWith(safePrefix.toLowerCase())) {
    return raw;
  }

  // Rule 3 — purely numeric: zero-pad to a minimum width of 6.
  if (/^\d+$/.test(raw)) {
    return `${safePrefix}-${raw.padStart(6, '0')}`;
  }

  // Rule 4 — any other token: prefix verbatim.
  return `${safePrefix}-${raw}`;
}

export function formatTime(value, pattern = 'HH:mm') {
  const date = toDate(value);
  if (date === null) {
    return '';
  }
  try {
    return format(date, pattern);
  } catch {
    return '';
  }
}
