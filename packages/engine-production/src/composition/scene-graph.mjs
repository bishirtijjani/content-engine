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
        if (n.curve != null && !['polyline', 'smooth', 'arc'].includes(n.curve)) {
          problems.push(`nodes[${i}].curve must be polyline, smooth or arc`);
        }
      }
      if (n.type === 'shape') {
        const kinds = ['rect', 'roundRect', 'circle', 'ellipse', 'polygon', 'diamond', 'trapezoid', 'chevron', 'line', 'tick', 'arc', 'pie', 'donut', 'path'];
        if (n.shape != null && !kinds.includes(n.shape)) problems.push(`nodes[${i}].shape "${n.shape}" is not a known shape`);
        if (n.shape === 'polygon' && !Array.isArray(n.points)) problems.push(`nodes[${i}] (polygon) needs points`);
        if (n.shape === 'path' && typeof n.d !== 'string') problems.push(`nodes[${i}] (path) needs a "d" string`);
      }
      if (n.type === 'table') {
        if (!Array.isArray(n.columns)) problems.push(`nodes[${i}] (table) needs a columns array`);
        if (!Array.isArray(n.rows)) problems.push(`nodes[${i}] (table) needs a rows array`);
      }
      if (n.type === 'code' && !Array.isArray(n.lines)) problems.push(`nodes[${i}] (code) needs a lines array`);
      if (n.type === 'terminal' && !Array.isArray(n.lines)) problems.push(`nodes[${i}] (terminal) needs a lines array`);
      if (n.type === 'chat' && !Array.isArray(n.messages)) problems.push(`nodes[${i}] (chat) needs a messages array`);
      if (n.type === 'frame' && n.chrome != null && !['browser', 'phone'].includes(n.chrome)) {
        problems.push(`nodes[${i}].chrome must be browser or phone`);
      }
      if (n.text && typeof n.text === 'object' && n.wrap != null && !isNum(Number(n.wrap))) {
        problems.push(`nodes[${i}].wrap must be a number`);
      }
      if (n.static != null && typeof n.static !== 'boolean') problems.push(`nodes[${i}].static must be a boolean`);
    });
  }
  if (sg.animations && !Array.isArray(sg.animations)) {
    problems.push('sceneGraph.animations must be an array');
  }
  return problems;
}

