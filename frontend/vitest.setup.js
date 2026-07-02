/**
 * Vitest global setup file — HMS Frontend component unit tests.
 *
 * This module is wired into the test runner through `vite.config.js`
 * (`test.setupFiles: './vitest.setup.js'`) and is imported ONCE before every
 * test file in the `@hms/frontend` workspace. It is intentionally
 * side-effect-only: it registers custom assertion matchers, guarantees DOM
 * isolation between tests, and polyfills the handful of browser APIs that
 * jsdom does not implement but that our UI stack (Material UI + Recharts)
 * relies on at render time.
 *
 * Why each piece exists:
 *  - `@testing-library/jest-dom` augments the runner's `expect` with
 *    DOM-aware matchers such as `toBeInTheDocument` and `toHaveTextContent`,
 *    which our component specs assert against.
 *  - React Testing Library `cleanup()` unmounts anything rendered during a
 *    test so mounted trees, event listeners, and portals do not leak into the
 *    next test and cause false positives/negatives.
 *  - jsdom (the DOM used by Vitest's `jsdom` environment) omits
 *    `matchMedia`, `ResizeObserver`, and `IntersectionObserver`, and its
 *    `scrollTo` throws "Not implemented". MUI's responsive utilities
 *    (`useMediaQuery`, breakpoints), MUI X DataGrid, and Recharts'
 *    `ResponsiveContainer` all touch these APIs during render — without the
 *    polyfills below, rendering those components throws
 *    (e.g. "matchMedia is not a function" / "ResizeObserver is not defined").
 *
 * Rules honored here:
 *  - ESM syntax only (the package is `"type": "module"`); no `require`.
 *  - Self-contained and side-effect-only — nothing is exported.
 *  - No network calls and no application code is imported.
 */

// Registers jest-dom's custom matchers (e.g. `toBeInTheDocument`,
// `toHaveTextContent`) on the active `expect`. Import for side effects only.
import '@testing-library/jest-dom';

// React Testing Library's imperative DOM teardown helper.
import { cleanup } from '@testing-library/react';

// Vitest lifecycle hook + mocking utility used to build the polyfills below.
import { afterEach, vi } from 'vitest';

/**
 * Unmount React trees and clear the jsdom document after every test.
 *
 * This prevents cross-test DOM leakage: without it, elements rendered in one
 * test remain in `document.body` and can satisfy (or break) queries in the
 * next test. It is safe to call explicitly even though @testing-library/react
 * v16 also auto-cleans when a global `afterEach` is present — `cleanup()` is
 * idempotent.
 */
afterEach(() => {
  cleanup();
});

/**
 * Polyfill `window.matchMedia`.
 *
 * jsdom does not implement `matchMedia`, yet MUI's `useMediaQuery` hook and
 * responsive breakpoint logic call it during render. The mock returns a
 * MediaQueryList-shaped object that always reports `matches: false` (i.e. the
 * query does not currently apply), which yields deterministic, desktop-first
 * rendering in tests. Both the legacy (`addListener`/`removeListener`) and the
 * modern (`addEventListener`/`removeEventListener`/`dispatchEvent`) listener
 * APIs are provided as no-op spies so consumers can subscribe without error.
 *
 * `writable: true` allows individual tests to override this mock (for example
 * to simulate a matching media query) via reassignment or `vi.spyOn`.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    // Deprecated MediaQueryList API — retained for older MUI/consumer code paths.
    addListener: vi.fn(),
    removeListener: vi.fn(),
    // Standard EventTarget-style API.
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

/**
 * Polyfill `ResizeObserver`.
 *
 * Not implemented by jsdom but instantiated by MUI X DataGrid and Recharts'
 * `ResponsiveContainer` to react to element size changes. The mock accepts the
 * observer callback (as the real constructor does) and exposes no-op
 * `observe`/`unobserve`/`disconnect` methods so components can register and
 * tear down observers without triggering "ResizeObserver is not defined".
 */
class ResizeObserverMock {
  constructor(callback) {
    // The callback is accepted to match the real constructor signature; it is
    // intentionally never invoked because jsdom performs no layout.
    this.callback = callback;
  }

  observe() {}

  unobserve() {}

  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock;

/**
 * Polyfill `IntersectionObserver`.
 *
 * Not implemented by jsdom but used by some MUI components and lazy/on-view
 * loading utilities. The mock mirrors the constructor signature
 * (`callback`, `options`), exposes read-only-style spec fields that some
 * consumers read (`root`, `rootMargin`, `thresholds`), provides no-op
 * `observe`/`unobserve`/`disconnect`, and returns an empty entry list from
 * `takeRecords()`.
 */
class IntersectionObserverMock {
  constructor(callback, options = {}) {
    this.callback = callback;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? '';
    // Normalize `threshold` (number | number[]) into the spec's `thresholds` array.
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
  }

  observe() {}

  unobserve() {}

  disconnect() {}

  takeRecords() {
    return [];
  }
}

global.IntersectionObserver = IntersectionObserverMock;

/**
 * Polyfill `window.scrollTo`.
 *
 * jsdom implements `scrollTo` as a stub that logs a "Not implemented" error to
 * the console whenever components (e.g. dialogs, routers, virtualized lists)
 * attempt to scroll. Replacing it with a no-op spy keeps test output clean and
 * lets tests assert scroll behavior if needed.
 */
window.scrollTo = vi.fn();
