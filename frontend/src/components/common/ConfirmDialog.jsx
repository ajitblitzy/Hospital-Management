/**
 * @file frontend/src/components/common/ConfirmDialog.jsx
 * @module components/common/ConfirmDialog
 *
 * Reusable, controlled confirmation modal for the Hospital Management System
 * (HMS) React 18 + Vite single-page application. It presents a short question
 * ("Are you sure?") and a Cancel / Confirm choice, built entirely on Material
 * UI (MUI) v5 `<Dialog>` primitives.
 *
 * MUI v5 is the SOLE design system for the HMS frontend, so this component
 * intentionally contains NO hardcoded colors, spacing, or typography — every
 * visual value resolves through the app theme via MUI props (e.g. the confirm
 * button's `color`). This keeps the modal visually consistent with the rest of
 * the app and lets a single theme change restyle it everywhere.
 *
 * ---------------------------------------------------------------------------
 * DESIGN INTENT — presentational & controlled
 * ---------------------------------------------------------------------------
 * This component owns NO business state. The parent controls visibility via the
 * `open` prop and owns every side effect through the `onConfirm` / `onCancel`
 * (or `onClose`) callbacks. That makes the same modal reusable for very
 * different flows without modification:
 *
 *   • Idle-logout warning — `../auth/SessionTimeout.jsx` renders it as the
 *     "You will be logged out…" prompt with "Stay signed in" / "Log out"
 *     labels. (Session timeout is a documented HMS security requirement — see
 *     doc 02 "Functional Requirements": *"Session timeout and audit logging"*,
 *     and the JWT-based auth model in doc 03 "Technical Architecture".)
 *
 *   • Destructive confirmations — delete-patient, void-invoice, remove-
 *     inventory, cancel-appointment, etc. render it with `confirmColor="error"`
 *     so the confirm button is a red, high-emphasis destructive action.
 *
 * ---------------------------------------------------------------------------
 * FLEXIBILITY CONTRACTS (why the prop surface looks the way it does)
 * ---------------------------------------------------------------------------
 *   • Cancel/close handler — consumers historically pass EITHER `onCancel` OR
 *     `onClose` (MUI-style). Both are accepted and collapsed into one safe
 *     handler so neither convention breaks the dismissal path.
 *   • Body content — pass `message` for a plain string body (wrapped in a
 *     MUI `<DialogContentText>` for correct muted styling + a11y description)
 *     OR pass `children` for rich content (lists, formatted warnings, forms).
 *   • `loading` — while an async confirm is in flight, both buttons are
 *     disabled and a small spinner replaces nothing/appears in the confirm
 *     button, preventing double-submit and accidental dismissal.
 *
 * ---------------------------------------------------------------------------
 * ACCESSIBILITY
 * ---------------------------------------------------------------------------
 * We rely on MUI `<Dialog>`'s built-in ARIA wiring: it renders `role="dialog"`
 * (modal), traps focus, restores focus to the trigger on close, and
 * auto-associates `aria-labelledby` with the `<DialogTitle>` and
 * `aria-describedby` with the `<DialogContentText>`. We therefore do NOT
 * hand-roll ARIA attributes. When `children` is used instead of `message`, the
 * dialog is still labelled by its title.
 *
 * This module is plain ESM JavaScript + JSX (the frontend package is
 * `"type": "module"`). It uses the automatic JSX runtime, so it deliberately
 * does NOT `import React`. There is NO TypeScript and NO PropTypes here — the
 * prop contract is documented via JSDoc below.
 */

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  CircularProgress,
} from '@mui/material';

/**
 * A controlled confirm/cancel modal dialog.
 *
 * @param {object} props
 * @param {boolean} [props.open] - When truthy, the dialog is shown. The parent
 *   fully controls visibility (coerced with `Boolean()` so `undefined`/`0`
 *   render as closed).
 * @param {import('react').ReactNode} [props.title='Confirm'] - Heading shown in
 *   the `<DialogTitle>`; also used by MUI as the dialog's accessible name.
 * @param {import('react').ReactNode} [props.message] - Plain body text. When
 *   provided it is rendered inside a `<DialogContentText>`. If omitted,
 *   `children` is rendered instead.
 * @param {import('react').ReactNode} [props.children] - Rich body content used
 *   when `message` is not supplied (e.g. formatted warnings or a small form).
 * @param {string} [props.confirmText='Confirm'] - Label for the confirm button.
 * @param {string} [props.cancelText='Cancel'] - Label for the cancel button.
 * @param {(event?: object) => void} [props.onConfirm] - Invoked when the user
 *   clicks the confirm button. The parent owns the resulting side effect.
 * @param {(event?: object, reason?: string) => void} [props.onCancel] - Invoked
 *   on cancel/close. Either this or `onClose` may be supplied.
 * @param {(event?: object, reason?: string) => void} [props.onClose] - Alias
 *   for the cancel/close path (MUI naming). Used when `onCancel` is absent.
 * @param {'inherit'|'primary'|'secondary'|'success'|'error'|'info'|'warning'}
 *   [props.confirmColor='primary'] - MUI theme color for the confirm button.
 *   Pass `'error'` for destructive actions to render a red button.
 * @param {boolean} [props.loading=false] - When true, both buttons are disabled
 *   and a spinner is shown in the confirm button (prevents double-submit and
 *   backdrop/escape dismissal while an async confirm is in flight).
 * @param {'xs'|'sm'|'md'|'lg'|'xl'|false} [props.maxWidth='xs'] - MUI Dialog
 *   max width; `'xs'` keeps the modal compact by default.
 * @param {object} [props.rest] - Any additional props are spread onto the
 *   underlying `<Dialog>` (e.g. `fullScreen`, `PaperProps`, `sx`).
 * @returns {JSX.Element} The rendered confirmation dialog.
 */
function ConfirmDialog({
  open,
  title = 'Confirm',
  message,
  children,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  onClose,
  confirmColor = 'primary',
  loading = false,
  maxWidth = 'xs',
  ...rest
}) {
  // Phase 1 — collapse the two accepted cancel/close prop names into a single,
  // always-callable handler. The trailing no-op keeps click/close handlers safe
  // even when a consumer forgets to pass either callback.
  const handleCancel = onCancel || onClose || (() => {});

  // Backdrop click and the Escape key both route through MUI's `onClose`. While
  // an async confirm is in flight (`loading`), swallow those dismissals so the
  // operation cannot be abandoned mid-submit; otherwise delegate to the unified
  // cancel handler (forwarding MUI's `event`, `reason` for interested callers).
  const handleDialogClose = (event, reason) => {
    if (loading) {
      return;
    }
    handleCancel(event, reason);
  };

  return (
    <Dialog
      open={Boolean(open)}
      onClose={handleDialogClose}
      maxWidth={maxWidth}
      fullWidth
      {...rest}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {message ? <DialogContentText>{message}</DialogContentText> : children}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel} disabled={loading} color="inherit">
          {cancelText}
        </Button>
        <Button
          onClick={onConfirm}
          color={confirmColor}
          variant="contained"
          disabled={loading}
          autoFocus
          startIcon={
            loading ? <CircularProgress size={18} color="inherit" /> : null
          }
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ConfirmDialog;
