// diagrams/charts/scales.mjs — deterministic scales and path builders.
// No DOM measurement, no locale: the same numbers always produce the same SVG.

export function linear(domainMin, domainMax, rangeMin, rangeMax) {
  const span = domainMax - domainMin || 1;
  const scale = (rangeMax - rangeMin) / span;
  return (v) => rangeMin + (Number(v) - domainMin) * scale;
}

export function extent(values, { includeZero = false } = {}) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return { min: 0, max: 1 };
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (includeZero) min = Math.min(0, min);
  if (min === max) max = min + 1;
  return { min, max };
}

/** A round upper bound with 4-ish ticks. */
export function niceMax(max) {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

export function band(n, start, end, gapRatio = 0.18) {
  const step = (end - start) / n;
  const pad = step * gapRatio / 2;
  return (i) => ({ start: start + i * step + pad, size: step - pad * 2, mid: start + i * step + step / 2 });
}

export function linePath(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${round(p.x)} ${round(p.y)}`).join(' ');
}

export function areaPath(points, baselineY) {
  if (!points.length) return '';
  return `M ${round(points[0].x)} ${round(baselineY)} ` +
    points.map((p) => `L ${round(p.x)} ${round(p.y)}`).join(' ') +
    ` L ${round(points[points.length - 1].x)} ${round(baselineY)} Z`;
}

/** A smooth band between two columns (sankey link). */
export function bandPath(x0, y0a, y0b, x1, y1a, y1b) {
  const mx = (x0 + x1) / 2;
  return `M ${round(x0)} ${round(y0a)} ` +
    `C ${round(mx)} ${round(y0a)}, ${round(mx)} ${round(y1a)}, ${round(x1)} ${round(y1a)} ` +
    `L ${round(x1)} ${round(y1b)} ` +
    `C ${round(mx)} ${round(y1b)}, ${round(mx)} ${round(y0b)}, ${round(x0)} ${round(y0b)} Z`;
}

export const round = (n) => Math.round(n * 1000) / 1000;
