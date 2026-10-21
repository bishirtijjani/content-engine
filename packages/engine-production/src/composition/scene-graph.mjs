import fs from 'node:fs';
import path from 'node:path';
import { resolveAssetPath } from '../style.mjs';
import { ICON_PATHS } from '../diagrams/icons.mjs';

const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// A real bitmap/vector asset referenced by an `image` node is inlined as a data
// URI so the built composition is one self-contained file (no network, no fs at
// render time). The same asset referenced twice is encoded once.
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};
const assetCache = new Map();

/** Re-exported for back-compat: the one asset resolver now lives in style.mjs. */
export { resolveAssetPath };

/** An asset as a data URI (cached). Throws when the file is missing. */
export function resolveAssetDataUri(src) {
  if (typeof src === 'string' && src.startsWith('data:')) return src;
  if (assetCache.has(src)) return assetCache.get(src);
  const abs = resolveAssetPath(src);
  if (!abs) throw new Error(`asset not found: ${src}`);
  const mime = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  const uri = `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
  assetCache.set(src, uri);
  return uri;
}

/** The inline SVG for a Tabler icon (stroke: currentColor), or '' for an unknown
 *  name. The one icon renderer for the whole engine (concept + scene graph). */
export function iconSvg(name, { size = 64, stroke = 2, color = 'currentColor', opacity = 1 } = {}) {
  const paths = ICON_PATHS[name];
  if (!paths) return '';
  const px = Math.round(size);
  const body = paths.map((d) => `<path d="${esc(d)}"/>`).join('');
  return `<svg class="cx-icon" viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" ` +
    `stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" ` +
    `style="color:${color};opacity:${opacity};display:block;flex:0 0 auto" aria-hidden="true">${body}</svg>`;
}

// A connector's geometry is authored in absolute canvas fractions (0..1) and
// rendered in design-canvas pixels (viewBox == the div's own rect) so an
// arrowhead is never stretched. One `<path>`, so the `draw` op traces it as one
// stroke — line then head.
function edgePath(points, { arrow = true, arrowSize = 26, designW = 1080, designH = 1920 } = {}) {
  const pts = (Array.isArray(points) ? points : []).filter((p) => p && isNum(p.x) && isNum(p.y));
  if (pts.length < 2) return '';
  const px = (p) => r3(p.x * designW);
  const py = (p) => r3(p.y * designH);
  const seg = [`M ${px(pts[0])} ${py(pts[0])}`];
  for (let i = 1; i < pts.length; i++) seg.push(`L ${px(pts[i])} ${py(pts[i])}`);
  if (arrow) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const ang = Math.atan2((b.y - a.y) * designH, (b.x - a.x) * designW);
    const spread = 0.44; // radians
    const lx = px(b) - arrowSize * Math.cos(ang - spread);
    const ly = py(b) - arrowSize * Math.sin(ang - spread);
    const rx = px(b) - arrowSize * Math.cos(ang + spread);
    const ry = py(b) - arrowSize * Math.sin(ang + spread);
    seg.push(`M ${r3(lx)} ${r3(ly)} L ${px(b)} ${py(b)} L ${r3(rx)} ${r3(ry)}`);
  }
  return seg.join(' ');
}

/** Format a figure the way the runtime count-up helper does (must match). */
export function formatFigure(value, format = 'int') {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  const grouped = Math.round(n).toLocaleString('en-US');
  switch (format) {
    case 'currency': return `$${grouped}`;
    case 'percent': return `${grouped}%`;
    case 'decimal': return String(Math.round(n * 10) / 10);
    default: return grouped;
  }
}

function isNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function clamp01(n) {
  if (!isNum(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function validateSceneGraph(sg, opts = {}) {
  const problems = [];
  if (!sg || typeof sg !== 'object') {
    problems.push('sceneGraph must be an object');
    return problems;
  }
  if (!sg.scene || typeof sg.scene !== 'object') {
    problems.push('sceneGraph.scene is required');
  }
  if (!Array.isArray(sg.nodes)) {
    problems.push('sceneGraph.nodes must be an array');
  } else {
    sg.nodes.forEach((n, i) => {
      if (!n || typeof n !== 'object') {
        problems.push(`nodes[${i}] must be an object`);
        return;
      }
      if (!n.id || typeof n.id !== 'string') {
        problems.push(`nodes[${i}].id must be a string`);
      }
      if (!n.type || typeof n.type !== 'string') {
        problems.push(`nodes[${i}].type must be a string`);
      }
      if (n.layout && typeof n.layout === 'object') {
        const l = n.layout;
        ['x', 'y', 'w', 'h'].forEach((k) => {
          if (l[k] != null && clamp01(l[k]) == null) {
            problems.push(`nodes[${i}].layout.${k} must be 0-1 if set`);
          }
        });
      }
      if (n.type === 'figure' && n.value != null && !isNum(n.value)) {
        problems.push(`nodes[${i}].value must be a number for a figure`);
      }
      if (n.type === 'icon' && n.name && !ICON_PATHS[n.name]) {
        problems.push(`nodes[${i}].name "${n.name}" is not a known icon`);
      }
      if (n.icon && !ICON_PATHS[n.icon]) {
        problems.push(`nodes[${i}].icon "${n.icon}" is not a known icon`);
      }
      if (n.type === 'image') {
        if (!n.src || typeof n.src !== 'string') problems.push(`nodes[${i}] (image) needs a "src"`);
        else if (!n.src.startsWith('data:') && !resolveAssetPath(n.src)) problems.push(`nodes[${i}] (image) src "${n.src}" does not resolve to a file`);
      }
      if (n.type === 'edge') {
        const pts = Array.isArray(n.points) ? n.points : [];
        if (pts.length < 2) problems.push(`nodes[${i}] (edge) needs at least two {x,y} points`);
        pts.forEach((p, k) => {
          if (!p || !isNum(p.x) || !isNum(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
            problems.push(`nodes[${i}].points[${k}] must be {x,y} with 0-1 values`);
          }
        });
      }
    });
  }
  if (sg.animations && !Array.isArray(sg.animations)) {
    problems.push('sceneGraph.animations must be an array');
  }
  return problems;
}

function collectSlots(n, slots) {
  if (!n || typeof n !== 'object') return;
  if (n.id && typeof n.id === 'string') slots.push(n.id);
  if (Array.isArray(n.children)) {
    for (const c of n.children) collectSlots(c, slots);
  }
}

export function nodeSlots(sg) {
  const slots = [];
  if (sg && Array.isArray(sg.nodes)) {
    for (const n of sg.nodes) {
      collectSlots(n, slots);
    }
  }
  return slots;
}

function nodeHtml(n, depth = 0, ctx = {}) {
  const { isRoot = false, designW = 1080, designH = 1920 } = ctx;
  const id = n.id || `n${depth}`;
  const style = [];
  if (n.layout && typeof n.layout === 'object') {
    const l = n.layout;
    if (isNum(l.x)) style.push(`left:${r3(l.x * 100)}%`);
    if (isNum(l.y)) style.push(`top:${r3(l.y * 100)}%`);
    if (isNum(l.w)) style.push(`width:${r3(l.w * 100)}%`);
    if (isNum(l.h)) style.push(`height:${r3(l.h * 100)}%`);
  }
  if (n.style && typeof n.style === 'object') {
    Object.entries(n.style).forEach(([k, v]) => {
      if (v != null) style.push(`${k}:${v}`);
    });
  }
  if (n.visible === false) style.push('opacity:0');
  let inner = '';
  if (n.type === 'figure') {
    // A numeric figure counts up: the .cx-num span carries the exact target so
    // the runtime can animate 0 -> value, and holds the exact value so a still
    // (and the final frame) is always correct without running the timeline.
    const finalText = n.text && n.text.value != null ? n.text.value : formatFigure(n.value, n.format);
    inner = `<span class="cx-num" data-count-to="${esc(String(n.value ?? ''))}" ` +
      `data-count-format="${esc(n.format || 'int')}">${esc(finalText)}</span>`;
  } else if (n.type === 'icon') {
    inner = iconSvg(n.name, { size: n.size ?? 64, stroke: n.stroke ?? 2, color: n.color ?? 'currentColor', opacity: n.opacity ?? 1 });
  } else if (n.type === 'image') {
    // A real raster/vector asset, inlined as a data URI (self-contained build).
    const uri = n.src.startsWith('data:') ? n.src : resolveAssetDataUri(n.src);
    const fit = n.fit === 'contain' ? 'contain' : 'cover';
    const radius = n.radius != null ? `border-radius:${n.radius}px;` : '';
    const pos = n.focus ? `object-position:${n.focus[0] * 100}% ${n.focus[1] * 100}%;` : '';
    inner = `<img class="cx-img" src="${uri}" alt="${esc(n.alt ?? '')}" ` +
      `style="width:100%;height:100%;object-fit:${fit};${pos}${radius}display:block" />`;
  } else if (n.type === 'edge') {
    // A connector: a line (or elbow) with an open arrowhead, authored in absolute
    // canvas fractions. Rendered in the box's own pixel rect so the arrowhead is
    // exact; one <path> so the `draw` op traces line-then-head as one stroke.
    const l = n.layout ?? { x: 0, y: 0, w: 1, h: 1 };
    const vb = `${r3((l.x ?? 0) * designW)} ${r3((l.y ?? 0) * designH)} ${r3((l.w ?? 1) * designW)} ${r3((l.h ?? 1) * designH)}`;
    const d = edgePath(n.points, { arrow: n.arrow !== false, arrowSize: n.arrowSize ?? 26, designW, designH });
    const dash = n.dashed ? ` stroke-dasharray="${esc(n.dash ?? '12 10')}"` : '';
    inner = `<svg class="cx-edge" viewBox="${vb}" preserveAspectRatio="none" ` +
      `style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">` +
      `<path d="${esc(d)}" fill="none" stroke="${n.stroke || 'currentColor'}" stroke-width="${n.strokeWidth ?? 3}" ` +
      `stroke-linecap="round" stroke-linejoin="round"${dash}/></svg>`;
  } else if (n.text && typeof n.text === 'object') {
    inner = (n.icon ? iconSvg(n.icon, { size: n.iconSize ?? 40, stroke: n.iconStroke ?? 2, color: n.iconColor ?? 'currentColor', opacity: n.iconOpacity ?? 1 }) : '') + esc(n.text.value ?? '');
  } else if (typeof n.text === 'string') {
    inner = (n.icon ? iconSvg(n.icon, { size: n.iconSize ?? 40, stroke: n.iconStroke ?? 2, color: n.iconColor ?? 'currentColor', opacity: n.iconOpacity ?? 1 }) : '') + esc(n.text);
  }
  if (Array.isArray(n.children)) {
    inner += n.children.map((c) => nodeHtml(c, depth + 1, { ...ctx, isRoot: false })).join('');
  }
  if (n.svg && typeof n.svg === 'object') {
    const s = n.svg;
    if (s.type === 'circle') {
      const cx = isNum(s.cx) ? s.cx * 100 : 50;
      const cy = isNum(s.cy) ? s.cy * 100 : 50;
      const r = isNum(s.r) ? s.r * 100 : 40;
      inner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%"><circle cx="${r3(cx)}" cy="${r3(cy)}" r="${r3(r)}" fill="none" stroke="${s.stroke || 'white'}" stroke-width="${s.strokeWidth || 4}" stroke-linecap="${s.strokeLinecap || 'butt'}"/></svg>`;
    } else if (s.type === 'arc') {
      const cx = isNum(s.cx) ? s.cx * 100 : 50;
      const cy = isNum(s.cy) ? s.cy * 100 : 50;
      const r = isNum(s.r) ? s.r * 100 : 40;
      const start = s.startAngle ?? 0;
      const end = s.endAngle ?? Math.PI / 2;
      const sx = cx + r * Math.cos(start);
      const sy = cy + r * Math.sin(start);
      const ex = cx + r * Math.cos(end);
      const ey = cy + r * Math.sin(end);
      inner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%"><path d="M ${r3(sx)} ${r3(sy)} A ${r3(r)} ${r3(r)} 0 ${Math.abs(end-start)>Math.PI?1:0} 1 ${r3(ex)} ${r3(ey)}" fill="none" stroke="${s.stroke || 'white'}" stroke-width="${s.strokeWidth || 4}" stroke-linecap="${s.strokeLinecap || 'round'}"/></svg>`;
    }
  }
  if (n.svgpath && typeof n.svgpath === 'object') {
    const sp = n.svgpath;
    inner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%"><path d="${esc(sp.d)}" fill="none" stroke="${sp.stroke || 'white'}" stroke-width="${sp.strokeWidth || 2}" stroke-linecap="${sp.strokeLinecap || 'butt'}"/></svg>`;
  }
  const styleStr = style.length ? ` style="${style.join(';')}"` : '';
  // Every revealable node carries `data-slot` — the one canonical selector the
  // motion layer addresses (concept and scene graph alike). The root is the scene
  // container itself, so it carries only `data-sg` (identity) and no data-slot:
  // the sceneLines [data-slot] sweep must hide the slots inside it, never it.
  const slotAttr = isRoot ? '' : ` data-slot="${esc(id)}"`;
  return `<div class="cx-sg" data-sg="${esc(id)}"${slotAttr}${styleStr}>${inner}</div>`;
}

export function sceneGraphToHtml(sg, ctx = {}) {
  const nodes = sg && Array.isArray(sg.nodes) ? sg.nodes : [];
  const root = nodes.find((n) => n && n.id === 'root') || { id: 'root', type: 'group', children: nodes.filter((n) => n && n.id !== 'root') };
  const orientation = ctx.orientation ?? 'portrait';
  const designW = orientation === 'portrait' ? 1080 : 1920;
  const designH = orientation === 'portrait' ? 1920 : 1080;
  const inner = nodeHtml(root, 0, { isRoot: true, designW, designH });
  if (!isNum(ctx.width)) return inner;
  // Same contract as the legacy recipes: author on a fixed design canvas, scale
  // to the actual render size — a 1080x1920 still and a 270x480 preview are the
  // SAME design, never a re-layout.
  const scale = ctx.width / designW;
  return `<div class="cx-sg-scale" style="position:absolute;left:0;top:0;width:${designW}px;height:${designH}px;transform:scale(${r3(scale)});transform-origin:0 0">${inner}</div>`;
}

function createTextNode(id, text, layout, style = {}) {
  return { id, type: 'text', layout, text: { value: String(text ?? '') }, style };
}

function createGroup(id, children, layout = null, style = {}) {
  const g = { id, type: 'group', children };
  if (layout) g.layout = layout;
  if (Object.keys(style).length) g.style = style;
  return g;
}

export function legacyToSceneGraph(snapshot, ctx = {}) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const c = snapshot.composition ?? {};
  const concept = snapshot.concept;
  const nodes = [];
  const animations = [];
  if (concept === 'bars') {
    const rootChildren = [];
    rootChildren.push(createTextNode('head', c.kicker, { x: 0.06, y: 0.08, w: 0.88, h: 0.1 }, { 'text-align': 'center', 'font-family': 'var(--brand-display)', 'font-weight': '900', 'font-size': '72px', color: 'var(--brand-text)' }));
    if (c.headline) {
      rootChildren.push(createTextNode('headline', c.headline, { x: 0.06, y: 0.18, w: 0.88, h: 0.08 }, { 'text-align': 'center', 'font-size': '40px', color: 'var(--brand-text)', opacity: '0.9' }));
    }
    const bars = Array.isArray(c.bars) ? c.bars : [];
    bars.forEach((b, i) => {
      const baseY = 0.28 + i * 0.22;
      const group = createGroup(`bar-${i}`, [], { x: 0.06, y: baseY, w: 0.88, h: 0.16 });
      const label = createTextNode(`bar-${i}-label`, b.label, { x: 0, y: 0, w: 0.7, h: 0.5 }, { 'font-size': '32px', color: 'var(--brand-text)' });
      const val = createTextNode(`bar-${i}-val`, String(b.display ?? b.value), { x: 0.7, y: 0, w: 0.3, h: 0.5 }, { 'text-align': 'right', 'font-size': '32px', color: 'var(--brand-text)' });
      const max = Number(b.max) || 1;
      const pct = Math.max(0, Math.min(1, Number(b.value) / max));
      const fillColor = b.tone === 'amber' ? 'var(--brand-orange)' : 'var(--brand-text)';
      const barBg = createGroup(`bar-${i}-bg`, [], { x: 0, y: 0.55, w: 1, h: 0.22 }, { 'border-radius': '11px', 'background': 'rgba(255,255,255,.18)', 'overflow': 'hidden' });
      const barFill = createGroup(`bar-${i}-fill`, [], { x: 0, y: 0, w: pct, h: 1 }, { 'border-radius': '11px', 'background': fillColor });
      barBg.children.push(barFill);
      group.children.push(label, val, barBg);
      rootChildren.push(group);
    });
    nodes.push({ id: 'root', type: 'group', children: rootChildren });
  } else {
    nodes.push({ id: 'root', type: 'group', children: [] });
  }
  const sg = {
    scene: { id: snapshot.id || 's', orientation: snapshot.frame || 'full', duration: snapshot.end - snapshot.start },
    nodes,
    animations,
    transitions: snapshot.transitionOut || { technique: 'crossfade' },
  };
  return sg;
}
