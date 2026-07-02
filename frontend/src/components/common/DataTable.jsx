/**
 * @module components/common/DataTable
 *
 * Thin, reusable wrapper over MUI X's {@link https://mui.com/x/react-data-grid/ DataGrid}
 * for the Hospital Management System (HMS) single-page application.
 *
 * This is the single tabular primitive shared across the HMS app — patients,
 * appointments, invoices, claims, prescriptions, lab reports, and inventory
 * pages all render their listings through this component. Centralizing on one
 * wrapper gives every page the full power of MUI X DataGrid (column sorting,
 * filtering, and pagination — client- or server-side) with consistent theming
 * and zero duplication.
 *
 * ---------------------------------------------------------------------------
 * DESIGN PHILOSOPHY — THIN PASSTHROUGH
 * ---------------------------------------------------------------------------
 * The component intentionally does almost nothing beyond:
 *   1. Providing sensible HMS-wide defaults for the most common grid props.
 *   2. Wrapping the grid in a layout `<Box>` so it reliably fills its column
 *      width and can optionally take a fixed height.
 *   3. Spreading every remaining prop (`...rest`) straight onto `<DataGrid>`.
 *
 * Because unknown props flow through untouched, callers can reach the ENTIRE
 * MUI X DataGrid API (e.g. `columnVisibilityModel`, `slots`, `slotProps`,
 * `initialState`, `filterModel`, `rowSelectionModel`, `getRowClassName`, …)
 * without this file ever needing to change.
 *
 * ---------------------------------------------------------------------------
 * THEMING
 * ---------------------------------------------------------------------------
 * Density, colors, borders, header styling, and every other visual concern are
 * supplied by the application theme's `MuiDataGrid` component defaults (density
 * `standard`), applied at runtime by the `<ThemeProvider>` mounted near the app
 * root (see `frontend/src/theme`). This wrapper deliberately does NOT hardcode
 * grid styling beyond layout (width / optional fixed height via `sx`), so the
 * grid stays visually consistent everywhere and fully theme-driven.
 *
 * ---------------------------------------------------------------------------
 * PAGINATION & SORTING MODES (MUI X v7 API)
 * ---------------------------------------------------------------------------
 * MUI X v7 replaced the legacy v5 props (`page` / `pageSize` /
 * `rowsPerPageOptions` / `onPageChange` / `disableSelectionOnClick`) with the
 * `paginationModel` object (`{ page, pageSize }`), `onPaginationModelChange`,
 * `pageSizeOptions`, and `disableRowSelectionOnClick`. This wrapper speaks the
 * v7 vocabulary exclusively.
 *
 *   - Client mode (default): the grid holds all `rows` in memory and handles
 *     paging/sorting internally. `rowCount` MUST NOT be set (MUI X emits a
 *     console warning if it is), so it is omitted in client mode.
 *   - Server mode: pass `paginationMode="server"` and a `rowCount` total, and
 *     drive `paginationModel` + `onPaginationModelChange` (and, for sorting,
 *     `sortingMode="server"` + `onSortModelChange`) from the caller so each
 *     page/sort change can trigger a fresh backend query.
 *
 * The wrapper supports BOTH controlled and uncontrolled pagination:
 *   - Uncontrolled (no `paginationModel`): an `initialState` seeds the grid's
 *     internal pagination with `{ page: 0, pageSize }` so it is immediately
 *     usable without the caller wiring up any state.
 *   - Controlled (`paginationModel` provided): the controlled model +
 *     `onPaginationModelChange` are passed through, and the uncontrolled
 *     `initialState` is intentionally NOT sent (mixing a controlled value with
 *     `initialState` for the same field is a MUI anti-pattern).
 */

import { Box } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';

