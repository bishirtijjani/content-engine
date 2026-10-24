// diagrams/layouts/charts/area-chart.mjs — area chart instance (same geometry
// as the line chart, filled to the baseline).
import { makeLineLayout } from './line.mjs';

export default makeLineLayout({ name: 'area-chart', area: true });
