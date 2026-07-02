// =============================================================================
// MUI v5 component overrides / defaultProps — Hospital Management System (HMS)
// =============================================================================
//
// FOUNDATIONAL, leaf design-token module. It exports a plain MUI `components`
// object that `theme/theme.js` passes straight into
// `createTheme({ components, ... })`. Material UI (MUI) is the SOLE design
// system for the HMS frontend; this file provides light, GLOBAL component
// polish only (per the Agent Action Plan). It deliberately does NOT introduce
// custom variants, heavy styling, or many component overrides — only the small,
// cohesive set below (MuiButton, MuiAppBar, MuiDrawer, MuiTextField,
// MuiDataGrid).
//
// Design decisions (see the Agent Action Plan for authoritative context):
//
//   • Decoupled from palette.js — any slot that needs palette/shape values uses
//     the MUI style-callback form `styleOverrides: { slot: ({ theme }) => ({ ... }) }`
//     so those values are read from the FULLY-ASSEMBLED theme at runtime. This
//     module therefore has NO imports (no `./palette`, no hardcoded palette hex
//     values) and stays a pure, side-effect-free ESM object.
//
//   • Button label casing — ALL-CAPS is disabled centrally in `typography.js`
//     via `typography.button.textTransform: 'none'`. That is the single source
//     of truth for button casing, so the `MuiButton` override below
//     intentionally does NOT set `textTransform` (avoiding a duplicated,
//     conflicting definition).
//
//   • MuiDataGrid — included per the AAP to set `@mui/x-data-grid` density and a
//     light border/rounding that matches the app shape. This key is read by the
//     DataGrid at runtime ONLY where a `<DataGrid>` is actually rendered; it is
//     inert otherwise. It requires NO import of `@mui/x-data-grid` here and
//     (this being plain JS) NO TypeScript module augmentation.
//
// This module is plain ESM JavaScript (the frontend package is
// `"type": "module"`); it has no imports and no TypeScript.
// =============================================================================

/**
 * Application-wide MUI component overrides / default props (an MUI `Components`
 * shape).
 *
 * Consumed by `theme/theme.js` via `createTheme({ components })`. Exported both
 * as a named export (for direct access / tests) and as the module default,
 * which `theme.js` imports as `import components from './components'`.
 *
 * @type {object}
 */
export const components = {
  MuiButton: {
    // Default variant per AAP; flat (no elevation) for a clean, modern look.
    defaultProps: { variant: 'contained', disableElevation: true },
  },
  MuiAppBar: {
    // Subtle elevation polish for the top app bar in AppLayout.
    defaultProps: { color: 'primary', elevation: 1 },
  },
  MuiDrawer: {
    // Navigation drawer polish (AppLayout drawer collapses on small screens).
    styleOverrides: {
      paper: ({ theme }) => ({
        borderRight: `1px solid ${theme.palette.divider}`,
        backgroundImage: 'none',
      }),
    },
  },
  MuiTextField: {
    // Compact, consistent form fields across registration/billing/etc.
    defaultProps: { variant: 'outlined', size: 'small' },
  },
  MuiDataGrid: {
    // Density per AAP + light rounding to match the app shape. This config is
    // read by @mui/x-data-grid at runtime ONLY where a DataGrid is used; it
    // requires NO import here and (since this is plain JS) NO TypeScript module
    // augmentation.
    defaultProps: { density: 'standard' },
    styleOverrides: {
      root: ({ theme }) => ({
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: theme.shape.borderRadius,
      }),
    },
  },
};

export default components;