function collectSlots(n, slots) {
  if (!n || typeof n !== 'object') return;
  if (n.id && typeof n.id === 'string' && !n.static) slots.push(n.id);
  if (n.type === 'table' && n.rowSlots && Array.isArray(n.rows)) {
    n.rows.forEach((_, i) => slots.push(`row-${i}`));
  }
  if (n.type === 'chat' && n.msgSlots && Array.isArray(n.messages)) {
    n.messages.forEach((_, i) => slots.push(`msg-${i}`));
  }
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

// ---- native diagram primitives ---------------------------------------------
// Shapes are drawn in the node's own design-pixel box, so a 1080-wide still and
// a 270-wide preview are the same geometry (the canvas is scaled uniformly).
function shapeInner(n, W, H) {
  const fill = n.fill ?? 'none';
  const stroke = n.stroke ?? 'none';
  const sw = n.strokeWidth ?? 3;
  const strokeAttrs = stroke !== 'none'
    ? ` stroke="${esc(stroke)}" stroke-width="${px2(sw)}" stroke-linecap="round" stroke-linejoin="round"`
    : '';
  const dash = n.dash ? ` stroke-dasharray="${esc(n.dash)}"` : '';
  const op = n.opacity != null ? ` opacity="${esc(String(n.opacity))}"` : '';
  const paint = ` fill="${esc(fill)}"${strokeAttrs}${dash}${op}`;
  const kind = n.shape || 'rect';
  const r = n.r ?? n.radius ?? 0;
  let body = '';
  switch (kind) {
    case 'rect':
    case 'roundRect':
      body = `<rect x="0" y="0" width="${px2(W)}" height="${px2(H)}" rx="${px2(r)}" ry="${px2(r)}"${paint}/>`;
      break;
    case 'circle': {
      const d = Math.min(W, H);
      body = `<ellipse cx="${px2(W / 2)}" cy="${px2(H / 2)}" rx="${px2(d / 2)}" ry="${px2(d / 2)}"${paint}/>`;
      break;
    }
    case 'ellipse':
      body = `<ellipse cx="${px2(W / 2)}" cy="${px2(H / 2)}" rx="${px2(W / 2)}" ry="${px2(H / 2)}"${paint}/>`;
      break;
    case 'diamond':
      body = `<polygon points="${px2(W / 2)},0 ${px2(W)},${px2(H / 2)} ${px2(W / 2)},${px2(H)} 0,${px2(H / 2)}"${paint}/>`;
      break;
    case 'trapezoid': {
      const top = Number(n.top ?? 0.6);
      const ix = (W * (1 - top)) / 2;
      body = `<polygon points="${px2(ix)},0 ${px2(W - ix)},0 ${px2(W)},${px2(H)} 0,${px2(H)}"${paint}/>`;
      break;
    }
    case 'chevron': {
      const notch = W * Number(n.notch ?? 0.18);
      body = `<polygon points="0,0 ${px2(W - notch)},0 ${px2(W)},${px2(H / 2)} ${px2(W - notch)},${px2(H)} 0,${px2(H)} ${px2(notch)},${px2(H / 2)}"${paint}/>`;
      break;
    }
    case 'polygon': {
      const pts = (n.points ?? []).map((p) => `${px2((p.x ?? 0) * W)},${px2((p.y ?? 0) * H)}`).join(' ');
      body = `<polygon points="${pts}"${paint}/>`;
      break;
    }
    case 'line':
      body = `<line x1="${px2((n.x1 ?? 0) * W)}" y1="${px2((n.y1 ?? 0.5) * H)}" x2="${px2((n.x2 ?? 1) * W)}" y2="${px2((n.y2 ?? 0.5) * H)}"${strokeAttrs}${dash}${op}/>`;
      break;
    case 'tick':
      body = `<line x1="0" y1="${px2(H / 2)}" x2="${px2(W)}" y2="${px2(H / 2)}"${strokeAttrs}${dash}${op}/>`;
      break;
    case 'arc':
    case 'pie':
    case 'donut': {
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.max(0, Math.min(W, H) / 2 - sw / 2);
      const a0 = ((n.startAngle ?? 0) * Math.PI) / 180;
      const a1 = ((n.endAngle ?? 360) * Math.PI) / 180;
      const p0 = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)];
      const p1 = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
      const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
      const inner = R * Number(n.inner ?? (kind === 'donut' ? 0.62 : 0));
      // A full 360° sweep cannot be drawn as one SVG arc (start === end).
      // Pie becomes a circle; a donut becomes two outer + two inner arcs.
      if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6) {
        if (kind === 'arc') {
          body = `<circle cx="${px2(cx)}" cy="${px2(cy)}" r="${px2(R)}" fill="none"${strokeAttrs}${dash}${op}/>`;
        } else if (inner > 0) {
          const am = a0 + Math.PI;
          const p0 = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)];
          const pm = [cx + R * Math.cos(am), cy + R * Math.sin(am)];
          const q0 = [cx + inner * Math.cos(a0), cy + inner * Math.sin(a0)];
          const qm = [cx + inner * Math.cos(am), cy + inner * Math.sin(am)];
          body = `<path d="M ${px2(p0[0])} ${px2(p0[1])} A ${px2(R)} ${px2(R)} 0 1 1 ${px2(pm[0])} ${px2(pm[1])} A ${px2(R)} ${px2(R)} 0 1 1 ${px2(p0[0])} ${px2(p0[1])} L ${px2(q0[0])} ${px2(q0[1])} A ${px2(inner)} ${px2(inner)} 0 1 0 ${px2(qm[0])} ${px2(qm[1])} A ${px2(inner)} ${px2(inner)} 0 1 0 ${px2(q0[0])} ${px2(q0[1])} Z"${paint}/>`;
        } else {
          body = `<circle cx="${px2(cx)}" cy="${px2(cy)}" r="${px2(R)}"${paint}/>`;
        }
      } else if (kind === 'arc') {
        body = `<path d="M ${px2(p0[0])} ${px2(p0[1])} A ${px2(R)} ${px2(R)} 0 ${large} 1 ${px2(p1[0])} ${px2(p1[1])}" fill="none"${strokeAttrs}${dash}${op}/>`;
      } else if (inner > 0) {
        const q0 = [cx + inner * Math.cos(a0), cy + inner * Math.sin(a0)];
        const q1 = [cx + inner * Math.cos(a1), cy + inner * Math.sin(a1)];
        body = `<path d="M ${px2(p0[0])} ${px2(p0[1])} A ${px2(R)} ${px2(R)} 0 ${large} 1 ${px2(p1[0])} ${px2(p1[1])} L ${px2(q1[0])} ${px2(q1[1])} A ${px2(inner)} ${px2(inner)} 0 ${large} 0 ${px2(q0[0])} ${px2(q0[1])} Z"${paint}/>`;
      } else {
        body = `<path d="M ${px2(cx)} ${px2(cy)} L ${px2(p0[0])} ${px2(p0[1])} A ${px2(R)} ${px2(R)} 0 ${large} 1 ${px2(p1[0])} ${px2(p1[1])} Z"${paint}/>`;
      }
      break;
    }
    case 'path':
      body = `<path d="${esc(n.d ?? '')}"${paint}/>`;
      break;
    default:
      body = '';
  }
  return `<svg viewBox="0 0 ${px2(W)} ${px2(H)}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible" aria-hidden="true">${body}</svg>`;
}

