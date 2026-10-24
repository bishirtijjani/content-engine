// diagrams/primitives.mjs — the drawing vocabulary every layout compiles with.
//
// Layouts work in design pixels inside the frame box; these helpers convert that
// to the canvas fractions the scene-graph renderer positions with. Nothing here
// invents a colour, font or radius: all of it comes from the derived theme.
import { deriveTheme } from './theme.mjs';

const r3 = (n) => Math.round(n * 1000) / 1000;

export const TONES = {
  blue: { bg: 'var(--brand-blue)', fg: 'var(--brand-text)' },
  amber: { bg: 'var(--brand-surface)', fg: 'var(--brand-blue)' },
  accent: { bg: 'var(--brand-orange)', fg: 'var(--brand-text)' },
  ghost: { bg: 'rgba(11,18,32,0.50)', fg: 'var(--brand-text)' },
  ink: { bg: 'rgba(11,18,32,0.55)', fg: 'var(--brand-text)' },
  // Chart palette aliases: the brand surface and text, as card tones.
  surface: { bg: 'var(--brand-surface)', fg: 'var(--brand-blue)' },
  text: { bg: 'var(--brand-text)', fg: 'var(--brand-blue)' },
};

/** A deterministic character budget for wrapping (no DOM measurement). */
export function wrapChars(width, size) {
  return Math.max(6, Math.floor(width / Math.max(1, size * 0.52)));
}

/**
 * @param {{W:number,H:number,landscape:boolean,theme?:object}} ctx
 */
