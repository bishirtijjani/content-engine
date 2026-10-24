// diagrams/layouts/interface/wireframe.mjs — a browser or phone wireframe.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

export default {
  name: 'wireframe',
  description: 'A browser or phone frame containing layout blocks',
  frame: 'full',
  fields: ['title', 'device', 'blocks'],

  minDurationFor(n) { return playTime(1.1, 0.3, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    if (spec?.device != null && !['browser', 'phone'].includes(spec.device)) out.push('device must be browser or phone');
    const blocks = Array.isArray(spec?.blocks) ? spec.blocks : [];
    checkCount(blocks, 'blocks', out, 2, 8);
    blocks.forEach((b, i) => {
      checkLabel(b?.label, `blocks[${i}].label`, out, { max: MAX_NOTE });
      const at = b?.at;
      if (!at || [at.x, at.y, at.w, at.h].some((v) => !Number.isFinite(Number(v)))) out.push(`blocks[${i}].at needs x,y,w,h`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.blocks) ? spec.blocks : []).forEach((_, i) => out.push(`block-${i}`));
    return out;
  },

  build(spec, c, P) {
    const blocks = Array.isArray(spec?.blocks) ? spec.blocks : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.08, landscapeRatio: 0.12 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    const device = spec?.device ?? 'browser';
    const w = Math.min(body.w * 0.94, device === 'phone' ? P.unit * 0.46 : P.unit * 0.86);
    const h = Math.min(body.h, device === 'phone' ? P.unit * 0.92 : P.unit * 0.62);
    const box = { x: body.x + (body.w - w) / 2, y: body.y, w, h };
    nodes.push(P.frame('frame', box, { chrome: device, url: spec?.url ?? 'app.example.com', slot: false }));

    const top = device === 'browser' ? 0.14 : 0.10;
    blocks.forEach((b, i) => {
      const at = b.at ?? {};
      const abs = {
        x: box.x + Number(at.x ?? 0.08) * box.w,
        y: box.y + (top + Number(at.y ?? 0.1) * (1 - top)) * box.h,
        w: Number(at.w ?? 0.84) * box.w,
        h: Number(at.h ?? 0.12) * (1 - top) * box.h,
      };
      const type = b.type ?? 'text';
      const size = Math.min(P.unit * 0.024, abs.h * 0.40);
      const tone = b.tone ?? (type === 'button' ? 'amber' : type === 'image' ? 'ghost' : 'ink');
      const fg = tone === 'amber' ? 'blue' : 'text';
      const children = [];
      if (type === 'image') {
        children.push(P.icon(`block-${i}-icon`, { x: abs.x + abs.w / 2 - abs.h * 0.3, y: abs.y + abs.h / 2 - abs.h * 0.3, w: abs.h * 0.6, h: abs.h * 0.6 }, {
          name: 'photo', size: abs.h * 0.6, color: 'text', slot: false,
        }, abs));
      } else if (type === 'text') {
        children.push(P.text(`block-${i}-t`, { x: abs.x + 12, y: abs.y, w: abs.w - 24, h: abs.h }, {
          value: b.label, size, weight: 600, font: 'body', color: fg,
          align: 'left', valign: 'center', wrap: wrapChars(abs.w - 24, size), maxLines: 3, slot: false,
        }, abs));
      } else {
        children.push(P.text(`block-${i}-t`, { x: abs.x + 14, y: abs.y, w: abs.w - 28, h: abs.h }, {
          value: b.label, size: type === 'heading' ? size * 1.4 : size, weight: type === 'heading' ? 900 : 700,
          font: 'display', color: fg, align: type === 'button' ? 'center' : 'left', valign: 'center',
          wrap: wrapChars(abs.w - 28, size), maxLines: 2, slot: false,
        }, abs));
      }
      nodes.push(P.card(`block-${i}`, abs, {
        tone, r: type === 'button' ? 999 : 14, shadow: false, children,
        style: type === 'image' ? { border: '2px dashed rgba(255,255,255,.35)' } : {},
      }));
      build.push([`block-${i}`]);
    });

    return { nodes, build };
  },
};
