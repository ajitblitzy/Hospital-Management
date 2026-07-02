/**
 * @file frontend/src/components/common/ErrorBoundary.test.jsx
 * @module components/common/ErrorBoundary.test
 *
 * Unit tests for the application-wide
 * {@link module:components/common/ErrorBoundary ErrorBoundary} React class
 * error boundary (see doc 05 — "QA, Testing & DevOps Strategy", Unit Testing).
 * The boundary is the outermost safety net for the HMS single-page app: it
 * catches render/lifecycle errors thrown anywhere in its descendant tree and
 * swaps the crashed subtree for a graceful Material UI fallback instead of
 * React's default "blank white screen".
 *
 * TESTING APPROACH
 * ---------------------------------------------------------------------------
 * An error boundary can ONLY be exercised by actually throwing during the
 * render of a child — there is no public API to force the caught-error state
 * directly. Every case therefore renders a small local `Boom` child that
 * throws on demand. React reports boundary-caught errors through
 * `console.error` (once from its dev-mode reporter and once from this
 * boundary's own `componentDidCatch`), so `console.error` is spied and
 * silenced per test to keep the run output clean while still allowing an
 * assertion on the boundary's own diagnostic log.
 *
 * The suite is intentionally self-contained and mirrors the sibling specs in
 * this folder: test hooks are imported explicitly from `vitest`, jest-dom's
 * matchers are registered through the `@testing-library/jest-dom/vitest` entry
 * (which extends Vitest's `expect` regardless of the project's `globals`
 * setting), and `cleanup()` runs after every case so the several render trees
 * never leak across tests. Per the component's design contract the boundary is
 * standalone (no Redux store, router, or theme coupling), so — unlike the
 * theme-consuming siblings — renders here are deliberately NOT wrapped in a
 * `ThemeProvider`; the default fallback resolves its palette tokens from MUI's
 * built-in default theme. Assertions target the stable accessible contract
 * (`role="alert"` + the heading text) rather than internal MUI markup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import ErrorBoundary from './ErrorBoundary';

/**
 * Minimal child used to drive the boundary. When `shouldThrow` is truthy it
 * throws during render (the only way to trip a React error boundary);
 * otherwise it renders a stable, queryable marker. Kept local to this file and
 * intentionally NOT exported — it is a test fixture, not shared production
 * surface.
 *
 * @param {{ shouldThrow?: boolean }} props
 * @returns {JSX.Element}
 */
function Boom({ shouldThrow }) {
  if (shouldThrow) {
    throw new Error('Boom!');
  }

  return <div>Safe child content</div>;
}

describe('ErrorBoundary', () => {
  // Handle to the per-test console.error spy. React reports boundary-caught
  // errors through console.error; silencing it keeps test output clean, and
  // retaining the handle lets the diagnostics case assert on the boundary's
  // own log call.
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Unmount rendered trees FIRST (while the spy is still active, so any
    // teardown logging stays silenced), then restore console.error and every
    // other mock created during the test.
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders its children untouched when no descendant throws', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );

    // Happy path: the protected subtree is rendered transparently...
    expect(screen.getByText('Safe child content')).toBeInTheDocument();
    // ...the fallback UI is never mounted...
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // ...and nothing is reported to console.error.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('renders the default Material UI fallback when a child throws during render', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    // The default fallback exposes a stable, accessible contract: an alert
    // region carrying the "Something went wrong" heading.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('renders a recovery button in the default fallback, and clicking it does not crash', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    // The default fallback offers exactly one primary action (the recovery
    // button).
    const recoveryButton = screen.getByRole('button');
    expect(recoveryButton).toBeInTheDocument();

    // Triggering recovery must never crash the boundary itself. We deliberately
    // do NOT assert on the post-click DOM (or on window.location.reload): a
    // reset-based strategy re-renders the children — which throw again — while
    // a reload-based strategy would not change the jsdom document at all, so
    // "does not throw" is the only contract stable across either approach.
    expect(() => fireEvent.click(recoveryButton)).not.toThrow();
  });

  it('honors a custom element `fallback` prop and suppresses the default fallback', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    // A consumer-supplied fallback takes precedence over the built-in UI...
    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
    // ...so the default "Something went wrong" panel must NOT be rendered.
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it('logs the caught error via componentDidCatch', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    // The boundary's componentDidCatch performs diagnostics-only logging. React
    // also emits its own report, so isolate the boundary's specific call by its
    // stable prefix rather than relying on a bare call count.
    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedByBoundary = consoleErrorSpy.mock.calls.some(
      (args) => args[0] === 'ErrorBoundary caught an error:',
    );
    expect(loggedByBoundary).toBe(true);
  });
});
