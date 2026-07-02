// =============================================================================
// MUI v5 Typography configuration — Hospital Management System (HMS) frontend
// =============================================================================
//
// This is a FOUNDATIONAL, leaf design-token module. It exports a plain
// `TypographyOptions` object that `theme/theme.js` passes straight into
// `createTheme({ typography, ... })`. Material UI (MUI) is the SOLE design
// system for the HMS frontend, so this file is the single source of truth for
// application-wide type styling.
//
// Design decisions (see the Agent Action Plan for authoritative context):
//
//   • Font family — uses MUI's default Roboto stack WITH web-safe fallbacks.
//     No external font is bundled: we deliberately do NOT install/import any
//     `@fontsource/*` package and do NOT inject a Google Fonts `<link>` or CSS
//     `@import`. When Roboto is unavailable the stack degrades gracefully to
//     Helvetica, then Arial, then the platform sans-serif.
//
//   • Accessibility — every variant size is expressed in `rem` so it scales
//     with the user's browser base font-size (respecting user zoom / preferred
//     text size). `htmlFontSize: 16` documents the 16px root that the rem
//     values are computed against. Line-heights are kept in a readable
//     ~1.2–1.66 range and heading weights provide clear visual hierarchy.
//
//   • Responsiveness — `theme.js` wraps the assembled theme in
//     `responsiveFontSizes(theme)`, which automatically scales the heading and
//     text variants down at smaller breakpoints. Therefore this module defines
//     only the DESKTOP / base sizes; it intentionally contains NO per-breakpoint
//     media queries.
//
//   • Buttons — `button.textTransform: 'none'` disables MUI's default ALL-CAPS
//     button labels for readability/accessibility. This is the canonical place
//     MUI reads button label casing from, so the `MuiButton` override in
//     `components.js` intentionally does NOT set `textTransform` (avoiding a
//     duplicated, conflicting source of truth).
//
// This module is plain ESM JavaScript (the frontend package is
// `"type": "module"`); it has no imports and no TypeScript.
// =============================================================================

/**
 * Application-wide MUI typography options (an MUI `TypographyOptions` shape).
 *
 * Consumed by `theme/theme.js` via `createTheme({ typography })` and then
 * scaled responsively with `responsiveFontSizes()`. Exported both as a named
 * export (for direct token access) and as the module default (which `theme.js`
 * imports as `import typography from './typography'`).
 *
 * @type {object}
 */
export const typography = {
  // ---------------------------------------------------------------------------
  // Global font settings
  // ---------------------------------------------------------------------------
  // MUI default Roboto stack with web-safe fallbacks. No external font bundled.
  fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  // Root (`<html>`) font-size, in px, that the `rem` values below resolve to.
  htmlFontSize: 16,
  // MUI's base font size (px) used to derive the default `body`/`html` scale.
  fontSize: 14,
  // Standard MUI weight scale (Roboto ships regular/medium/bold; light degrades
  // gracefully to the nearest available weight in the fallback fonts).
  fontWeightLight: 300,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 700,

  // ---------------------------------------------------------------------------
  // Headings (h1–h6) — desktop/base sizes; responsiveFontSizes() scales these
  // down on smaller breakpoints. Semibold (600) weight for a clear hierarchy.
  // ---------------------------------------------------------------------------
  h1: { fontSize: '2.5rem', fontWeight: 600, lineHeight: 1.2 },
  h2: { fontSize: '2rem', fontWeight: 600, lineHeight: 1.25 },
  h3: { fontSize: '1.75rem', fontWeight: 600, lineHeight: 1.3 },
  h4: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.35 },
  h5: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.4 },
  h6: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.5 },

  // ---------------------------------------------------------------------------
  // Subtitles — medium weight (500) for secondary emphasis above body text.
  // ---------------------------------------------------------------------------
  subtitle1: { fontSize: '1rem', fontWeight: 500, lineHeight: 1.5 },
  subtitle2: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.57 },

  // ---------------------------------------------------------------------------
  // Body copy — regular weight; body1 is the default paragraph text.
  // ---------------------------------------------------------------------------
  body1: { fontSize: '1rem', lineHeight: 1.5 },
  body2: { fontSize: '0.875rem', lineHeight: 1.43 },

  // ---------------------------------------------------------------------------
  // Buttons — disable ALL-CAPS labels for readability/accessibility. This is
  // the canonical source of truth for button label casing (see file header).
  // ---------------------------------------------------------------------------
  button: { textTransform: 'none', fontWeight: 500 },

  // ---------------------------------------------------------------------------
  // Supporting variants
  // ---------------------------------------------------------------------------
  // Small helper/annotation text (form hints, timestamps, table metadata).
  caption: { fontSize: '0.75rem', lineHeight: 1.66 },
  // Eyebrow/label text — uppercased with tracking to read as an overline.
  overline: {
    fontSize: '0.75rem',
    fontWeight: 500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
};

export default typography;
