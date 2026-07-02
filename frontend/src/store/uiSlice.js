/**
 * @file frontend/src/store/uiSlice.js
 * @module store/uiSlice
 *
 * Redux Toolkit (RTK) slice that owns the HMS SPA's **global, app-wide UI
 * state** — the cross-cutting presentation concerns that are not tied to any
 * single feature module. It is combined into the root store under the key
 * `ui` by the sibling `store/store.js`, so every field below is read from the
 * Redux tree as `state.ui.<field>`.
 *
 * Three concerns live here:
 *   1. `notification` — the single active snackbar/toast. `App.jsx` mounts one
 *      global snackbar host that reads `state.ui.notification` and dispatches
 *      `dismissNotification` when the toast closes.
 *   2. `sidebarOpen`  — the navigation Drawer open flag, toggled by
 *      `components/layout/AppLayout` via `toggleSidebar` / `setSidebarOpen`.
 *   3. `globalLoading` — the app-wide spinner flag consumed by
 *      `components/common/LoadingSpinner`, driven by `setGlobalLoading`.
 *
 * ---------------------------------------------------------------------------
 * DEPENDENCY DISCIPLINE — READ BEFORE ADDING IMPORTS
 * ---------------------------------------------------------------------------
 * This module imports ONLY from `@reduxjs/toolkit`. It deliberately does NOT
 * import `axios`, `react`, or anything under `../services`. Keeping the UI
 * slice free of the service layer keeps the store's dependency graph acyclic:
 * `services/apiClient` may safely `import` the store (e.g. to dispatch
 * `showNotification` from a request-error interceptor) without creating an
 * import cycle back through this slice.
 *
 * All state kept here is serializable (string / number / boolean / null /
 * plain object) so RTK's `serializableCheck` middleware stays quiet — the
 * notification `key` is a plain number (`Date.now()`), never a Date instance.
 *
 * @see 03_Hospital_Management_Technical_Architecture — React.js single-page
 *      application front end.
 */

import { createSlice } from '@reduxjs/toolkit';

/**
 * Valid MUI `<Alert>` severities, in ascending order of urgency.
 *
 * Used by {@link normalizeNotification} to validate an incoming `severity` and
 * fall back to `'info'` for anything outside this set. Frozen so the shared
 * vocabulary can never be mutated at runtime.
 *
 * @readonly
 * @constant
 * @type {ReadonlyArray<'success' | 'info' | 'warning' | 'error'>}
 */
const SEVERITIES = Object.freeze(['success', 'info', 'warning', 'error']);

/**
 * The normalized shape of the single active snackbar notification.
 *
 * @typedef {Object} UiNotification
 * @property {string} message   Human-readable snackbar text.
 * @property {'success' | 'info' | 'warning' | 'error'} severity
 *   MUI Alert severity; drives the toast colour/icon.
 * @property {number} [autoHideDuration]
 *   Optional auto-dismiss delay in milliseconds. `undefined` lets the snackbar
 *   host apply its own default timing.
 * @property {number} [key]
 *   Identity for the toast (defaults to `Date.now()`) so the host can re-mount
 *   and re-trigger on repeated, otherwise-identical messages.
 */

/**
 * Initial `state.ui` shape.
 *
 * @type {{
 *   notification: (UiNotification | null),
 *   sidebarOpen: boolean,
 *   globalLoading: boolean,
 * }}
 */
const initialState = {
  /** Active snackbar/toast descriptor, or `null` when nothing is showing. */
  notification: null,
  /**
   * Navigation Drawer open flag. Defaults to `true` (open) for the desktop
   * layout; `AppLayout` may collapse it on small viewports at runtime.
   */
  sidebarOpen: true,
  /** App-wide loading flag backing the global `LoadingSpinner`. */
  globalLoading: false,
};

/**
 * Coerce an arbitrary notification payload into a normalized
 * {@link UiNotification}, or `null` when the payload carries no usable message.
 *
 * Accepted inputs:
 *   - a non-empty string → `{ message, severity: 'info' }`;
 *   - a descriptor object with a usable `message` → the full notification, with
 *     `severity` validated against {@link SEVERITIES} (falling back to
 *     `'info'`), a numeric `autoHideDuration` passed through (else `undefined`),
 *     and a `key` defaulting to `Date.now()`;
 *   - anything else (number, boolean, `null`, `undefined`, an empty string, or
 *     an object without a usable message) → `null`.
 *
 * Returning `null` lets the reducers ignore empty/invalid payloads instead of
 * clobbering the active notification with something unrenderable.
 *
 * @param {(string
 *   | { message?: unknown, severity?: unknown, autoHideDuration?: unknown,
 *       key?: unknown }
 *   | null
 *   | undefined)} payload The raw notification payload from an action.
 * @returns {UiNotification | null} The normalized notification, or `null`.
 */