export function primitives(ctx) {
  const { W, H } = ctx;
  const theme = ctx.theme ?? deriveTheme(ctx.style);
  const unit = Math.min(W, H);
  const root = { x: 0, y: 0, w: W, h: H };

  const lay = (box, parent = root) => ({
    x: r3((box.x - parent.x) / parent.w),
    y: r3((box.y - parent.y) / parent.h),
    w: r3(box.w / parent.w),
    h: r3(box.h / parent.h),
  });

  const col = (key, fallback = 'text') => {
    if (typeof key !== 'string') return theme.colors[fallback];
    if (key === 'none' || key === 'transparent') return key;
    if (key.startsWith('#') || key.startsWith('var(') || key.startsWith('rgba')) return key;
    return theme.colors[key] ?? theme.colors[fallback];
  };
  const px = (n) => `${Math.round(n)}px`;
  const tone = (key) => TONES[key] ?? TONES.ghost;

  function text(id, box, opts = {}, parent = null) {
    const size = opts.size ?? theme.type.node * unit;
    const style = {
      'font-family': `var(--brand-${opts.font ?? 'body'})`,
      'font-size': px(size),
      'font-weight': opts.weight ?? theme.weight.body,
      color: col(opts.color ?? 'text'),
      'line-height': opts.lineHeight ?? 1.18,
      'overflow-wrap': 'break-word',
    };
    if (opts.caps) style['text-transform'] = 'uppercase';
    if (opts.tracking != null) style['letter-spacing'] = `${opts.tracking}em`;
    if (opts.opacity != null) style.opacity = opts.opacity;
    const node = {
      id,
      type: 'text',
      layout: lay(box, parent ?? root),
      text: { value: opts.value ?? '' },
      align: opts.align ?? 'left',
      valign: opts.valign ?? 'top',
      style,
    };
    if (opts.wrap) node.wrap = opts.wrap;
    if (opts.maxLines) node.maxLines = opts.maxLines;
    if (opts.slot === false) node.static = true;
    return node;
  }

  function card(id, box, opts = {}, parent = null) {
    const t = tone(opts.tone ?? 'blue');
    const style = {
      background: opts.background ?? t.bg,
      color: opts.color ?? t.fg,
      'border-radius': px(opts.r ?? 34),
      'box-shadow': opts.shadow === false ? 'none' : '0 26px 64px rgba(0,0,0,.30)',
      overflow: opts.overflow ?? 'hidden',
      ...(opts.style ?? {}),
    };
    if (opts.opacity != null) style.opacity = opts.opacity;
    if (opts.stroke) {
      style.border = `${opts.strokeWidth ?? 5}px solid ${col(opts.stroke)}`;
    }
    const node = {
      id,
      type: 'group',
      layout: lay(box, parent ?? root),
      style,
      children: opts.children ?? [],
    };
    if (opts.meta) node.meta = opts.meta;
    if (opts.slot === false) node.static = true;
    return node;
  }

  /**
   * cardContent — the one content layout for a card.
   *
   * Every node card used to place its icon and label by hand, which produced
   * tiny icons in big cards, oversized label boxes and top-heavy groups. This
   * helper derives all of it from the card box:
   *
   *   row   — icon left, label fills the rest (wide, short cards)
   *   stack — icon above, label below, the group vertically centred (tall cards)
   *   list  — header + distributed rows (entity/table-like cards)
   *
   * It applies one padding rule, scales the icon from the card (never from the
   * canvas), reserves explicit leading/trailing regions, and returns geometry
   * in `meta` so tests can assert the result.
   */
  function cardContent(box, content = {}, opts = {}) {
    const pad = opts.pad != null ? opts.pad : Math.max(10, Math.min(28, Math.min(box.w, box.h) * 0.06));
    const cb = { x: box.x + pad, y: box.y + pad, w: Math.max(1, box.w - pad * 2), h: Math.max(1, box.h - pad * 2) };
    const leadingW = Math.max(0, Math.min(0.4, opts.leading ?? 0)) * cb.w;
    const trailingW = Math.max(0, Math.min(0.8, opts.trailing ?? 0)) * cb.w;
    const area = { x: cb.x + leadingW, y: cb.y, w: Math.max(1, cb.w - leadingW - trailingW), h: cb.h };
    const leadingBox = { x: cb.x, y: cb.y, w: leadingW, h: cb.h };
    const trailingBox = { x: cb.x + cb.w - trailingW, y: cb.y, w: trailingW, h: cb.h };
    const fg = opts.fg ?? 'text';
    const id = opts.id ?? 'content';
    const mode = opts.mode && opts.mode !== 'auto'
      ? opts.mode
      : (area.w / Math.max(1, area.h) > 1.7 ? 'row' : 'stack');
    const children = [];
    let iconBox = null;
    let labelBox = null;
    let labelSize = opts.labelSize;
    const iconName = content.icon;

    const pushText = (nodeId, b, value, extra = {}) => {
      const size = extra.size;
      children.push(text(nodeId, b, {
        value,
        size,
        weight: extra.weight ?? 700,
        font: extra.font ?? 'display',
        color: extra.color ?? fg,
        align: extra.align ?? 'left',
        valign: extra.valign ?? 'center',
        wrap: extra.wrap,
        maxLines: extra.maxLines ?? 2,
        opacity: extra.opacity,
        caps: extra.caps,
        tracking: extra.tracking,
        slot: false,
      }, box));
    };

    if (mode === 'list') {
      const header = content.header ?? content.label ?? '';
      const rows = Array.isArray(content.rows) ? content.rows : [];
      const headerSize = opts.headerSize ?? Math.max(16, Math.min(area.w * 0.085, area.h * 0.09, unit * 0.032));
      const headerH = Math.min(area.h * 0.34, headerSize * 1.9);
      pushText(`${id}-header`, { x: area.x, y: area.y, w: area.w, h: headerH }, header, {
        size: headerSize, weight: 900, color: opts.headerColor ?? fg, align: 'left',
        font: opts.headerFont ?? 'display', wrap: wrapChars(area.w, headerSize), maxLines: 2,
      });
      const bodyH = Math.max(1, area.h - headerH);
      const rowH = rows.length ? bodyH / rows.length : 0;
      const rowSize = opts.rowSize ?? Math.max(12, Math.min(rowH * 0.30, unit * 0.021, headerSize * 0.74));
      rows.forEach((row, i) => {
        const y = area.y + headerH + i * rowH;
        const left = typeof row === 'string' ? row : row?.left ?? '';
        const right = typeof row === 'string' ? '' : row?.right ?? '';
        const leftW = right ? area.w * 0.66 : area.w;
        pushText(`${id}-row-${i}-l`, { x: area.x, y, w: leftW, h: rowH }, opts.bullet ? `· ${left}` : left, {
          size: rowSize, weight: 600, font: opts.rowFont ?? 'body', color: opts.rowColor ?? fg, align: 'left',
          wrap: wrapChars(leftW, rowSize), maxLines: 2,
        });
        if (right) {
          pushText(`${id}-row-${i}-r`, { x: area.x + area.w * 0.68, y, w: area.w * 0.32, h: rowH }, right, {
            size: rowSize * 0.92, weight: 600, font: opts.rightFont ?? 'mono', color: opts.rowColor ?? fg,
            align: 'right', opacity: 0.7,
          });
        }
      });
    } else if (mode === 'row') {
      labelSize = labelSize ?? Math.min(cb.h * 0.30, area.w * 0.10, unit * 0.042);
      labelSize = Math.max(14, labelSize);
      let iconSize = 0;
      if (iconName) {
        iconSize = Math.max(24, Math.min(cb.h * 0.58, area.w * 0.16, 96)) * (opts.iconScale ?? 1);
        iconBox = { x: area.x, y: area.y + (area.h - iconSize) / 2, w: iconSize, h: iconSize };
        children.push(icon(`${id}-icon`, iconBox, {
          name: iconName, size: iconSize, color: opts.iconColor ?? fg, slot: false,
        }, box));
      }
      const gap = iconSize ? Math.max(8, iconSize * 0.30) : 0;
      labelBox = { x: area.x + iconSize + gap, y: area.y, w: Math.max(1, area.w - iconSize - gap), h: area.h };
      pushText(`${id}-label`, labelBox, content.label ?? '', {
        size: labelSize, weight: 800, color: opts.labelColor ?? fg, align: 'left',
        wrap: wrapChars(labelBox.w, labelSize), maxLines: 2,
      });
    } else {
      labelSize = labelSize ?? Math.max(16, Math.min(area.w * 0.12, area.h * 0.12, unit * 0.036));
      const aspect = area.w / Math.max(1, area.h);
      const iconSize = iconName
        ? Math.max(28, Math.min(Math.min(area.w, area.h) * (aspect < 0.9 ? 0.55 : 0.45), 180)) * (opts.iconScale ?? 1)
        : 0;
      const gap = iconSize ? Math.max(10, iconSize * 0.10) : 0;
      const labelH = Math.min(
        Math.max(1, area.h - iconSize - gap),
        Math.max(labelSize * 1.4, labelSize * 2.5),
      );
      const total = iconSize + (iconSize ? gap : 0) + labelH;
      const top = area.y + Math.max(0, (area.h - total) / 2);
      if (iconName) {
        iconBox = { x: area.x + (area.w - iconSize) / 2, y: top, w: iconSize, h: iconSize };
        children.push(icon(`${id}-icon`, iconBox, {
          name: iconName, size: iconSize, color: opts.iconColor ?? fg, slot: false,
        }, box));
      }
      labelBox = { x: area.x, y: top + iconSize + gap, w: area.w, h: labelH };
      pushText(`${id}-label`, labelBox, content.label ?? '', {
        size: labelSize, weight: 800, color: opts.labelColor ?? fg, align: 'center',
        wrap: wrapChars(labelBox.w, labelSize), maxLines: 2,
      });
    }

    const meta = {
      mode, pad, card: { x: box.x, y: box.y, w: box.w, h: box.h }, cb, area, leadingBox, trailingBox,
      iconBox, labelBox, labelSize,
    };
    return { children, meta, iconBox, labelBox, leadingBox, trailingBox, mode, labelSize };
  }


  function group(id, box, opts = {}, parent = null) {
    const node = { id, type: 'group', layout: lay(box, parent ?? root), children: opts.children ?? [] };
    if (opts.style) node.style = opts.style;
    if (opts.slot === false) node.static = true;
    return node;
  }

  function icon(id, box, opts = {}, parent = null) {
    const node = {
      id,
      type: 'icon',
      layout: lay(box, parent ?? root),
      name: opts.name,
      size: Math.round(opts.size ?? theme.type.node * unit),
      stroke: opts.stroke ?? 2,
      color: col(opts.color ?? 'text'),
      opacity: opts.opacity ?? 1,
    };
    if (opts.slot === false) node.static = true;
    return node;
  }

  function shape(id, box, opts = {}, parent = null) {
    const node = {
      id,
      type: 'shape',
      shape: opts.shape ?? 'rect',
      layout: lay(box, parent ?? root),
      fill: opts.fill != null ? col(opts.fill) : 'none',
      stroke: opts.stroke != null ? col(opts.stroke) : 'none',
      strokeWidth: opts.strokeWidth ?? 3,
      r: opts.r ?? 0,
      points: opts.points,
      d: opts.d,
      x1: opts.x1,
      y1: opts.y1,
      x2: opts.x2,
      y2: opts.y2,
      top: opts.top,
      notch: opts.notch,
      startAngle: opts.startAngle,
      endAngle: opts.endAngle,
      inner: opts.inner,
      dash: opts.dash,
      opacity: opts.opacity,
    };
    Object.keys(node).forEach((k) => node[k] === undefined && delete node[k]);
    if (opts.slot === false) node.static = true;
    return node;
  }

  function figure(id, box, opts = {}, parent = null) {
    const value = opts.value;
    const node = {
      id,
      type: 'figure',
      layout: lay(box, parent ?? root),
      value: typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.\-]/g, '')) || 0,
      text: { value: String(value ?? '') },
      format: opts.format ?? 'int',
      align: opts.align ?? 'center',
      valign: opts.valign ?? 'center',
      style: {
        'font-family': 'var(--brand-display)',
        'font-size': px(opts.size ?? theme.type.data * unit),
        'font-weight': 900,
        color: col(opts.color ?? 'text'),
        'line-height': 1,
        'letter-spacing': '-0.03em',
      },
    };
    if (opts.slot === false) node.static = true;
    return node;
  }

  function edge(id, points, opts = {}) {
    const node = {
      id,
      type: 'edge',
      layout: { x: 0, y: 0, w: 1, h: 1 },
      points: (points ?? []).map((p) => ({ x: r3(p.x / W), y: r3(p.y / H) })),
      curve: opts.curve ?? 'polyline',
      bend: opts.bend,
      arrow: opts.arrow !== false,
      arrowStart: opts.arrowStart === true,
      arrowSize: opts.arrowSize ?? theme.connector.head,
      stroke: opts.stroke != null ? col(opts.stroke) : theme.connector.color,
      strokeWidth: opts.strokeWidth ?? theme.connector.width,
      dashed: opts.dashed === true,
      dash: opts.dash ?? theme.connector.dash,
      label: opts.label,
      labelOffset: opts.labelOffset,
    };
    Object.keys(node).forEach((k) => node[k] === undefined && delete node[k]);
    if (opts.slot === false) node.static = true;
    return node;
  }

  function table(id, box, opts = {}, parent = null) {
    const node = {
      id,
      type: 'table',
      layout: lay(box, parent ?? root),
      columns: opts.columns ?? [],
      rows: opts.rows ?? [],
      header: opts.header !== false,
      headerTone: opts.headerTone ?? 'amber',
      tone: opts.tone ?? 'ghost',
      fontSize: opts.fontSize,
      zebra: opts.zebra === true,
      highlightRow: opts.highlightRow,
      rowSlots: opts.rowSlots === true,
      r: opts.r ?? 28,
    };
    Object.keys(node).forEach((k) => node[k] === undefined && delete node[k]);
    if (opts.slot === false) node.static = true;
    return node;
  }

  function code(id, box, opts = {}, parent = null) {
    return {
      id,
      type: 'code',
      layout: lay(box, parent ?? root),
      lines: opts.lines ?? [],
      fontSize: opts.fontSize ?? Math.round(unit * 0.0205),
      gutter: opts.gutter !== false,
      diff: opts.diff === true,
      tone: opts.tone ?? 'ink',
      r: opts.r ?? 24,
      ...(opts.slot === false ? { static: true } : {}),
    };
  }

  function terminal(id, box, opts = {}, parent = null) {
    return {
      id,
      type: 'terminal',
      layout: lay(box, parent ?? root),
      title: opts.title,
      lines: opts.lines ?? [],
      fontSize: opts.fontSize ?? Math.round(unit * 0.0215),
      ...(opts.slot === false ? { static: true } : {}),
    };
  }

  function chat(id, box, opts = {}, parent = null) {
    return {
      id,
      type: 'chat',
      layout: lay(box, parent ?? root),
      messages: opts.messages ?? [],
      msgSlots: opts.msgSlots === true,
      fontSize: opts.fontSize ?? Math.round(unit * 0.025),
      ...(opts.slot === false ? { static: true } : {}),
    };
  }

  function post(id, box, opts = {}, parent = null) {
    return {
      id,
      type: 'post',
      layout: lay(box, parent ?? root),
      author: opts.author,
      handle: opts.handle,
      platform: opts.platform,
      text: opts.text,
      metrics: opts.metrics,
      fontSize: opts.fontSize,
      r: opts.r ?? 30,
      ...(opts.slot === false ? { static: true } : {}),
    };
  }

  function image(id, box, opts = {}, parent = null) {
    return {
      id,
      type: 'image',
      layout: lay(box, parent ?? root),
      src: opts.src,
      fit: opts.fit ?? 'cover',
      radius: opts.radius,
      focus: opts.focus,
      alt: opts.alt,
      ...(opts.slot === false ? { static: true } : {}),
    };
  }

  function frame(id, box, opts = {}, parent = null) {
    return {
      id,
      type: 'frame',
      layout: lay(box, parent ?? root),
      chrome: opts.chrome ?? 'browser',
      url: opts.url,
      r: opts.r,
      children: opts.children ?? [],
      ...(opts.slot === false ? { static: true } : {}),
    };
  }

  return {
    ctx, theme, unit, root, lay, col, px, tone,
    text, card, cardContent, group, icon, shape, figure, edge, table, code, terminal, chat, post, frame, image,
  };
}
