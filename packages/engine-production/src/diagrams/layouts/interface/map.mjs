// diagrams/layouts/interface/map.mjs — a basemap with projected markers.
import { checkLabel, checkCount, MAX_TITLE, MAX_NOTE, playTime } from '../../spec.mjs';
import { titleBlock } from '../_common.mjs';
import { wrapChars } from '../../primitives.mjs';

const project = (lon, lat) => ({
  x: (Number(lon) + 180) / 360,
  y: (90 - Number(lat)) / 180,
});

export default {
  name: 'map',
  description: 'A basemap with markers placed by longitude and latitude',
  frame: 'full',
  fields: ['title', 'image', 'markers'],

  minDurationFor(n) { return playTime(1.1, 0.3, n); },

  validate(spec) {
    const out = [];
    if (spec?.title != null) checkLabel(spec.title, 'title', out, { max: MAX_TITLE, required: false });
    const markers = Array.isArray(spec?.markers) ? spec.markers : [];
    checkCount(markers, 'markers', out, 1, 8);
    markers.forEach((m, i) => {
      checkLabel(m?.label, `markers[${i}].label`, out, { max: MAX_NOTE });
      if (!Number.isFinite(Number(m?.lon)) || Number(m.lon) < -180 || Number(m.lon) > 180) out.push(`markers[${i}].lon must be -180..180`);
      if (!Number.isFinite(Number(m?.lat)) || Number(m.lat) < -90 || Number(m.lat) > 90) out.push(`markers[${i}].lat must be -90..90`);
    });
    return out;
  },

  slots(spec) {
    const out = [];
    if (spec?.title) out.push('title');
    (Array.isArray(spec?.markers) ? spec.markers : []).forEach((_, i) => out.push(`marker-${i}`));
    return out;
  },

  build(spec, c, P) {
    const markers = Array.isArray(spec?.markers) ? spec.markers : [];
    const { node: title, body } = titleBlock(spec, c, P, { ratio: 0.08, landscapeRatio: 0.12 });
    const nodes = [];
    const build = [];
    if (title) { nodes.push(title); build.push(['title']); }

    if (spec?.image) {
      nodes.push(P.image('basemap', body, { src: spec.image, fit: 'cover', radius: 24, slot: false }));
    } else {
      nodes.push(P.shape('map-bg', body, { shape: 'rect', r: 24, fill: 'ink', slot: false }));
      for (let i = 1; i < 6; i++) {
        nodes.push(P.shape(`grid-v-${i}`, { x: body.x + (body.w * i) / 6, y: body.y, w: 1, h: body.h }, {
          shape: 'rect', fill: 'rgba(255,255,255,.10)', slot: false,
        }));
      }
      for (let i = 1; i < 4; i++) {
        nodes.push(P.shape(`grid-h-${i}`, { x: body.x, y: body.y + (body.h * i) / 4, w: body.w, h: 1 }, {
          shape: 'rect', fill: 'rgba(255,255,255,.10)', slot: false,
        }));
      }
    }

    markers.forEach((m, i) => {
      const p = project(m.lon, m.lat);
      const x = body.x + p.x * body.w;
      const y = body.y + p.y * body.h;
      const d = Math.min(P.unit * 0.042, body.h * 0.05);
      const box = { x: x - d / 2, y: y - d / 2, w: d, h: d };
      const size = P.unit * 0.017;
      const labelW = Math.min(body.w * 0.30, P.unit * 0.30);
      nodes.push(P.group(`marker-${i}`, box, {
        children: [
          P.shape(`marker-${i}-dot`, box, {
            shape: 'circle', fill: m.tone ?? (i === 0 ? 'surface' : 'accent'), stroke: 'text', strokeWidth: 3, slot: false,
          }, box),
          P.text(`marker-${i}-label`, {
            x: box.x + box.w / 2 - labelW / 2, y: box.y - P.unit * 0.050, w: labelW, h: P.unit * 0.042,
          }, {
            value: m.label, size, weight: 700, font: 'body', color: 'text',
            align: 'center', valign: 'center', slot: false,
          }, box),
        ],
      }));
      build.push([`marker-${i}`]);
    });

    return { nodes, build };
  },
};
