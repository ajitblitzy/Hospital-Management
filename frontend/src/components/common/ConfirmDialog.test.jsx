/**
 * @file frontend/src/components/common/ConfirmDialog.test.jsx
 * @module components/common/ConfirmDialog.test
 *
 * Unit tests for the {@link module:components/common/ConfirmDialog} modal.
 *
 * Run under Vitest + Testing Library in a jsdom environment. This suite is
 * intentionally self-contained: it imports `@testing-library/jest-dom/vitest`
 * (which extends Vitest's `expect` with DOM matchers) and pulls the test hooks
 * explicitly from `vitest`, so it does NOT depend on a global test setup file
 * or on `globals: true` being configured for the project.
 *
 * MUI `<Dialog>` renders its content into a React portal appended to
 * `document.body`, so queries use `screen.*` (which searches the whole
 * document) rather than the container returned by `render`.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import ConfirmDialog from './ConfirmDialog';

// No global setup file is assumed, so unmount + clear the portal between tests
// to prevent duplicate dialogs from leaking across cases.
afterEach(() => {
  cleanup();
});

describe('ConfirmDialog', () => {
  it('renders the title and string message when open', () => {
    render(
      <ConfirmDialog
        open
        title="Delete patient?"
        message="This action cannot be undone."
      />,
    );

    expect(screen.getByText('Delete patient?')).toBeInTheDocument();
    expect(
      screen.getByText('This action cannot be undone.'),
    ).toBeInTheDocument();
  });

  it('does not render any content when open is false', () => {
    render(
      <ConfirmDialog open={false} title="Hidden title" message="Hidden body" />,
    );

    expect(screen.queryByText('Hidden title')).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden body')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('falls back to onClose for the cancel path when onCancel is absent', () => {
    const onClose = vi.fn();
    render(<ConfirmDialog open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders custom confirm/cancel labels (idle-logout scenario)', () => {
    render(
      <ConfirmDialog
        open
        title="Still there?"
        message="You will be logged out due to inactivity."
        confirmText="Stay signed in"
        cancelText="Log out"
      />,
    );

    expect(
      screen.getByRole('button', { name: /stay signed in/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });

  it('renders rich children when no message is provided', () => {
    render(
      <ConfirmDialog open title="Custom body">
        <div data-testid="rich-body">Rich content here</div>
      </ConfirmDialog>,
    );

    expect(screen.getByTestId('rich-body')).toBeInTheDocument();
    expect(screen.getByText('Rich content here')).toBeInTheDocument();
  });

  it('disables both buttons and shows a spinner when loading', () => {
    render(
      <ConfirmDialog open confirmText="Confirm" cancelText="Cancel" loading />,
    );

    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('does not invoke handlers while loading (buttons are disabled)', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open loading onConfirm={onConfirm} onCancel={onCancel} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('renders a destructive confirm button when confirmColor="error"', () => {
    render(<ConfirmDialog open confirmColor="error" confirmText="Delete" />);

    const confirmButton = screen.getByRole('button', { name: /delete/i });
    expect(confirmButton).toBeInTheDocument();
    expect(confirmButton).toBeEnabled();
    // MUI encodes color + variant into the class list.
    expect(confirmButton).toHaveClass('MuiButton-containedError');
  });

  it('uses the default primary confirm color when confirmColor is omitted', () => {
    render(<ConfirmDialog open confirmText="Proceed" />);

    const confirmButton = screen.getByRole('button', { name: /proceed/i });
    expect(confirmButton).toHaveClass('MuiButton-containedPrimary');
  });

  it('does not throw when cancel is clicked without any handler', () => {
    render(<ConfirmDialog open />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    expect(() => fireEvent.click(cancelButton)).not.toThrow();
  });

  it('renders the default "Confirm" heading when title is omitted', () => {
    render(<ConfirmDialog open message="Body only" />);

    // The DialogTitle renders as a level-2 heading, which disambiguates it from
    // the confirm button that also carries the default "Confirm" label.
    expect(
      screen.getByRole('heading', { name: 'Confirm' }),
    ).toBeInTheDocument();
  });
});