const TONES = {
  blue: { bg: 'var(--brand-blue)', fg: 'var(--brand-text)' },
  amber: { bg: 'var(--brand-surface)', fg: 'var(--brand-blue)' },
  accent: { bg: 'var(--brand-orange)', fg: 'var(--brand-text)' },
  ghost: { bg: 'rgba(255,255,255,0.14)', fg: 'var(--brand-text)' },
  ink: { bg: 'rgba(11,18,32,0.55)', fg: 'var(--brand-text)' },
};

function surface(tone = 'ghost', { r = 28, pad = 0, shadow = true } = {}) {
  const t = TONES[tone] ?? TONES.ghost;
  return `background:${t.bg};color:${t.fg};border-radius:${r}px;padding:${pad}px;` +
    (shadow ? 'box-shadow:0 26px 64px rgba(0,0,0,.30);' : '');
}

function tableInner(n) {
  const cols = (n.columns ?? []).map((c) => (typeof c === 'string' ? { label: c } : c));
  const rows = Array.isArray(n.rows) ? n.rows : [];
  const header = n.header !== false;
  const t = TONES[n.tone ?? 'ghost'] ?? TONES.ghost;
  const fg = t.fg;
  const headBg = n.headerTone ? (TONES[n.headerTone] ?? TONES.amber).bg : 'var(--brand-surface)';
  const headFg = n.headerTone ? (TONES[n.headerTone] ?? TONES.amber).fg : 'var(--brand-blue)';
  const grid = `display:grid;grid-template-columns:${cols.map((c) => (c.width ? `${c.width}fr` : '1fr')).join(' ')};`;
  const cellStyle = (isHead) => `padding:${isHead ? 16 : 14}px 18px;text-align:left;font-family:var(--brand-body);` +
    `font-size:${n.fontSize ?? (isHead ? 25 : 27)}px;font-weight:${isHead ? 800 : 600};overflow-wrap:anywhere;` +
    (isHead ? 'letter-spacing:.10em;text-transform:uppercase;' : '');
  const head = header && cols.length
    ? `<div style="${grid}background:${headBg};color:${headFg}">${cols.map((c) => `<div style="${cellStyle(true)}">${esc(c.label ?? '')}</div>`).join('')}</div>`
    : '';
  const body = rows.map((row, ri) => {
    const cells = cols.length ? cols : row.map(() => ({}));
    const hl = n.highlightRow === ri;
    const bg = hl ? 'rgba(234,88,12,.22)' : (n.zebra && ri % 2 ? 'rgba(255,255,255,.05)' : 'transparent');
    return `<div${n.rowSlots ? ` data-slot="row-${ri}"` : ''} style="${grid}background:${bg};border-top:1px solid rgba(255,255,255,.14);color:${fg}">` +
      cells.map((c, ci) => `<div style="${cellStyle(false)}">${esc(row[ci] ?? '')}</div>`).join('') + '</div>';
  }).join('');
  return `<div style="overflow:hidden;border-radius:${n.r ?? 28}px;background:${t.bg};color:${fg};box-shadow:0 26px 64px rgba(0,0,0,.30)">${head}${body}</div>`;
}

