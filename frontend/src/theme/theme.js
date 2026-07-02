// =============================================================================
// Single, app-wide MUI v5 theme — Hospital Management System (HMS) frontend
// =============================================================================
//
// This is the REQUIRED contract file for the whole `theme/` folder. It COMPOSES
// the three sibling design-token modules into ONE Material UI (MUI) v5 theme via
// `createTheme`, applies responsive font sizing, and DEFAULT-EXPORTS the result.
//
//   • palette     (./palette)     — light-mode colors; primary.main pinned to
//                                    '#1976d2'; contrastThreshold 4.5 for
//                                    WCAG-AA-friendly contrastText selection.
//   • typography  (./typography)  — Roboto stack, desktop/base sizes in `rem`.
//   • components  (./components)  — light, global component polish. Some slots
//                                    use the MUI style-callback form
//                                    `({ theme }) => ({ ... })` and read values
//                                    off the FULLY-ASSEMBLED theme (notably
//                                    `theme.palette.divider` and
//                                    `theme.shape.borderRadius`).
//
// HARD CONTRACT (referenced by `frontend/src/main.jsx`):
//   `main.jsx` imports this module's DEFAULT export as
//   `import theme from './theme/theme'` and renders
//   `<ThemeProvider theme={theme}><CssBaseline/>…</ThemeProvider>`. If the
//   default export is missing or is not a valid MUI theme, the entire app fails
//   to render. This file therefore ONLY builds and exports the theme object; it
//   does NOT render `<ThemeProvider>`/`<CssBaseline>` (that is `main.jsx`'s job)
//   and adds NO other styling libraries or CSS files.
//
// Design constraints (see the Agent Action Plan for authoritative context):
//   • Light mode ONLY — the mode comes from `./palette` (`mode: 'light'`); this
//     file does NOT add a dark mode and does NOT override `palette.mode`.
//   • `palette.primary.main` MUST remain '#1976d2' — it is pinned in
//     `./palette`; this file does NOT override it.
//   • Breakpoints use MUI DEFAULTS (xs/sm/md/lg/xl) — this file does NOT override
//     `breakpoints`. The AppLayout Drawer collapses on small screens using these
//     defaults, and `responsiveFontSizes` scales typography against them.
//   • `shape.borderRadius: 8` is set here because `components.js`'s `MuiDataGrid`
//     root override reads `theme.shape.borderRadius`; keep it at 8.
//   • `spacing: 8` is MUI's default 8px base unit, set explicitly for clarity.
//
// Plain ESM JavaScript (the frontend package is `"type": "module"`); NO
// TypeScript. Internal imports are relative; the MUI factory/helper are imported
// from `@mui/material/styles`.
// =============================================================================

import { createTheme, responsiveFontSizes } from '@mui/material/styles';
import palette from './palette';
import typography from './typography';
import components from './components';

// -----------------------------------------------------------------------------
// STEP 1 — Assemble the base theme.
//
// `createTheme` MUST run FIRST. Doing so:
//   1. Augments the palette — MUI computes each color's `light`/`dark`/
//      `contrastText` (honoring the palette's `contrastThreshold: 4.5`) so any
//      color not explicitly supplied is derived, and adds framework-provided
//      palette members (e.g. `divider`, `action`, `grey`).
//   2. Resolves the `({ theme }) => ({ ... })` style callbacks declared in
//      `components.js` against the assembled theme, so `theme.palette.divider`
//      and `theme.shape.borderRadius` are available when those slots are read.
//
// `let` (not `const`) is used because `theme` is reassigned in STEP 2 below.
// -----------------------------------------------------------------------------
let theme = createTheme({
  palette,
  typography,
  components,
  shape: {
    // Global corner rounding; `components.js` MuiDataGrid root reads this.
    borderRadius: 8,
  },
  // MUI default 8px base spacing unit (explicit for clarity/documentation).
  spacing: 8,
});

// -----------------------------------------------------------------------------
// STEP 2 — Apply adaptive/responsive typography.
//
// `responsiveFontSizes` MUST run AFTER `createTheme`, and its return value is
// reassigned to `theme`. It injects breakpoint-scoped `@media` font-size rules
// into the heading/text variants (using MUI's DEFAULT breakpoints), so
// `typography.js` only needs to define desktop/base sizes and they scale down on
// smaller screens automatically.
// -----------------------------------------------------------------------------
theme = responsiveFontSizes(theme);

// -----------------------------------------------------------------------------
// STEP 3 — Default-export the finished theme (the sole hard requirement).
// Consumed by `main.jsx` as `import theme from './theme/theme'`.
// -----------------------------------------------------------------------------
export default theme;
