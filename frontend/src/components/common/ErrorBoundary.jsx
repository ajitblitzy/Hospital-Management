/**
 * @file frontend/src/components/common/ErrorBoundary.jsx
 * @module components/common/ErrorBoundary
 *
 * Application-wide React error boundary for the Hospital Management System
 * (HMS) single-page application (React 18 + Vite).
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * React reacts to an uncaught error thrown while rendering, in a lifecycle
 * method, or in a constructor anywhere in the child tree by UNMOUNTING that
 * whole tree. Without a boundary that leaves the user staring at a blank white
 * screen. An *error boundary* is the only React mechanism able to intercept
 * those errors and render a graceful fallback instead. This component is the
 * outermost safety net for the SPA (see doc 03 — "resilient React
 * architecture"): `App.jsx` wraps the entire application in a single
 * `<ErrorBoundary>` so any unexpected crash degrades to a friendly, actionable
 * message rather than a broken page.
 *
 * WHY A CLASS COMPONENT
 * ---------------------------------------------------------------------------
 * Error boundaries REQUIRE the class-only lifecycle methods
 * `static getDerivedStateFromError()` and/or `componentDidCatch()`. React
 * provides NO hooks-based equivalent, so this component intentionally remains a
 * class extending `Component`. Do not convert it to a function component.
 *
 * DESIGN CONSTRAINTS (per the Agent Action Plan)
 * ---------------------------------------------------------------------------
 *   • Store-decoupled — this boundary deliberately does NOT import the Redux
 *     store, services, or any app module. If a deep provider (store, router,
 *     theme, data layer) is the thing that failed, the boundary must still be
 *     able to render. Its only dependencies are React and Material UI.
 *   • MUI v5 is the SOLE design system. The fallback UI is styled exclusively
 *     through the `sx` prop and theme palette tokens (e.g. `background.default`,
 *     `text.secondary`) — no hardcoded colors and no CSS files.
 *   • Diagnostics only — `componentDidCatch` logs to `console.error`; it does
 *     not dispatch to the store or perform network calls (either would
 *     reintroduce the coupling this boundary exists to avoid).
 *
 * USAGE
 * ---------------------------------------------------------------------------
 *   // Default fallback (wraps the whole app):
 *   import ErrorBoundary from './components/common/ErrorBoundary';
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 *
 *   // Custom fallback element:
 *   <ErrorBoundary fallback={<MyFallback />}>...</ErrorBoundary>
 *
 *   // Custom fallback render function (receives the caught error + a reset fn):
 *   <ErrorBoundary
 *     fallback={({ error, reset }) => (
 *       <MyFallback error={error} onRetry={reset} />
 *     )}
 *   >
 *     ...
 *   </ErrorBoundary>
 *
 * This module is plain ESM JSX (the frontend package is `"type": "module"`). It
 * relies on the automatic JSX runtime, so it imports ONLY the named `Component`
 * API from React — never the React default export. There is no TypeScript and
 * no PropTypes in this project.
 */

import { Component } from 'react';
import { Box, Container, Typography, Button, Stack } from '@mui/material';

/**
 * `ErrorBoundary` — catches render/lifecycle errors in its descendant tree and
 * renders a fallback UI instead of crashing the entire SPA to a blank screen.
 *
 * Props:
 *   - `children` {React.ReactNode} — the subtree to protect. While no error has
 *     been caught, `children` are rendered untouched (transparent passthrough).
 *   - `fallback` {React.ReactNode | (ctx: { error: Error, reset: () => void })
 *       => React.ReactNode} — OPTIONAL. Overrides the built-in fallback UI.
 *     Accepts either a ready-made React element or a render function that
 *     receives the caught `error` plus a `reset` callback (so a custom fallback
 *     can provide its own recovery affordance). When omitted, the default
 *     centered Material UI alert panel is shown.
 *
 * @extends {Component}
 */
