/**
 * @module components/common/DataTable.test
 *
 * Unit tests for the shared {@link module:components/common/DataTable DataTable}
 * MUI X DataGrid wrapper.
 *
 * The grid reads density/theming from the application theme, so every render is
 * wrapped in a `<ThemeProvider>`. A locally-created default theme
 * (`createTheme()`) is used instead of importing the app theme to keep this test
 * self-contained and decoupled from theme internals.
 *
 * MUI X DataGrid relies on `ResizeObserver` and `window.matchMedia`, which jsdom
 * does not implement; those are polyfilled globally in the project's
 * `vitest.setup.js`. The datasets here are intentionally tiny so the grid
 * renders every row (no virtualization edge cases) under jsdom.
 *
 * Assertions use Testing Library's throwing queries (`getByRole` / `getByText`),
 * which fail if the element is absent, combined with Vitest's built-in
 * `toBeTruthy()` — so the suite has no dependency on jest-dom being registered.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material';

import DataTable from './DataTable';

// Local default theme — the grid only needs a valid theme in context.
const theme = createTheme();

// Unmount and remove rendered trees between tests. React Testing Library only
// auto-registers this when a global `afterEach` exists (i.e. Vitest is run with
// `globals: true`); registering it explicitly keeps the suite isolated
// regardless of the project's Vitest `globals` setting (calling `cleanup()`
// twice is a harmless no-op).
afterEach(() => {
  cleanup();
});

/** Render a UI tree inside a MUI ThemeProvider (the grid reads the theme). */
function renderWithTheme(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

const columns = [{ field: 'name', headerName: 'Name', flex: 1 }];
const rows = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];

describe('DataTable', () => {
  it('renders a data grid with the provided column header and row values', () => {
    renderWithTheme(<DataTable columns={columns} rows={rows} />);

    // The DataGrid exposes the ARIA "grid" role on its root element.
    expect(screen.getByRole('grid')).toBeTruthy();

    // The column header renders from `headerName`.
    expect(screen.getByText('Name')).toBeTruthy();

    // Both row cell values render (tiny dataset => no virtualization gaps).
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
  });

  it('renders the grid and header with an empty dataset without crashing', () => {
    renderWithTheme(<DataTable columns={columns} rows={[]} />);

    // Grid + header still render even when there are zero rows.
    expect(screen.getByRole('grid')).toBeTruthy();
    expect(screen.getByText('Name')).toBeTruthy();
  });

  it('adds a selection checkbox column when checkboxSelection is enabled', () => {
    renderWithTheme(
      <DataTable columns={columns} rows={rows} checkboxSelection />,
    );

    // checkboxSelection must pass through to the DataGrid, producing at least
    // the "select all" header checkbox (plus one per rendered row).
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
  });
});