function codeInner(n) {
  const lines = Array.isArray(n.lines) ? n.lines : [];
  const size = n.fontSize ?? 22;
  const rows = lines.map((line, i) => {
    const toks = Array.isArray(line?.tokens)
      ? line.tokens.map((t) => `<span class="cx-code-${esc(t.cls || 'p')}">${esc(t.t)}</span>`).join('')
      : esc(typeof line === 'string' ? line : line?.text ?? '');
    const mark = n.diff ? (line?.tone === 'add' ? '+' : line?.tone === 'del' ? '-' : ' ') : '';
    const rowBg = line?.tone === 'add' ? 'rgba(34,197,94,.16)' : line?.tone === 'del' ? 'rgba(239,68,68,.16)' : 'transparent';
    return `<div style="display:flex;gap:22px;background:${rowBg};padding:0 4px">` +
      (n.gutter !== false ? `<span style="color:rgba(255,255,255,.38);user-select:none;text-align:right;min-width:2.2em">${i + 1}</span>` : '') +
      (n.diff ? `<span style="color:rgba(255,255,255,.55);min-width:1em">${mark}</span>` : '') +
      `<span style="white-space:pre;flex:1">${toks || '&nbsp;'}</span></div>`;
  }).join('');
  return `<div style="${surface(n.tone ?? 'ink', { r: n.r ?? 24 })}padding:28px 30px;font-family:var(--brand-mono);font-size:${size}px;line-height:1.55;overflow:hidden">${rows}</div>`;
}

function terminalInner(n) {
  const lines = Array.isArray(n.lines) ? n.lines : [];
  const rows = lines.map((l) => {
    const text = typeof l === 'string' ? l : l?.text ?? '';
    const prompt = typeof l === 'string' ? '›' : l?.prompt ?? '›';
    const tone = typeof l === 'string' ? 'text' : l?.tone ?? 'text';
    const color = tone === 'ok' ? '#4ADE80' : tone === 'err' ? '#F87171' : tone === 'dim' ? 'rgba(255,255,255,.55)' : 'var(--brand-text)';
    return `<div style="color:${color};white-space:pre-wrap"><span style="color:var(--brand-surface);margin-right:14px">${esc(prompt)}</span>${esc(text)}</div>`;
  }).join('');
  return `<div style="${surface('ink', { r: n.r ?? 26 })}padding:0;overflow:hidden">` +
    `<div style="display:flex;align-items:center;gap:10px;padding:18px 24px;border-bottom:1px solid rgba(255,255,255,.14)">` +
    `<span style="width:12px;height:12px;border-radius:50%;background:#F87171"></span>` +
    `<span style="width:12px;height:12px;border-radius:50%;background:#FBBF24"></span>` +
    `<span style="width:12px;height:12px;border-radius:50%;background:#4ADE80"></span>` +
    `<span style="margin-left:12px;font-family:var(--brand-body);font-size:22px;color:rgba(255,255,255,.6)">${esc(n.title ?? '')}</span></div>` +
    `<div style="padding:26px 30px;font-family:var(--brand-mono);font-size:${n.fontSize ?? 24}px;line-height:1.7">${rows}</div></div>`;
}

