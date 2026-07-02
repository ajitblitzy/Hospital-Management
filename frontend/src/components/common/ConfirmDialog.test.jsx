/**
 * @file frontend/src/components/common/ConfirmDialog.test.jsx
 * @module components/common/ConfirmDialog.test
 *
 * Vitest + React Testing Library unit tests for the controlled, presentational
 * ConfirmDialog modal (doc 05 "QA / Testing & DevOps Strategy"). ConfirmDialog
 * owns no business state, so this suite targets exactly what can regress:
 * open/closed rendering, the title + body content, prop -> callback wiring
 * (onConfirm, and the onCancel / onClose dual-name cancel path), the message vs
 * children body switch, and the loading disabled state.
 *
 * These tests run in the project's standard frontend test environment (jsdom +
 * the automatic JSX runtime provided by the Vite React plugin), exactly like
 * the sibling common-component suites (ChartCard, DataTable). As in the
 * component source, the automatic JSX runtime means React is intentionally NOT
 * imported here.
 *
 * Robustness choices (independent of the project's Vitest `globals` setting):
 *   - Importing '@testing-library/jest-dom/vitest' registers the DOM matchers
 *     (toBeInTheDocument, toBeDisabled, toHaveClass, ...) directly onto Vitest's
 *     expect, so the assertions work whether or not a shared setup file also
 *     registers them and whether or not `globals` is enabled.
 *   - Test hooks are imported explicitly from 'vitest' and cleanup() runs after
 *     every test, so the suite stays isolated regardless of how Vitest is
 *     invoked (a redundant auto-cleanup is a harmless no-op).
 *
 * MUI <Dialog> renders its content into a portal on document.body, so queries
 * use screen.* (whole-document) and buttons are matched by accessible name
 * (getByRole('button', { name: /.../i })), which is robust to internal markup.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import ConfirmDialog from './ConfirmDialog';

// Unmount rendered trees and clear the MUI portal between tests so repeated
// titles/labels never collide across cases.
afterEach(() => {
  cleanup();
});

describe('ConfirmDialog', () => {
  // --- Checklist #1: renders title + message when open -----------------------
  it('renders the title and string message when open', () => {
    render(
      <ConfirmDialog
        open
        title="Delete patient?"
        message="This cannot be undone."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText('Delete patient?')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  // --- Checklist #2: does not render content when closed ----------------------
  it('does not render any content when open is false', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Hidden"
        message="Nope"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    // MUI Dialog unmounts its portal when closed (keepMounted is not set), so
    // neither the title, the body, nor the dialog role is in the document.
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.queryByText('Nope')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // --- Checklist #3: Confirm click calls onConfirm ----------------------------
  it('calls onConfirm exactly once when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        message="M"
        confirmText="Delete"
        confirmColor="error"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // --- Checklist #4: Cancel click calls onCancel ------------------------------
  it('calls onCancel exactly once when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        message="M"
        cancelText="Cancel"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // --- Checklist #5: onClose alias works when onCancel is absent --------------
  it('falls back to onClose for the cancel path when onCancel is absent', () => {
    // Real consumer requirement: page dialogs pass `onCancel`, while MUI-style
    // callers (e.g. auth/SessionTimeout) pass `onClose`. Both must dismiss.
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        message="M"
        onConfirm={() => {}}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // --- Checklist #6: loading disables both buttons ----------------------------
  it('disables both buttons and shows a spinner while loading', () => {
    render(
      <ConfirmDialog
        open
        title="T"
        message="M"
        confirmText="Confirm"
        cancelText="Cancel"
        loading
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    // The CircularProgress inside the confirm button surfaces as a progressbar.
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  // --- Checklist #7 (optional): children body instead of message --------------
  it('renders rich children when no message prop is provided', () => {
    render(
      <ConfirmDialog open title="T" onConfirm={() => {}} onCancel={() => {}}>
        <div>Custom body</div>
      </ConfirmDialog>,
    );

    expect(screen.getByText('Custom body')).toBeInTheDocument();
  });

  // --- Extra: disabled buttons swallow clicks while loading -------------------
  it('does not invoke onConfirm/onCancel while loading (buttons disabled)', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="T"
        message="M"
        loading
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  // --- Extra: custom labels (auth/SessionTimeout idle-logout scenario) --------
  it('renders custom confirm/cancel labels (idle-logout scenario)', () => {
    render(
      <ConfirmDialog
        open
        title="Still there?"
        message="You will be logged out due to inactivity."
        confirmText="Stay signed in"
        cancelText="Log out"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(
      screen.getByRole('button', { name: /stay signed in/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /log out/i }),
    ).toBeInTheDocument();
  });

  // --- Extra: destructive confirm renders MUI contained-error styling ---------
  it('renders a destructive confirm button when confirmColor="error"', () => {
    render(
      <ConfirmDialog
        open
        title="T"
        message="M"
        confirmColor="error"
        confirmText="Delete"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: /delete/i });
    expect(confirmButton).toBeEnabled();
    // MUI encodes variant + color into the button's class list.
    expect(confirmButton).toHaveClass('MuiButton-containedError');
  });

  // --- Extra: cancel is safe even when no cancel handler is supplied ----------
  it('does not throw when cancel is clicked without any cancel handler', () => {
    // ConfirmDialog collapses onCancel/onClose to a no-op fallback, so the
    // dismissal path must never crash when a consumer omits both.
    render(<ConfirmDialog open title="T" message="M" onConfirm={() => {}} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    expect(() => fireEvent.click(cancelButton)).not.toThrow();
  });

  // --- Extra: default "Confirm" heading when title is omitted -----------------
  it('renders the default "Confirm" heading when title is omitted', () => {
    render(
      <ConfirmDialog
        open
        message="Body only"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    // DialogTitle renders as a heading, which disambiguates it from the confirm
    // button that also carries the default "Confirm" label.
    expect(screen.getByRole('heading', { name: 'Confirm' })).toBeInTheDocument();
  });
});