function normalizeNotification(payload) {
  // A bare, non-empty string is shorthand for an info-level toast.
  if (typeof payload === 'string') {
    return payload.length > 0 ? { message: payload, severity: 'info' } : null;
  }

  // A descriptor object must carry a usable (non-empty) message to render.
  if (payload && typeof payload === 'object') {
    const { message } = payload;
    if (
      message === undefined ||
      message === null ||
      String(message).length === 0
    ) {
      return null;
    }

    return {
      message: String(message),
      severity: SEVERITIES.includes(payload.severity)
        ? payload.severity
        : 'info',
      autoHideDuration:
        typeof payload.autoHideDuration === 'number'
          ? payload.autoHideDuration
          : undefined,
      // A default identity lets the snackbar host re-mount (and thus re-show)
      // on repeated, identical messages; callers may pass an explicit stable
      // `key` to intentionally de-duplicate/replace an existing toast.
      key: payload.key ?? Date.now(),
    };
  }

  // Numbers, booleans, null/undefined, empty strings → nothing to show.
  return null;
}

/**
 * The `ui` slice — global, app-wide presentation state. Reducers use RTK's
 * Immer integration, so the "mutating" assignments below produce correct,
 * immutable state updates under the hood.
 */
const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    /**
     * Show a snackbar. The payload may be a plain string or a
     * `{ message, severity, autoHideDuration }` descriptor. Payloads that
     * normalize to `null` (empty/invalid) are ignored, so the active
     * notification is never clobbered by an unrenderable one.
     *
     * @param {typeof initialState} state
     * @param {{ payload: unknown }} action
     */
    showNotification(state, action) {
      const next = normalizeNotification(action.payload);
      if (next !== null) {
        state.notification = next;
      }
    },

    /**
     * Alias of {@link showNotification}. This slice intentionally keeps a
     * SINGLE active notification (last-wins): enqueuing simply replaces the
     * currently displayed toast. `enqueueNotification` is provided as an alias
     * for API symmetry with the AAP naming. A future enhancement could
     * implement a true FIFO queue if concurrent toasts are ever required.
     *
     * @param {typeof initialState} state
     * @param {{ payload: unknown }} action
     */
    enqueueNotification(state, action) {
      const next = normalizeNotification(action.payload);
      if (next !== null) {
        state.notification = next;
      }
    },

    /**
     * Clear the active snackbar. This is the action `App.jsx`'s snackbar host
     * dispatches when the toast closes (auto-hide timeout or user dismiss).
     *
     * @param {typeof initialState} state
     */
    dismissNotification(state) {
      state.notification = null;
    },

    /**
     * Alias of {@link dismissNotification}, exported for naming flexibility
     * across consumers. Clears the active snackbar.
     *
     * @param {typeof initialState} state
     */
    clearNotification(state) {
      state.notification = null;
    },

    /**
     * Toggle the navigation Drawer open/closed.
     *
     * @param {typeof initialState} state
     */
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },

    /**
     * Explicitly set the navigation Drawer open flag (coerced to a boolean).
     *
     * @param {typeof initialState} state
     * @param {{ payload: unknown }} action
     */
    setSidebarOpen(state, action) {
      state.sidebarOpen = Boolean(action.payload);
    },

    /**
     * Set the app-wide loading flag (coerced to a boolean). Drives the global
     * `LoadingSpinner`.
     *
     * @param {typeof initialState} state
     * @param {{ payload: unknown }} action
     */
    setGlobalLoading(state, action) {
      state.globalLoading = Boolean(action.payload);
    },
  },
});

/**
 * Action creators for the `ui` slice. Consumed by `App.jsx` (show/dismiss),
 * `components/layout/AppLayout` (toggle/set sidebar),
 * `components/common/LoadingSpinner` (via `setGlobalLoading`), and any feature
 * code that needs to raise a toast or drive the global spinner.
 */
export const {
  showNotification,
  enqueueNotification,
  dismissNotification,
  clearNotification,
  toggleSidebar,
  setSidebarOpen,
  setGlobalLoading,
} = uiSlice.actions;

/**
 * Selector: the active snackbar notification, or `null` when none is showing.
 *
 * @param {{ ui: typeof initialState }} state Root Redux state.
 * @returns {UiNotification | null}
 */
export const selectNotification = (state) => state.ui.notification;

/**
 * Selector: whether the navigation Drawer is currently open.
 *
 * @param {{ ui: typeof initialState }} state Root Redux state.
 * @returns {boolean}
 */
export const selectSidebarOpen = (state) => state.ui.sidebarOpen;

/**
 * Selector: whether the app-wide loading spinner is active.
 *
 * @param {{ ui: typeof initialState }} state Root Redux state.
 * @returns {boolean}
 */
export const selectGlobalLoading = (state) => state.ui.globalLoading;

/**
 * The `ui` reducer. Imported by `store/store.js` as `uiReducer` and mounted
 * under the root `ui` key (`state.ui`).
 */
export default uiSlice.reducer;