function chatInner(n) {
  const msgs = Array.isArray(n.messages) ? n.messages : [];
  return `<div style="display:flex;flex-direction:column;gap:18px;padding:8px 0">${msgs.map((m, i) => {
    const right = m.side === 'right' || m.side === 'me';
    return `<div${n.msgSlots ? ` data-slot="msg-${i}"` : ''} style="display:flex;justify-content:${right ? 'flex-end' : 'flex-start'}">` +
      `<div style="max-width:78%;background:${right ? 'var(--brand-blue)' : 'rgba(255,255,255,.16)'};color:var(--brand-text);` +
      `border-radius:${right ? '26px 26px 6px 26px' : '26px 26px 26px 6px'};padding:18px 22px;box-shadow:0 14px 30px rgba(0,0,0,.22)">` +
      (m.name ? `<div style="font:800 20px var(--brand-body);opacity:.8;margin-bottom:6px">${esc(m.name)}</div>` : '') +
      `<div style="font:600 ${n.fontSize ?? 27}px/1.4 var(--brand-body)">${esc(m.text ?? '')}</div>` +
      (m.time ? `<div style="font:600 18px var(--brand-body);opacity:.55;margin-top:6px;text-align:${right ? 'right' : 'left'}">${esc(m.time)}</div>` : '') +
      `</div></div>`;
  }).join('')}</div>`;
}

function postInner(n) {
  const metrics = (n.metrics ?? []).map((m) => `<span style="display:inline-flex;gap:8px;align-items:center;font:700 20px var(--brand-body);color:rgba(255,255,255,.75)">${esc(m.icon ?? '')} ${esc(m.value ?? '')} ${esc(m.label ?? '')}</span>`).join('');
  return `<div style="${surface('hover', { r: n.r ?? 30 })}background:${n.tone ? (TONES[n.tone] ?? TONES.ghost).bg : 'rgba(11,18,32,.55)'};padding:30px 32px">` +
    `<div style="display:flex;align-items:center;gap:16px;margin-bottom:18px">` +
    `<div style="width:52px;height:52px;border-radius:50%;background:var(--brand-surface);display:flex;align-items:center;justify-content:center;color:var(--brand-blue);font:900 26px var(--brand-display)">${esc((n.author ?? 'A').slice(0, 1))}</div>` +
    `<div><div style="font:800 24px var(--brand-body)">${esc(n.author ?? '')}</div><div style="font:600 20px var(--brand-body);opacity:.6">${esc(n.handle ?? '')}</div></div>` +
    (n.platform ? `<div style="margin-left:auto;font:700 18px var(--brand-body);opacity:.6;text-transform:uppercase;letter-spacing:.12em">${esc(n.platform)}</div>` : '') +
    `</div><div style="font:600 ${n.fontSize ?? 28}px/1.45 var(--brand-body);white-space:pre-wrap">${esc(n.text ?? '')}</div>` +
    (metrics ? `<div style="display:flex;gap:26px;margin-top:24px;padding-top:18px;border-top:1px solid rgba(255,255,255,.16)">${metrics}</div>` : '') +
    `</div>`;
}

function frameInner(n) {
  const browser = n.chrome !== 'phone';
  const bar = browser
    ? `<div style="display:flex;align-items:center;gap:9px;padding:14px 18px;background:rgba(11,18,32,.55)">` +
      `<span style="width:11px;height:11px;border-radius:50%;background:#F87171"></span>` +
      `<span style="width:11px;height:11px;border-radius:50%;background:#FBBF24"></span>` +
      `<span style="width:11px;height:11px;border-radius:50%;background:#4ADE80"></span>` +
      `<span style="margin-left:14px;flex:1;background:rgba(255,255,255,.12);border-radius:999px;padding:6px 16px;font:600 18px var(--brand-body);color:rgba(255,255,255,.6)">${esc(n.url ?? '')}</span></div>`
    : `<div style="display:flex;justify-content:center;padding:10px 0 0"><span style="width:34%;height:14px;border-radius:999px;background:rgba(11,18,32,.55)"></span></div>`;
  return `<div style="position:absolute;inset:0;border-radius:${n.r ?? (browser ? 26 : 46)}px;background:rgba(255,255,255,.10);` +
    `border:${browser ? 0 : '10px solid rgba(11,18,32,.55)'};box-shadow:0 26px 64px rgba(0,0,0,.30);overflow:hidden">${bar}` +
    `<div style="position:absolute;left:0;right:0;top:${browser ? 60 : 34}px;bottom:0;overflow:hidden"></div></div>`;
}

