// assemble.mjs — build ONE HyperFrames composition from a plan.
//
// Layers, bottom to top:
//   1. the burnt orange backdrop (the #root background)
//   2. the video (your face) — inset to one side during a split
//   3. overlays — a visual or graphic in one of four frames
//   4. captions
//   5. zoom and split moves on the video (GSAP), from the plan
//
// Every overlay snaps into a frame (config/style.json → frames). Two modes:
//   take over — the video is hidden, the element fills its frame on the orange
//   split     — the video is inset to the far side, the element sits in its
//               frame on the orange
// Doctrine: everything on screen states its purpose in the plan's `why`.
//
// The video's own audio is the voice. Sound effects are added after render
// (see mix.mjs). The engine never invents what goes where — the plan decides,
// and validatePlan() has already refused anything off-style.
import { loadStyle, loadBackdrop } from './style.mjs';
import { buildCaptionLayer } from './build-captions.mjs';
import { renderTemplate } from './templates.mjs';
import { renderDiagram } from './diagrams/render.mjs';
import { getLayout } from './diagrams/registry.mjs';
import { deriveTheme } from './diagrams/theme.mjs';

const r3 = (n) => Math.round(n * 1000) / 1000;
const pct = (n) => `${r3(n * 100)}%`;
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;

/** CSS filter from the style's grade block. */
function gradeFilter(style) {
  const g = style?.grade ?? {};
  const parts = [];
  if (g.contrast && g.contrast !== 1) parts.push(`contrast(${g.contrast})`);
  if (g.saturation && g.saturation !== 1) parts.push(`saturate(${g.saturation})`);
  if (g.brightness && g.brightness !== 1) parts.push(`brightness(${g.brightness})`);
  return parts.length ? parts.join(' ') : 'none';
}

/** An inline style placing an element inside a frame rect. */
function frameStyle(f) {
  return `left:${pct(f.x)};top:${pct(f.y)};width:${pct(f.w)};height:${pct(f.h)};`;
}

/**
 * Render overlay clips and their CSS. Returns split tweens so the caller can
 * inset the video during split-mode overlays.
 */
function renderOverlays(overlays, { frames, templatesDir, resolveVisual, width, height, theme }) {
  const cssParts = [];
  const seen = new Set();
  const clips = [];
  const splits = [];
  const takeovers = [];
  const js = [];

  overlays.forEach((o, i) => {
    const id = `ov-${i + 1}`;
    const start = r3(o.start);
    const dur = r3(o.end - o.start);

    let inner = '';
    let frameName = null;

    if (o.kind === 'graphic') {
      let t;
      try {
        t = renderTemplate(o.name, o.fields || {}, templatesDir);
      } catch {
        return; // unknown graphic — validatePlan already refuses these
      }
      frameName = t.frame;
      if (t.css && !seen.has(t.name)) { seen.add(t.name); cssParts.push(t.css); }
      inner = `<div class="ov-graphic">${t.html}</div>`;
    } else if (o.kind === 'diagram') {
      const layout = getLayout(o.name);
      if (!layout) return; // unknown layout — validatePlan already refuses these
      frameName = layout.frame;
      const diagramFrame = frames[frameName];
      if (!diagramFrame) return;
      // Compose against the ACTUAL frame box in pixels, so the same spec draws
      // correctly on a 16:9 long video and a 9:16 short.
      const box = { w: diagramFrame.w * width, h: diagramFrame.h * height };
      const rendered = renderDiagram({
        name: o.name, spec: o.spec, box, ovId: id, theme, timing: { start, dur },
      });
      if (!rendered) return; // invalid spec — validatePlan already refused it
      if (rendered.css && !seen.has('__diagram__')) { seen.add('__diagram__'); cssParts.push(rendered.css); }
      inner = `<div class="ov-diagram">${rendered.svg}</div>`;
      for (const line of rendered.js ?? []) js.push(line);
    } else {
      const key = o.file || o.asset;
      const src = resolveVisual ? resolveVisual(key) : key;
      if (!src) return; // file missing on disk — skip, engine logs it
      frameName = o.frame || 'full';
      inner = IMAGE_EXT.test(src)
        ? `<img class="ov-media" src="${esc(src)}" alt="" />`
        : `<video class="ov-media" src="${esc(src)}" muted playsinline></video>`;
    }

    const frame = frames[frameName];
    if (!frame) return; // unknown frame — validatePlan already refuses these
    if (frame.mode === 'split') splits.push({ start, end: r3(o.end), face: frame.face });
    else takeovers.push({ start, end: r3(o.end) });

    const canvasClass = frame.mode === 'takeover' ? 'ov ov-takeover' : 'ov ov-split';
    clips.push(
      `      <div id="${id}" class="clip ${canvasClass}" data-start="${start}" data-duration="${dur}" data-track-index="2">` +
      `<div class="frame" style="${frameStyle(frame)}">${inner}</div></div>`
    );
  });

  return { html: clips.join('\n'), css: cssParts.join('\n'), splits, takeovers, js };
}

/** GSAP tweens for the camera pushes. */
function renderZoomScript(zooms, style) {
  const ease = style?.motion?.ease ?? 'power2.out';
  const zd = style?.motion?.zoom?.duration ?? 0.8;
  return zooms
    .map((z) => {
      const at = r3(z.at);
      return (
        `      tl.to('#a-roll', { scale: ${z.scale}, duration: ${zd}, ease: '${ease}' }, ${at});\n` +
        `      tl.to('#a-roll', { scale: 1, duration: ${zd}, ease: '${ease}' }, ${r3(z.at + zd)});`
      );
    })
    .join('\n');
}

