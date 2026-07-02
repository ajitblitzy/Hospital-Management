// Light-mode MUI v5 palette for the Hospital Management System.
// primary.main is pinned to #1976d2 to match index.html's <meta name="theme-color">
// (and MUI's default primary blue). Colors are chosen for WCAG AA-friendly contrast.
export const palette = {
  mode: 'light',
  // Raise the contrast threshold to 4.5 so MUI auto-selects an AA-compliant
  // contrastText (black vs white) for each color — notably giving warning/info
  // dark text instead of low-contrast white.
  contrastThreshold: 4.5,
  primary: {
    main: '#1976d2', // REQUIRED — do not change
    light: '#42a5f5',
    dark: '#1565c0',
    contrastText: '#ffffff',
  },
  secondary: {
    main: '#00796b', // teal 700 — calm, professional healthcare accent (white text ≈ 5.32:1)
    contrastText: '#ffffff',
  },
  error: { main: '#d32f2f' }, // MUI default red (white text ≈ 4.98:1)
  warning: { main: '#ed6c02' }, // MUI default orange (MUI will pick dark text ≈ 6.0:1)
  info: { main: '#0288d1' }, // MUI default light-blue (MUI will pick dark text ≈ 4.9:1)
  success: { main: '#2e7d32' }, // MUI default green (white text ≈ 5.13:1)
  background: {
    default: '#f4f6f8', // soft neutral app background so white Paper/Cards stand out on dashboards
    paper: '#ffffff',
  },
  text: {
    primary: 'rgba(0, 0, 0, 0.87)',
    secondary: 'rgba(0, 0, 0, 0.6)',
    disabled: 'rgba(0, 0, 0, 0.38)',
  },
  divider: 'rgba(0, 0, 0, 0.12)',
};

export default palette;
