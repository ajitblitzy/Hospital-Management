// =============================================================================
// ChartCard — reusable Recharts-in-MUI-Card chart primitive (HMS frontend)
// =============================================================================
//
// This is THE single charting primitive used across every HMS dashboard and the
// "Reports & Analytics" module (see doc 01 — "Enable real-time analytics and
// reporting"). It wraps a Recharts chart inside a Material UI (MUI) <Card> so
// that every chart in the application shares the same surface treatment (title
// header, padding, elevation) and — critically — the same brand colors.
//
// Design decisions:
//
//   • Theme-driven colors — the SOLE source of chart colors is the shared MUI
//     theme (`theme.palette`). The component NEVER hardcodes hex values; this
//     keeps every chart on-brand and automatically consistent with the app's
//     light/dark palette. A caller MAY override the cycle by passing an explicit
//     `colors` array (typically itself sourced from the theme).
//
//   • Presentational only — the component owns layout + theming; the calling
//     page owns the data. Pass `data`, pick a `type`, and name the series keys
//     (`dataKey` / `dataKeys`) plus the category axis key (`xKey`). No data
//     fetching, no business logic here.
//
//   • Fluid width, fixed height — the chart is wrapped in a Recharts
//     <ResponsiveContainer> at width="100%" so it fills the Card horizontally
//     and reflows on resize, while `height` (px, default 300) fixes the vertical
//     size so dashboard grid rows stay predictable.
//
//   • Graceful empty state — when there are no rows to plot the component shows
//     an accessible "No data available" message instead of rendering a blank /
//     broken chart. Input is defensively normalized so a `null`/`undefined`
//     `data` prop can never crash the render.
//
// Conventions: plain ESM + JSX (the frontend package is `"type": "module"`), the
// automatic JSX runtime (so React is NOT imported), no TypeScript and no
// PropTypes — prop documentation lives in the JSDoc block below.
// =============================================================================

import {
  Card,
  CardHeader,
  CardContent,
  Box,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

/**
 * ChartCard — a themed MUI Card wrapping a responsive Recharts chart.
 *
 * Supports four chart types via the `type` prop. Line, bar and area charts can
 * render one or many series; pie charts render a single value series broken out
 * into colored slices. All series colors cycle through the MUI theme palette
 * (or a caller-supplied `colors` array).
 *
 * @param {object}   props
 * @param {React.ReactNode} [props.title]      Title shown in the Card header (header is omitted when falsy).
 * @param {React.ReactNode} [props.subheader]  Optional secondary text under the title.
 * @param {Array<object>}   [props.data=[]]    Row objects to plot. Empty/absent → "No data available".
 * @param {'line'|'bar'|'area'|'pie'} [props.type='line'] Chart variant to render.
 * @param {string}   [props.dataKey]           Single series key (also the value key for pie charts).
 * @param {string[]} [props.dataKeys]          Multiple series keys (line/bar/area). Preferred over `dataKey` when non-empty.
 * @param {string}   [props.xKey='name']       Category / x-axis key; also the pie `nameKey`.
 * @param {number}   [props.height=300]        Chart height in px. Width is always fluid ("100%").
 * @param {string[]} [props.colors]            Optional explicit color cycle overriding the theme palette.
 * @param {object}   [props.sx]                MUI `sx` overrides merged onto the root <Card>.
 * @param {object}   [props.rest]              Any remaining props are spread onto the root <Card>.
 * @returns {JSX.Element}
 */
function ChartCard({
  title,
  subheader,
  data = [],
  type = 'line',
  dataKey,
  dataKeys,
  xKey = 'name',
  height = 300,
  colors,
  sx,
  ...rest
}) {
  const theme = useTheme();

  // Default color cycle derived entirely from the shared MUI theme so charts
  // stay on-brand. A caller-supplied `colors` array takes precedence.
  const palette = colors || [
    theme.palette.primary.main,
    theme.palette.secondary.main,
    theme.palette.success.main,
    theme.palette.warning.main,
    theme.palette.error.main,
    theme.palette.info.main,
  ];

  // Normalize the series keys to a single array so line/bar/area share one
  // rendering path. Prefer the multi-series `dataKeys`; otherwise wrap the
  // single `dataKey` (or fall back to no series when neither is provided).
  const series = dataKeys && dataKeys.length ? dataKeys : dataKey ? [dataKey] : [];

  // Defensive normalization: guarantees `.length`/`.map` are always safe even
  // if a caller passes a non-array (e.g. `null`) — prevents a render crash and
  // routes such input to the empty-state message below.
  const rows = Array.isArray(data) ? data : [];

  /**
   * Build the Recharts chart element for the requested `type`. Shared axes,
   * grid, tooltip and legend are configured with theme colors; series are
   * mapped from the normalized `series` array (pie uses the single `dataKey`).
   */
  const renderChart = () => {
    switch (type) {
      case 'bar':
        return (
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
            <XAxis dataKey={xKey} stroke={theme.palette.text.secondary} />
            <YAxis stroke={theme.palette.text.secondary} />
            <Tooltip />
            <Legend />
            {series.map((key, index) => (
              <Bar key={key} dataKey={key} fill={palette[index % palette.length]} />
            ))}
          </BarChart>
        );

      case 'area':
        return (
          <AreaChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
            <XAxis dataKey={xKey} stroke={theme.palette.text.secondary} />
            <YAxis stroke={theme.palette.text.secondary} />
            <Tooltip />
            <Legend />
            {series.map((key, index) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={palette[index % palette.length]}
                fill={palette[index % palette.length]}
                fillOpacity={0.3}
              />
            ))}
          </AreaChart>
        );

      case 'pie':
        return (
          <PieChart>
            <Tooltip />
            <Legend />
            <Pie
              data={rows}
              dataKey={dataKey}
              nameKey={xKey}
              cx="50%"
              cy="50%"
              outerRadius={Math.min(height, 300) / 2 - 20}
              label
            >
              {rows.map((entry, index) => (
                <Cell key={index} fill={palette[index % palette.length]} />
              ))}
            </Pie>
          </PieChart>
        );

      case 'line':
      default:
        // Line chart is both the explicit 'line' variant and the safe default
        // for any unrecognized `type`.
        return (
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
            <XAxis dataKey={xKey} stroke={theme.palette.text.secondary} />
            <YAxis stroke={theme.palette.text.secondary} />
            <Tooltip />
            <Legend />
            {series.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={palette[index % palette.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        );
    }
  };

  return (
    <Card sx={{ height: '100%', ...sx }} {...rest}>
      {title && (
        <CardHeader
          title={title}
          subheader={subheader}
          titleTypographyProps={{ variant: 'h6' }}
        />
      )}
      <CardContent>
        {rows.length === 0 ? (
          <Box
            sx={{
              height,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              No data available
            </Typography>
          </Box>
        ) : (
          <Box sx={{ width: '100%', height }}>
            <ResponsiveContainer width="100%" height="100%">
              {renderChart()}
            </ResponsiveContainer>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export default ChartCard;