/** GSAP tweens that inset the video during split-mode overlays. */
function renderSplitScript(splits) {
  return splits
    .map((s) => {
      const f = s.face;
      return (
        `      tl.set('#a-roll', { left: '${pct(f.x)}', top: '${pct(f.y)}', width: '${pct(f.w)}', height: '${pct(f.h)}' }, ${s.start});\n` +
        `      tl.set('#a-roll', { left: '0%', top: '0%', width: '100%', height: '100%' }, ${s.end});`
      );
    })
    .join('\n');
}

/** GSAP tweens that hide the video during take-over overlays (so the backdrop shows). */
function renderHideScript(takeovers) {
  return takeovers
    .map(
      (t) =>
        `      tl.set('#a-roll', { opacity: 0 }, ${t.start});\n` +
        `      tl.set('#a-roll', { opacity: 1 }, ${t.end});`
    )
    .join('\n');
}

/**
 * Build a composition.
 *
 * @param {Object} opts
 * @param {Array}  opts.words - transcript words [{text,start,end}]
 * @param {string} opts.videoSrc - in-project path to the a-roll media
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} opts.duration - total length in seconds
 * @param {Object} [opts.style] - the locked style (defaults to config/style.json)
 * @param {string} [opts.lexiconPath]
 * @param {Array}  [opts.emphasis] - override emphasis words
 * @param {Object} [opts.plan] - the agent-written plan
 * @param {string} [opts.templatesDir] - override templates directory
 * @param {(id:string)=>string|null} [opts.resolveVisual] - visual id -> in-project path
 * @param {string} [opts.backdrop] - override the backdrop SVG markup
 * @param {boolean} [opts.audioOnly]
 * @param {number} [opts.fps]
 * @returns {{ html: string, sceneCount: number, overlayCount: number, zoomCount: number }}
 */
export function buildComposition({
  words,
  videoSrc,
  width,
  height,
  duration,
  style = null,
  lexiconPath,
  emphasis,
  plan = null,
  templatesDir,
  resolveVisual = null,
  backdrop = null,
  audioOnly = false,
  fps = 30,
} = {}) {
  const s = style ?? loadStyle();
  const brand = s.brand ?? {};
  const capCfg = s.captions ?? {};
  const colors = brand.colors ?? {};
  const frames = s.frames ?? {};
  const backdropSvg = backdrop ?? loadBackdrop(s);

  const layer = buildCaptionLayer({ words, width, style: s, lexiconPath, emphasis, duration });
  const dur = r3(duration ?? layer.duration);

  const overlays = Array.isArray(plan?.overlays) ? plan.overlays : [];
  const zooms = Array.isArray(plan?.zooms) ? plan.zooms : [];

  const overlay = renderOverlays(overlays, {
    frames, templatesDir, resolveVisual, width, height, theme: deriveTheme(s),
  });
  const zoomJs = renderZoomScript(zooms, s);
  const splitJs = renderSplitScript(overlay.splits);
  const hideJs = renderHideScript(overlay.takeovers);
  const timelineJs = [splitJs, hideJs, zoomJs, ...(overlay.js ?? [])].filter(Boolean).join('\n');
  const grade = gradeFilter(s);

  const brandVars = `      :root {
        --u: ${r3(width / 1080)};
        --brand-blue: ${colors.blue || '#0f4c81'};
        --brand-orange: ${colors.orange || '#EA580C'};
        --brand-text: ${colors.text || '#FFFFFF'};
        --brand-display: '${brand.fonts?.display || 'Montserrat'}', system-ui, sans-serif;
        --brand-body: '${brand.fonts?.body || 'Plus Jakarta Sans'}', system-ui, sans-serif;
      }`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${esc(brand.name || 'Bishir Tijjani')} video</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
${brandVars}
${layer.css}
      body { margin: 0; background: ${colors.bg || '#EA580C'}; }
      #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: ${colors.bg || '#EA580C'}; }
      /* the designed backdrop is the base layer */
      #backdrop { position: absolute; inset: 0; z-index: 0; }
      #backdrop svg { display: block; width: 100%; height: 100%; }
      #a-roll { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; filter: ${grade}; transform-origin: center center; z-index: 1; }
      /* overlays sit on the burnt orange; the frame decides where and how big */
      .ov { position: absolute; inset: 0; z-index: 2; }
      .ov-takeover { background: transparent; }
      .ov-split { background: transparent; }
      .frame { position: absolute; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
      .ov-media { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: calc(var(--u) * 18px); box-shadow: 0 calc(var(--u) * 16px) calc(var(--u) * 44px) rgba(0,0,0,.35); }
      .ov-graphic { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
      .ov-diagram { width: 100%; height: 100%; display: block; }
      /* captions sit above everything; the band is a keep-out for visuals */
      .cap { z-index: 5; }
${overlay.css ? overlay.css + '\n' : ''}    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-width="${width}"
      data-height="${height}"
      data-fps="${fps}"
      data-duration="${dur}"
    >
      <div id="backdrop" aria-hidden="true">${backdropSvg}</div>
      ${audioOnly ? '' : `<video id="a-roll" class="clip" src="${esc(videoSrc)}" data-start="0" data-duration="${dur}" data-track-index="0" muted playsinline></video>`}
${overlay.html}
${layer.html}
      <audio id="a-roll-audio" src="${esc(videoSrc)}" data-start="0" data-duration="${dur}" data-track-index="10" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${timelineJs}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

  return {
    html,
    sceneCount: layer.sceneCount,
    overlayCount: overlays.length,
    zoomCount: zooms.length,
  };
}