function edgeGeometry(points, { curve = 'polyline', bend = 0.18, arrow = true, arrowStart = false, arrowSize = 26, designW = 1080, designH = 1920, stroke = 'var(--brand-text)', strokeWidth = 3, dashed = false, dash = '12 10' } = {}) {
  const pts = (Array.isArray(points) ? points : []).filter((p) => p && isNum(p.x) && isNum(p.y)).map((p) => ({ x: p.x * designW, y: p.y * designH }));
  if (pts.length < 2) return '';
  const seg = [`M ${r3(pts[0].x)} ${r3(pts[0].y)}`];
  if (curve === 'smooth' && pts.length > 2) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      seg.push(`C ${r3(c1.x)} ${r3(c1.y)} ${r3(c2.x)} ${r3(c2.y)} ${r3(p2.x)} ${r3(p2.y)}`);
    }
  } else if (curve === 'arc' && pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const norm = Math.hypot(dx, dy) || 1;
    const cx = mx - (dy / norm) * norm * bend;
    const cy = my + (dx / norm) * norm * bend;
    seg.push(`Q ${r3(cx)} ${r3(cy)} ${r3(b.x)} ${r3(b.y)}`);
  } else {
    for (let i = 1; i < pts.length; i++) seg.push(`L ${r3(pts[i].x)} ${r3(pts[i].y)}`);
  }
  const head = (from, to) => {
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const spread = 0.44;
    return `M ${r3(to.x - arrowSize * Math.cos(ang - spread))} ${r3(to.y - arrowSize * Math.sin(ang - spread))} ` +
      `L ${r3(to.x)} ${r3(to.y)} L ${r3(to.x - arrowSize * Math.cos(ang + spread))} ${r3(to.y - arrowSize * Math.sin(ang + spread))}`;
  };
  if (arrow) seg.push(head(pts[pts.length - 2], pts[pts.length - 1]));
  if (arrowStart) seg.push(head(pts[1], pts[0]));
  const d = seg.join(' ');
  const dashAttr = dashed ? ` stroke-dasharray="${esc(dash)}"` : '';
  return `<path d="${esc(d)}" fill="none" stroke="${esc(stroke)}" stroke-width="${r3(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}/>`;
}

const px2 = (n) => Math.round(n * 1000) / 1000;

function wrapText(value, maxChars, maxLines = 3) {
  const words = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (!cur || next.length <= maxChars) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.length) {
    const consumed = lines.join(' ').split(/\s+/).length;
    if (consumed < words.length) lines[maxLines - 1] += '…';
  }
  return lines;
}

