/**
 * @file frontend/src/store/uiSlice.test.js
 * @module store/uiSlice.test
 *
 * Vitest unit tests that lock the behavior of the `ui` Redux Toolkit slice
 * (`./uiSlice.js`): notification normalization, sidebar toggling, and the
 * app-wide loading flag, plus the three read selectors.
 *
 * ---------------------------------------------------------------------------
 * DESIGN NOTES
 * ---------------------------------------------------------------------------
 *   - Pure ESM, NO JSX, NO DOM access. Every case is exercised as a pure
 *     reducer call `uiReducer(previousState, action)` and asserts on the
 *     returned next state, so the suite is deterministic and needs neither the
 *     jsdom environment nor the project's `vitest.setup.js` polyfills.
 *   - The Vitest primitives are imported explicitly from `vitest` (rather than
 *     leaning on the harness `globals: true` setting) so this file is
 *     self-describing and robust regardless of the global configuration — the
 *     same convention the sibling component tests follow.
 *   - A notification built from an *object* payload carries a
 *     non-deterministic `key: Date.now()` (and `autoHideDuration: undefined`);
 *     those cases assert on individual, stable properties (`message` /
 *     `severity`) rather than a whole-object `toEqual`. The default state
 *     (notification `null`) is stable and is asserted with `toEqual`.
 *   - No mutable state is shared between tests: each derives its own state from
 *     `undefined` (the slice's initial state) or from a locally-built prior
 *     state, and RTK/Immer returns a fresh, frozen object from every dispatch.
 *
 * @see ./uiSlice.js  The slice under test.
 */

import { describe, it, expect } from 'vitest';
import uiReducer, {
  showNotification,
  enqueueNotification,
  dismissNotification,
  clearNotification,
  toggleSidebar,
  setSidebarOpen,
  setGlobalLoading,
  selectNotification,
  selectSidebarOpen,
  selectGlobalLoading,
} from './uiSlice';

describe('uiSlice — initial / default state', () => {
  it('returns the canonical default state for an unknown init action', () => {
    // `undefined` previous state forces the reducer to seed `initialState`.
    const state = uiReducer(undefined, { type: '@@INIT' });

    expect(state).toEqual({
      notification: null,
      sidebarOpen: true,
      globalLoading: false,
    });
  });
});

describe('uiSlice — notifications', () => {
  it('treats a non-empty string payload as an info-level toast', () => {
    const state = uiReducer(undefined, showNotification('Saved'));

    expect(state.notification).not.toBeNull();
    expect(state.notification.message).toBe('Saved');
    // A bare string carries no explicit severity, so it defaults to `info`.
    expect(state.notification.severity).toBe('info');
  });

  it('honors an explicit message and severity from an object payload', () => {
    const state = uiReducer(
      undefined,
      showNotification({ message: 'Failed', severity: 'error' }),
    );

    expect(state.notification.message).toBe('Failed');
    expect(state.notification.severity).toBe('error');
  });

  it('coerces an unknown severity back to "info"', () => {
    const state = uiReducer(
      undefined,
      showNotification({ message: 'x', severity: 'bogus' }),
    );

    expect(state.notification.message).toBe('x');
    // `bogus` is not in the allowed severities, so it falls back to `info`.
    expect(state.notification.severity).toBe('info');
  });

  it('ignores empty or unusable payloads and leaves notification null', () => {
    // Object payload with no `message` → nothing renderable to show.
    const fromEmptyObject = uiReducer(undefined, showNotification({}));
    expect(fromEmptyObject.notification).toBeNull();

    // Empty string → nothing to show.
    const fromEmptyString = uiReducer(undefined, showNotification(''));
    expect(fromEmptyString.notification).toBeNull();

    // Explicit `undefined` payload → nothing to show.
    const fromUndefined = uiReducer(undefined, showNotification(undefined));
    expect(fromUndefined.notification).toBeNull();

    // A non-string / non-object payload also normalizes to null.
    const fromNumber = uiReducer(undefined, showNotification(42));
    expect(fromNumber.notification).toBeNull();
  });

  it('enqueueNotification behaves identically to showNotification', () => {
    const state = uiReducer(undefined, enqueueNotification('Hi'));

    expect(state.notification.message).toBe('Hi');
    expect(state.notification.severity).toBe('info');
  });

  it('dismissNotification clears an active notification', () => {
    const active = uiReducer(undefined, showNotification('Active toast'));
    expect(active.notification).not.toBeNull();

    const cleared = uiReducer(active, dismissNotification());
    expect(cleared.notification).toBeNull();
  });

  it('clearNotification (alias) clears an active notification', () => {
    const active = uiReducer(undefined, showNotification('Active toast'));
    expect(active.notification).not.toBeNull();

    const cleared = uiReducer(active, clearNotification());
    expect(cleared.notification).toBeNull();
  });
});

describe('uiSlice — sidebar', () => {
  it('toggleSidebar flips the flag and toggles back', () => {
    // Default state has `sidebarOpen: true`; the first toggle closes it.
    const closed = uiReducer(undefined, toggleSidebar());
    expect(closed.sidebarOpen).toBe(false);

    // Toggling the closed state re-opens it.
    const reopened = uiReducer(closed, toggleSidebar());
    expect(reopened.sidebarOpen).toBe(true);
  });

  it('setSidebarOpen coerces its payload to a boolean', () => {
    expect(uiReducer(undefined, setSidebarOpen(false)).sidebarOpen).toBe(false);
    expect(uiReducer(undefined, setSidebarOpen(true)).sidebarOpen).toBe(true);
    // Truthy non-boolean (`1`) is coerced to `true`.
    expect(uiReducer(undefined, setSidebarOpen(1)).sidebarOpen).toBe(true);
  });
});

describe('uiSlice — global loading', () => {
  it('setGlobalLoading coerces its payload to a boolean', () => {
    const turnedOn = uiReducer(undefined, setGlobalLoading(true));
    expect(turnedOn.globalLoading).toBe(true);

    const turnedOff = uiReducer(undefined, setGlobalLoading(false));
    expect(turnedOff.globalLoading).toBe(false);

    // Falsy non-boolean (empty string) is coerced to `false`.
    const coerced = uiReducer(undefined, setGlobalLoading(''));
    expect(coerced.globalLoading).toBe(false);
  });
});

describe('uiSlice — selectors', () => {
  it('read their slices off the composed root state', () => {
    const root = {
      ui: uiReducer(
        undefined,
        showNotification({ message: 'Yo', severity: 'success' }),
      ),
    };

    expect(selectNotification(root).message).toBe('Yo');
    // `success` is a valid severity and is preserved unchanged.
    expect(selectNotification(root).severity).toBe('success');
    expect(selectSidebarOpen(root)).toBe(true);
    expect(selectGlobalLoading(root)).toBe(false);
  });
});
