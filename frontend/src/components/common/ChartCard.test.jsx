// =============================================================================
// ChartCard.test.jsx — unit tests for the shared ChartCard chart primitive.
// =============================================================================
//
// ChartCard wraps a Recharts chart inside an MUI <Card>. Recharts'
// <ResponsiveContainer> measures its parent through a ResizeObserver, which
// jsdom does not implement — the polyfill lives in `frontend/vitest.setup.js`,
// so at test time the container measures 0x0 and the inner SVG is not drawn.
// That is expected and fine: these tests assert STRUCTURE and BEHAVIOR (header
// text, the MUI Card/CardContent shell, the ResponsiveContainer wrapper, and
// the empty-state message) rather than rendered chart pixels.
//
// The component reads all of its colors from the MUI theme, so every render is
// wrapped in a <ThemeProvider> built from a plain MUI `createTheme()` — this
// keeps the test self-contained and independent of the app's theme module.
// =============================================================================

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import ChartCard from './ChartCard';

const theme = createTheme();

const renderWithTheme = (ui) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

// Multi-series time-series rows (line / bar / area).
const seriesData = [
  { name: 'Jan', admissions: 40, discharges: 24 },
  { name: 'Feb', admissions: 30, discharges: 13 },
  { name: 'Mar', admissions: 20, discharges: 38 },
];

// Single-value categorical rows (pie).
const pieData = [
  { name: 'Cardiology', value: 400 },
  { name: 'Neurology', value: 300 },
  { name: 'Oncology', value: 300 },
];

afterEach(() => {
  // Isolate each test's DOM so repeated header text does not collide.
  cleanup();
});

describe('ChartCard', () => {
  it('renders the Card header title', () => {
    renderWithTheme(
      <ChartCard title="Monthly Admissions" data={seriesData} dataKey="admissions" />,
    );
    expect(screen.getByText('Monthly Admissions')).toBeInTheDocument();
  });

  it('renders the optional subheader when provided', () => {
    renderWithTheme(
      <ChartCard
        title="Monthly Admissions"
        subheader="Last 3 months"
        data={seriesData}
        dataKey="admissions"
      />,
    );
    expect(screen.getByText('Last 3 months')).toBeInTheDocument();
  });

  it('renders the MUI Card + CardContent + ResponsiveContainer when data is present', () => {
    const { container } = renderWithTheme(
      <ChartCard title="Line" data={seriesData} dataKeys={['admissions', 'discharges']} type="line" />,
    );
    expect(container.querySelector('.MuiCard-root')).toBeInTheDocument();
    expect(container.querySelector('.MuiCardContent-root')).toBeInTheDocument();
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  it.each(['line', 'bar', 'area'])('renders the "%s" chart type without crashing', (type) => {
    const { container } = renderWithTheme(
      <ChartCard
        title={`${type} chart`}
        data={seriesData}
        dataKeys={['admissions', 'discharges']}
        type={type}
      />,
    );
    expect(screen.getByText(`${type} chart`)).toBeInTheDocument();
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  it('renders the pie chart type without crashing', () => {
    const { container } = renderWithTheme(
      <ChartCard title="By Department" data={pieData} type="pie" dataKey="value" xKey="name" />,
    );
    expect(screen.getByText('By Department')).toBeInTheDocument();
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  it('falls back to a chart for an unrecognized chart type (default case)', () => {
    const { container } = renderWithTheme(
      <ChartCard title="Fallback" data={seriesData} dataKey="admissions" type="scatter" />,
    );
    expect(screen.getByText('Fallback')).toBeInTheDocument();
    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  it('shows the empty-state message when data is an empty array', () => {
    renderWithTheme(<ChartCard title="Empty" data={[]} dataKey="admissions" />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('shows the empty-state message (no crash) when data is null', () => {
    renderWithTheme(<ChartCard title="Null" data={null} dataKey="admissions" />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('omits the Card header when no title is given', () => {
    const { container } = renderWithTheme(<ChartCard data={seriesData} dataKey="admissions" />);
    expect(container.querySelector('.MuiCardHeader-root')).toBeNull();
  });

  it('does not render the empty-state message when data is present', () => {
    renderWithTheme(<ChartCard title="Has Data" data={seriesData} dataKey="admissions" />);
    expect(screen.queryByText('No data available')).toBeNull();
  });
});