function nodeHtml(n, depth = 0, ctx = {}) {
  const { isRoot = false, designW = 1080, designH = 1920 } = ctx;
  const parentW = isNum(ctx.parentW) ? ctx.parentW : designW;
  const parentH = isNum(ctx.parentH) ? ctx.parentH : designH;
  const boxW = Math.max(0, (isNum(n.layout?.w) ? n.layout.w : 1) * parentW);
  const boxH = Math.max(0, (isNum(n.layout?.h) ? n.layout.h : 1) * parentH);
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
  if (n.align) style.push(`text-align:${n.align}`);
  if (n.valign) {
    style.push('display:flex', 'flex-direction:column');
    style.push(`justify-content:${n.valign === 'center' ? 'center' : n.valign === 'bottom' ? 'flex-end' : 'flex-start'}`);
  }
  if (n.visible === false) style.push('opacity:0');
  let inner = '';
  if (n.type === 'shape') {
    inner = shapeInner(n, boxW, boxH);
  } else if (n.type === 'table') {
    inner = tableInner(n);
  } else if (n.type === 'code') {
    inner = codeInner(n);
  } else if (n.type === 'terminal') {
    inner = terminalInner(n);
  } else if (n.type === 'chat') {
    inner = chatInner(n);
  } else if (n.type === 'post') {
    inner = postInner(n);
  } else if (n.type === 'frame') {
    inner = frameInner(n);
  } else if (n.type === 'figure') {
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
    // A connector: a line, elbow, smooth curve or arc with optional heads at one
    // or both ends. Points are absolute canvas fractions; the whole connector is
    // ONE <path> so the `draw` op traces line-and-head as one stroke.
    const l = n.layout ?? { x: 0, y: 0, w: 1, h: 1 };
    const vb = `${r3((l.x ?? 0) * designW)} ${r3((l.y ?? 0) * designH)} ${r3((l.w ?? 1) * designW)} ${r3((l.h ?? 1) * designH)}`;
    const d = edgeGeometry(n.points, {
      curve: n.curve ?? 'polyline', bend: n.bend ?? 0.18,
      arrow: n.arrow !== false, arrowStart: n.arrowStart === true,
      arrowSize: n.arrowSize ?? 26, designW, designH,
      stroke: n.stroke ?? 'currentColor', strokeWidth: n.strokeWidth ?? 3,
      dashed: n.dashed === true, dash: n.dash ?? '12 10',
    });
    let label = '';
    if (n.label) {
      const pts = (n.points ?? []).filter((p) => p && isNum(p.x) && isNum(p.y));
      const mid = pts.length === 2
        ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
        : pts.length > 2
          ? (pts.length % 2
            ? pts[Math.floor(pts.length / 2)]
            : { x: (pts[pts.length / 2 - 1].x + pts[pts.length / 2].x) / 2, y: (pts[pts.length / 2 - 1].y + pts[pts.length / 2].y) / 2 })
          : { x: 0.5, y: 0.5 };
      const off = n.labelOffset ?? { dx: 0, dy: -0.02 };
      label = `<div style="position:absolute;left:${r3((mid.x + (off.dx ?? 0)) * 100)}%;top:${r3((mid.y + (off.dy ?? 0)) * 100)}%;` +
        `transform:translate(-50%,-50%);white-space:nowrap;font-family:var(--brand-body);font-weight:700;` +
        `font-size:${n.labelSize ?? 22}px;color:${n.labelColor ?? 'var(--brand-text)'};` +
        `background:${n.labelBg ?? 'rgba(11,18,32,.55)'};padding:5px 12px;border-radius:999px">${esc(n.label)}</div>`;
    }
    inner = `<svg class="cx-edge" viewBox="${vb}" preserveAspectRatio="none" ` +
      `style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">${d}</svg>${label}`;
  } else if (n.text && typeof n.text === 'object') {
    const value = n.text.value ?? '';
    const body = n.wrap
      ? wrapText(value, Number(n.wrap), n.maxLines ?? 3).map((line) => esc(line)).join('<br>')
      : esc(value);
    inner = (n.icon ? iconSvg(n.icon, { size: n.iconSize ?? 40, stroke: n.iconStroke ?? 2, color: n.iconColor ?? 'currentColor', opacity: n.iconOpacity ?? 1 }) : '') + body;
  } else if (typeof n.text === 'string') {
    inner = (n.icon ? iconSvg(n.icon, { size: n.iconSize ?? 40, stroke: n.iconStroke ?? 2, color: n.iconColor ?? 'currentColor', opacity: n.iconOpacity ?? 1 }) : '') + esc(n.text);
  }
  if (Array.isArray(n.children)) {
    inner += n.children.map((c) => nodeHtml(c, depth + 1, { ...ctx, isRoot: false, parentW: boxW, parentH: boxH })).join('');
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
  const slotAttr = isRoot || n.static ? '' : ` data-slot="${esc(id)}"`;
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
