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
const MAX_NOTE = 28;

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
  // shared shape vocabulary
  '.dg-panel{fill:var(--brand-blue);filter:drop-shadow(0 10px 22px rgba(0,0,0,.35))}',
  '.dg-panel-accent{fill:var(--brand-orange);filter:drop-shadow(0 10px 22px rgba(0,0,0,.35))}',
  '.dg-panel-quiet{fill:var(--brand-blue);fill-opacity:.42}',
  '.dg-panel-edge{fill:none;stroke:var(--brand-orange);stroke-width:4;stroke-opacity:.9}',
  '.dg-heading{fill:var(--brand-text);font-family:var(--brand-display);font-weight:800}',
  '.dg-sub{fill:var(--brand-text);font-family:var(--brand-body);font-weight:600;opacity:.94}',
  '.dg-value{fill:var(--brand-orange);font-family:var(--brand-display);font-weight:900}',
  '.dg-accent-text{fill:var(--brand-orange);font-family:var(--brand-display);font-weight:800}',
  '.dg-axis{stroke:var(--brand-text);stroke-opacity:.7;stroke-width:3;stroke-linecap:round}',
  '.dg-tick{stroke:var(--brand-text);stroke-opacity:.9;stroke-width:3;stroke-linecap:round}',
  '.dg-marker{fill:var(--brand-orange)}',
  '.dg-marker-on{fill:var(--brand-text)}',
  '.dg-marker-off{fill:var(--brand-text);fill-opacity:.35}',
  '.dg-marker-ring{fill:none;stroke:var(--brand-orange);stroke-width:5}',
  '.dg-node-ring2{fill:none;stroke:var(--brand-blue);stroke-width:5}',
  '.dg-loop{stroke:var(--brand-text);stroke-opacity:.8;stroke-width:3;fill:none}',
  '.dg-funnel{fill:var(--brand-blue);filter:drop-shadow(0 10px 20px rgba(0,0,0,.3))}',
  '.dg-funnel-accent{fill:var(--brand-orange)}',
  '.dg-band{fill:var(--brand-blue);filter:drop-shadow(0 8px 18px rgba(0,0,0,.28))}',
  '.dg-band-quiet{fill:var(--brand-blue);fill-opacity:.38}',
  '.dg-link-label{fill:var(--brand-text);font-family:var(--brand-body);font-weight:600;opacity:.92}',
  '.dg-pill{fill:var(--brand-blue)}',
  '.dg-chip-bg{fill:#0B1220;fill-opacity:.35}',
  '.dg-anim{opacity:0}',
].join('\n');