class ErrorBoundary extends Component {
  /**
   * Local, store-free component state.
   *   - `hasError` flips to `true` once a descendant throws, switching render()
   *     from the children passthrough to the fallback UI.
   *   - `error` retains the caught error so it can be surfaced to a custom
   *     `fallback` render function (and remains available for diagnostics).
   *
   * Declared as a class field (the frontend targets modern ESM/Vite, so class
   * fields are fully supported and avoid a boilerplate constructor).
   *
   * @type {{ hasError: boolean, error: (Error|null) }}
   */
  state = { hasError: false, error: null };

  /**
   * React lifecycle: runs during the "render" phase after a descendant throws.
   * It must be pure (no side effects) and may only return the next state. By
   * returning `{ hasError: true }` it schedules a re-render that shows the
   * fallback UI; the caught `error` is stored for a custom fallback to display.
   *
   * @param {Error} error - the error thrown by a descendant component.
   * @returns {{ hasError: boolean, error: Error }} the next state slice.
   */
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  /**
   * React lifecycle: runs during the "commit" phase after a descendant throws.
   * This is the correct place for SIDE EFFECTS such as logging. We log to
   * `console.error` for local diagnostics only — deliberately NOT dispatching
   * to the store or hitting the network, so the boundary stays decoupled and
   * can still render even when those layers are what failed.
   *
   * @param {Error} error - the error thrown by a descendant component.
   * @param {{ componentStack?: string }} info - React's error info object; its
   *   `componentStack` is a human-readable trace of which components were
   *   rendering when the error was thrown.
   * @returns {void}
   */
  componentDidCatch(error, info) {
    // Diagnostics only. `info` can be undefined on some runtime/test paths, so
    // read `componentStack` defensively via optional chaining.
    console.error('ErrorBoundary caught an error:', error, info?.componentStack);
  }

  /**
   * Recovery handler backing the fallback UI's primary action. Clearing the
   * error state makes the next render attempt the children passthrough again,
   * re-mounting the previously-unmounted subtree. If the underlying problem was
   * transient this recovers the app in place; if it is still broken the
   * boundary simply catches again and re-shows the fallback (the user can retry
   * as many times as needed).
   *
   * Defined as an arrow class field so `this` is bound to the instance without
   * a manual constructor `bind` — safe to pass directly as an `onClick` handler
   * and to hand to custom `fallback` render functions as `reset`.
   *
   * @returns {void}
   */
  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  /**
   * Render the protected children (happy path) or a fallback UI once an error
   * has been caught.
   *
   * @returns {React.ReactNode}
   */
  render() {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    // Happy path: nothing has thrown — render the protected subtree untouched.
    if (!hasError) {
      return children;
    }

    // A consumer-supplied fallback takes precedence over the built-in UI. We
    // support BOTH a ready-made element and a render function that receives the
    // caught error plus the reset callback.
    if (fallback !== undefined && fallback !== null) {
      return typeof fallback === 'function'
        ? fallback({ error, reset: this.handleReset })
        : fallback;
    }

    // Default fallback: a full-viewport, centered Material UI "alert" panel.
    // `role="alert"` announces the message to assistive technology. Every color
    // comes from theme palette tokens (no hardcoded hex) so the fallback tracks
    // the application theme automatically.
    return (
      <Box
        role="alert"
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
          p: 2,
        }}
      >
        <Container maxWidth="sm">
          <Stack spacing={2} alignItems="center" textAlign="center">
            <Typography variant="h4" component="h1" color="text.primary">
              Something went wrong
            </Typography>
            <Typography variant="body1" color="text.secondary">
              An unexpected error occurred. Please try again. If the problem
              persists, contact your administrator.
            </Typography>
            <Button
              variant="contained"
              color="primary"
              onClick={this.handleReset}
            >
              Try again
            </Button>
          </Stack>
        </Container>
      </Box>
    );
  }
}

export default ErrorBoundary;
