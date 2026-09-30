// render.mjs — validate a diagram spec, then render it to SVG + CSS + GSAP.
//
// The hard gates live here. A diagram that would render wrong is refused, not
// patched: too few or too many steps, a label that cannot fit, an icon that is
// not in the set, a window too short to play. renderDiagram returns null when
// the spec fails, so the assembler skips it (validatePlan already refused it).
//
// Determinism: every coordinate comes from the frame box and the spec in Node.
// No DOM measurement, no path.getTotalLength(), no randomness, no network.
import { r3, rect, text, iconGroup } from './primitives.mjs';
import { ICON_NAMES } from './icons.mjs';
import { getLayout } from './registry.mjs';
import { deriveTheme } from './theme.mjs';

const MAX_LABEL = 24;
const MAX_TITLE = 40;

/** The diagram CSS. One block, namespaced .dg-*, shared by every diagram type. */
export const DIAGRAM_CSS = [
  '.dg-svg{display:block;width:100%;height:100%}',
  '.dg-title{fill:var(--brand-text);font-family:var(--brand-display);font-weight:800;opacity:0}',
  '.dg-node{opacity:1}',
  '.dg-node-bg{fill:var(--brand-blue);filter:drop-shadow(0 10px 22px rgba(0,0,0,.35))}',
  '.dg-node-ring{fill:none;stroke:var(--brand-orange);stroke-width:6;opacity:0}',
  '.dg-node-label{fill:var(--brand-text);font-family:var(--brand-body);font-weight:600}',
  '.dg-node-icon{color:var(--brand-text)}',
  '.dg-node-anim{opacity:0}',
  '.dg-line{stroke:var(--brand-text);stroke-opacity:.85;stroke-width:3;stroke-linecap:round;fill:none}',
  '.dg-arrow{fill:var(--brand-text)}',
].join('\n');

/**
 * Check a diagram spec against its layout. Returns a list of plain problems
 * (empty means good to draw).
 * @param {Object} spec
 * @param {Object} layout - a layout descriptor from registry.mjs
 * @param {Object} [opts] - { duration } enables the play-length gate
 */
export function validateDiagram(spec, layout, { duration = null } = {}) {
  const problems = [];
  if (!layout) return ['diagram layout not found'];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return ['diagram spec must be an object'];
  }

  const { min, max } = layout.steps ?? { min: 2, max: 5 };
  const steps = spec.steps;
  if (!Array.isArray(steps)) {
    problems.push('diagram spec needs a "steps" list');
  } else {
    if (steps.length < min) problems.push(`diagram needs at least ${min} steps`);
    if (steps.length > max) problems.push(`diagram takes at most ${max} steps`);
    steps.forEach((st, i) => {
      if (!st || typeof st !== 'object' || Array.isArray(st)) {
        problems.push(`steps[${i}] must be an object`);
        return;
      }
      const label = typeof st.label === 'string' ? st.label.trim() : '';
      if (!label) problems.push(`steps[${i}] needs a label`);
      else if (label.length > MAX_LABEL) {
        problems.push(`steps[${i}].label is too long (${label.length} chars, max ${MAX_LABEL})`);
      }
      if (st.icon !== undefined && !ICON_NAMES.includes(st.icon)) {
        problems.push(`steps[${i}].icon "${st.icon}" is not in the icon set (${ICON_NAMES.join(', ')})`);
      }
    });
  }

  if (spec.title !== undefined) {
    if (typeof spec.title !== 'string') problems.push('diagram title must be text');
    else if (spec.title.trim().length > MAX_TITLE) {
      problems.push(`diagram title is too long (max ${MAX_TITLE} chars)`);
    }
  }

  if (spec.active !== undefined && !Number.isInteger(spec.active)) {
    problems.push('diagram "active" must be a whole step number');
  }

  if (typeof duration === 'number' && Array.isArray(steps) && layout.minDurationFor) {
    const need = layout.minDurationFor(steps.length);
    if (duration < need) {
      problems.push(
        `this diagram needs ${r3(need)}s to play (${steps.length} steps) but the overlay is ${r3(duration)}s`
      );
    }
  }

  return problems;
}

/** Compose the SVG markup for a computed geometry. */
function buildSvg(geo, theme, ovId) {
  const arrowId = `dg-${ovId}-arrow`;
  const marker =
    `<marker id="${arrowId}" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">` +
    `<path class="dg-arrow" d="M0 0 10 5 0 10Z"/></marker>`;

  const title = geo.title
    ? text({
        x: geo.title.x, y: geo.title.y, cls: 'dg-title',
        anchor: geo.title.anchor, size: geo.title.size, weight: 800, lines: [geo.title.text],
      })
    : '';

  const edges = geo.edges
    .map((e, i) => `<g class="dg-edge dg-edge-${i}">${e.markup.replace('__ARROW__', arrowId)}</g>`)
    .join('');

  const nodes = geo.nodes
    .map((nd, i) => {
      const bg = rect({ w: nd.w, h: nd.h, r: theme.radius, cls: 'dg-node-bg' });
      const ring = rect({ w: nd.w, h: nd.h, r: theme.radius, cls: 'dg-node-ring' });
      const ic = nd.icon ? iconGroup(nd.icon) : '';
      const label = text({
        x: nd.labelX, y: nd.labelY, cls: 'dg-node-label',
        anchor: nd.labelAnchor, size: nd.labelSize, weight: 600, lines: nd.lines,
      });
      return (
        `<g class="dg-node dg-node-${i}" transform="translate(${r3(nd.x)} ${r3(nd.y)})">` +
        `<g class="dg-node-anim">${bg}${ring}${ic}${label}</g></g>`
      );
    })
    .join('');

  return (
    `<svg class="dg-svg" viewBox="0 0 ${r3(geo.w)} ${r3(geo.h)}" preserveAspectRatio="xMidYMid meet" ` +
    `xmlns="http://www.w3.org/2000/svg"><defs>${marker}</defs>` +
    `<g class="dg-root">${title}${edges}${nodes}</g></svg>`
  );
}

/**
 * Render one diagram overlay to its parts.
 * @param {Object} opts
 * @param {string} opts.name - layout name (e.g. 'flow')
 * @param {Object} opts.spec - the agent-written spec
 * @param {{w:number,h:number}} opts.box - the real frame box in pixels
 * @param {string} opts.ovId - the overlay's DOM id (e.g. 'ov-3')
 * @param {Object} [opts.theme] - derived theme (defaults to style)
 * @param {{start:number,dur:number}} opts.timing - overlay start and length
 * @returns {{svg,css,js,frame}|null}
 */
export function renderDiagram({ name, spec, box, ovId, theme = null, timing }) {
  const layout = getLayout(name);
  if (!layout) return null;
  if (!box || !(box.w > 0) || !(box.h > 0)) return null;
  if (validateDiagram(spec, layout).length) return null;

  const t = theme ?? deriveTheme();
  const geo = layout.geometry(spec, box, t);
  const svg = buildSvg(geo, t, ovId);
  const js = typeof layout.animate === 'function'
    ? layout.animate(geo, { t0: timing?.start ?? 0, dur: timing?.dur ?? 0, ovId, theme: t })
    : [];
  return { svg, css: DIAGRAM_CSS, js, frame: layout.frame };
}