/**
 * Reusable data grid for HMS listing pages.
 *
 * @param {object} props
 * @param {Array<object>} [props.columns=[]] - MUI X column definitions
 *   (`{ field, headerName, width|flex, valueGetter, renderCell, … }`).
 * @param {Array<object>} [props.rows=[]] - Row data objects. Each row needs a
 *   unique id — either a `row.id` field or a resolver supplied via `getRowId`.
 * @param {boolean} [props.loading=false] - Show the grid's loading overlay while
 *   data is being fetched.
 * @param {(row: object) => (string|number)} [props.getRowId] - Custom row-id
 *   resolver (e.g. `(r) => r._id` for Mongo-style ids). Only forwarded when
 *   provided; otherwise DataGrid falls back to `row.id`.
 * @param {number} [props.pageSize=10] - Initial page size used to seed the
 *   uncontrolled `paginationModel` default.
 * @param {number[]} [props.pageSizeOptions=[5,10,25,50]] - Selectable page-size
 *   options shown in the pagination footer.
 * @param {{page: number, pageSize: number}} [props.paginationModel] - Controlled
 *   pagination model. When supplied, the grid becomes controlled and the caller
 *   owns page/pageSize state.
 * @param {(model: {page: number, pageSize: number}) => void} [props.onPaginationModelChange]
 *   - Handler invoked when the controlled pagination model changes.
 * @param {'client'|'server'} [props.paginationMode='client'] - `'client'` pages
 *   in memory; `'server'` expects the caller to fetch each page and provide
 *   `rowCount`.
 * @param {number} [props.rowCount] - Total server-side row count. Used ONLY in
 *   server pagination mode; omitted in client mode to avoid MUI X warnings.
 * @param {'client'|'server'} [props.sortingMode='client'] - `'client'` sorts in
 *   memory; `'server'` expects the caller to sort via `onSortModelChange`.
 * @param {(model: Array<{field: string, sort: 'asc'|'desc'|null}>) => void} [props.onSortModelChange]
 *   - Sort-change handler (required for server-side sorting).
 * @param {boolean} [props.checkboxSelection=false] - Render a selection checkbox
 *   column (used by bulk-action flows).
 * @param {(params: object, event: object, details: object) => void} [props.onRowClick]
 *   - Row click handler (e.g. open a detail drawer / navigate to a record).
 * @param {boolean} [props.autoHeight=true] - When `true` (and no fixed `height`
 *   is given) the grid grows to fit its rows. Ignored when `height` is set.
 * @param {number|string} [props.height] - Fixed grid height. When provided, the
 *   grid renders inside a fixed-height container and `autoHeight` is disabled so
 *   the grid can virtualize/scroll internally.
 * @param {boolean} [props.disableRowSelectionOnClick=true] - Prevent a plain row
 *   click from toggling selection (selection happens via the checkbox column).
 * @param {object} [props.sx] - MUI system styles merged onto the wrapper `<Box>`.
 * @param {object} [props.rest] - Any other MUI X DataGrid prop; spread verbatim
 *   onto `<DataGrid>` (e.g. `columnVisibilityModel`, `slots`, `initialState`,
 *   `filterModel`, `rowSelectionModel`, `getRowClassName`).
 * @returns {JSX.Element} The wrapped, theme-driven data grid.
 */
function DataTable({
  columns = [],
  rows = [],
  loading = false,
  getRowId,
  pageSize = 10,
  pageSizeOptions = [5, 10, 25, 50],
  paginationModel,
  onPaginationModelChange,
  paginationMode = 'client',
  rowCount,
  sortingMode = 'client',
  onSortModelChange,
  checkboxSelection = false,
  onRowClick,
  autoHeight = true,
  height,
  disableRowSelectionOnClick = true,
  sx,
  ...rest
}) {
  // --- Pagination: uncontrolled default vs. controlled passthrough ---------
  //
  // Seed the grid's internal (uncontrolled) pagination so it is immediately
  // usable when the caller does not manage pagination state itself.
  const initialState = {
    pagination: { paginationModel: { page: 0, pageSize } },
  };

  // When the caller controls pagination, forward the controlled model +
  // change handler and DO NOT also send `initialState` for the same field
  // (mixing controlled state with `initialState` is a MUI anti-pattern).
  // Otherwise, fall back to the uncontrolled `initialState` seed above.
  const paginationProps = paginationModel
    ? { paginationModel, onPaginationModelChange }
    : { initialState };

  // --- Row identity --------------------------------------------------------
  //
  // Only forward `getRowId` when explicitly provided; leaving it out lets
  // DataGrid use its built-in `row.id` default (and avoids passing `undefined`,
  // which the grid would otherwise treat as a custom — broken — resolver).
  const rowIdProps = getRowId ? { getRowId } : {};

  // --- Grid ----------------------------------------------------------------
  //
  // `rowCount` is passed ONLY in server mode: in client mode the grid derives
  // the count from `rows`, and supplying `rowCount` triggers a MUI X warning.
  // `autoHeight` is disabled whenever a fixed `height` is requested so the grid
  // can scroll/virtualize inside the fixed-height container instead.
  //
  // Spread order is deliberate: caller-provided `...rest` comes LAST so it can
  // override any wrapper default (true thin-passthrough semantics).
  const grid = (
    <DataGrid
      columns={columns}
      rows={rows}
      loading={loading}
      pageSizeOptions={pageSizeOptions}
      paginationMode={paginationMode}
      rowCount={paginationMode === 'server' ? rowCount : undefined}
      sortingMode={sortingMode}
      onSortModelChange={onSortModelChange}
      checkboxSelection={checkboxSelection}
      onRowClick={onRowClick}
      disableRowSelectionOnClick={disableRowSelectionOnClick}
      autoHeight={height ? false : autoHeight}
      {...rowIdProps}
      {...paginationProps}
      {...rest}
    />
  );

  // A fixed `height` needs a fixed-height container for the grid to fill;
  // otherwise let the grid grow with its content (autoHeight). Either way the
  // wrapper spans the full available width and merges any caller `sx`.
  if (height) {
    return <Box sx={{ height, width: '100%', ...sx }}>{grid}</Box>;
  }

  return <Box sx={{ width: '100%', ...sx }}>{grid}</Box>;
}

export default DataTable;