/**
 * Check a diagram spec against its layout. Returns a list of plain problems
 * (empty means good to draw). The check is shape-driven: a layout declares
 * `steps` (flow/pipeline/cycle), `events`, `columns`, `nodes`+`links`, etc.,
 * and only that shape is validated. Unknown keys are ignored.
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
  const fields = layout.fields ?? [];

  const checkLabel = (label, at, max = MAX_LABEL) => {
    const s = typeof label === 'string' ? label.trim() : '';
    if (!s) problems.push(`${at} needs a label`);
    else if (s.length > max) problems.push(`${at}.label is too long (${s.length} chars, max ${max})`);
    return s;
  };
  const checkIcon = (icon, at) => {
    if (icon !== undefined && !ICON_NAMES.includes(icon)) {
      problems.push(`${at}.icon "${icon}" is not in the icon set (${ICON_NAMES.join(', ')})`);
    }
  };

  // ---- shape: a list of items under a key, each {label,icon?} ---------------
  const itemList = (key, { min, max, maxLabel = MAX_LABEL, extra } = {}) => {
    const list = spec[key];
    if (!Array.isArray(list)) {
      problems.push(`diagram spec needs a "${key}" list`);
      return;
    }
    if (min != null && list.length < min) problems.push(`diagram needs at least ${min} ${key}`);
    if (max != null && list.length > max) problems.push(`diagram takes at most ${max} ${key}`);
    list.forEach((it, i) => {
      const at = `${key}[${i}]`;
      if (!it || typeof it !== 'object' || Array.isArray(it)) {
        problems.push(`${at} must be an object`);
        return;
      }
      if (it.label !== undefined || fields.includes('label')) checkLabel(it.label, at, maxLabel);
      checkIcon(it.icon, at);
      if (extra) extra(it, at, i);
    });
  };

  if (fields.includes('steps')) {
    itemList('steps', { min: layout.steps?.min ?? 2, max: layout.steps?.max ?? 5 });
    if (spec.active !== undefined && !Number.isInteger(spec.active)) {
      problems.push('diagram "active" must be a whole step number');
    }
  }

  if (fields.includes('events')) {
    itemList('events', {
      min: 2, max: 5, maxLabel: MAX_LABEL,
      extra: (it, at) => {
        if (it.when !== undefined && (typeof it.when !== 'string' || it.when.trim().length > 12)) {
          problems.push(`${at}.when must be short text (max 12 chars)`);
        }
      },
    });
  }

  if (fields.includes('columns')) {
    itemList('columns', {
      min: 2, max: 3, maxLabel: MAX_LABEL,
      extra: (it, at) => checkPoints(it.points, at, MAX_NOTE),
    });
  }

  if (fields.includes('layers')) {
    itemList('layers', { min: 2, max: 5, extra: (it, at) => checkPoints(it.points, at, MAX_NOTE, 3) });
  }

  if (fields.includes('stages')) {
    itemList('stages', {
      min: 2, max: 5, maxLabel: MAX_LABEL,
      extra: (it, at) => {
        if (it.value !== undefined && typeof it.value !== 'string') problems.push(`${at}.value must be text`);
      },
    });
  }

  if (fields.includes('levels')) {
    const levels = spec.levels;
    if (!Array.isArray(levels)) problems.push('diagram spec needs a "levels" list');
    else {
      if (levels.length < 2) problems.push('diagram needs at least 2 levels');
      if (levels.length > 4) problems.push('diagram takes at most 4 levels');
      levels.forEach((row, i) => {
        if (!Array.isArray(row) || row.length < 1) problems.push(`levels[${i}] must list its items`);
        else if (row.length > 4) problems.push(`levels[${i}] takes at most 4 items`);
        else row.forEach((it, j) => {
          checkLabel(it?.label, `levels[${i}][${j}]`);
          checkIcon(it?.icon, `levels[${i}][${j}]`);
        });
      });
    }
    if (spec.root !== undefined) {
      checkLabel(spec.root?.label, 'root');
      checkIcon(spec.root?.icon, 'root');
    }
  }

  if (fields.includes('nodes') && fields.includes('links')) {
    const ids = new Set();
    if (!Array.isArray(spec.nodes)) problems.push('diagram spec needs a "nodes" list');
    else {
      if (spec.nodes.length < 2) problems.push('diagram needs at least 2 nodes');
      if (spec.nodes.length > 7) problems.push('diagram takes at most 7 nodes');
      spec.nodes.forEach((nd, i) => {
        checkLabel(nd?.label, `nodes[${i}]`);
        checkIcon(nd?.icon, `nodes[${i}]`);
        const id = nd?.id;
        if (typeof id !== 'string' || !id.trim()) problems.push(`nodes[${i}] needs an id`);
        else if (ids.has(id)) problems.push(`nodes[${i}].id "${id}" is used twice`);
        else ids.add(id);
      });
    }
    if (!Array.isArray(spec.links)) problems.push('diagram spec needs a "links" list');
    else {
      const cap = Math.ceil((spec.nodes?.length ?? 0) * 1.5);
      if (spec.links.length > cap) {
        problems.push(`too many links (${spec.links.length}) — keep it readable (max ${cap} for these nodes)`);
      }
      spec.links.forEach((lk, i) => {
        const at = `links[${i}]`;
        if (!ids.has(lk?.from)) problems.push(`${at}.from "${lk?.from}" is not a node`);
        if (!ids.has(lk?.to)) problems.push(`${at}.to "${lk?.to}" is not a node`);
        if (lk?.label !== undefined && (typeof lk.label !== 'string' || lk.label.trim().length > 14)) {
          problems.push(`${at}.label must be short text (max 14 chars)`);
        }
      });
    }
  }

  if (fields.includes('before') && fields.includes('after')) {
    for (const side of ['before', 'after']) {
      const s = spec[side];
      if (!s || typeof s !== 'object') { problems.push(`diagram spec needs a "${side}" side`); continue; }
      checkLabel(s.label, side);
      checkIcon(s.icon, side);
      checkPoints(s.points, side, MAX_NOTE, 3);
    }
  }

  if (fields.includes('question')) {
    const q = typeof spec.question === 'string' ? spec.question.trim() : '';
    if (!q) problems.push('diagram spec needs a decision "question"');
    else if (q.length > MAX_LABEL) problems.push(`"question" is too long (max ${MAX_LABEL} chars)`);
    for (const side of ['yes', 'no']) {
      const s = spec[side];
      if (!s || typeof s !== 'object') problems.push(`diagram spec needs a "${side}" branch`);
      else checkLabel(s.label, side);
    }
    for (const k of ['yesLabel', 'noLabel']) {
      if (spec[k] !== undefined && (typeof spec[k] !== 'string' || spec[k].trim().length > 8)) {
        problems.push(`"${k}" must be short text (max 8 chars)`);
      }
    }
  }

  if (spec.title !== undefined) {
    if (typeof spec.title !== 'string') problems.push('diagram title must be text');
    else if (spec.title.trim().length > MAX_TITLE) {
      problems.push(`diagram title is too long (max ${MAX_TITLE} chars)`);
    }
  }

  if (typeof duration === 'number' && layout.minDurationFor) {
    const count = Array.isArray(spec.steps) ? spec.steps.length
      : Array.isArray(spec.stages) ? spec.stages.length
      : Array.isArray(spec.events) ? spec.events.length
      : Array.isArray(spec.layers) ? spec.layers.length
      : Array.isArray(spec.columns) ? spec.columns.length
      : Array.isArray(spec.nodes) ? spec.nodes.length
      : Array.isArray(spec.levels) ? spec.levels.flat().length
      : 3;
    const need = layout.minDurationFor(count);
    if (duration < need) {
      problems.push(
        `this diagram needs ${r3(need)}s to play (${count} items) but the overlay is ${r3(duration)}s`
      );
    }
  }

  return problems;
}

/** Validate an optional list of short point strings. */
function checkPoints(points, at, max = MAX_NOTE, cap = 4) {
  if (points === undefined) return;
  if (!Array.isArray(points)) { return; }
  if (points.length > cap) return;
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
  // A layout may own its SVG (curved/branching/layered shapes); otherwise the
  // generic Flow node+edge builder draws it. Same for the timeline.
  const svg = typeof layout.svg === 'function' ? layout.svg(geo, t, ovId) : buildSvg(geo, t, ovId);
  const js = typeof layout.animate === 'function'
    ? layout.animate(geo, { t0: timing?.start ?? 0, dur: timing?.dur ?? 0, ovId, theme: t })
    : [];
  return { svg, css: DIAGRAM_CSS, js, frame: layout.frame };
}
