// composition/timeline.mjs — build ONE runtime composition from a segment plan.
//
// The build path. Given the plan (Video -> Segments -> Beats) and the narration
// words, this derives the visual timeline (footage + snapshots, word-timed) and
// produces a HyperFrames composition:
//
//   1. the burnt-orange backdrop + the designed SVG (base layer)
//   2. the a-roll video + audio (the face)
//   3. one full-canvas SCENE per SNAPSHOT segment, on top of the footage, always
//      on the orange backdrop (the face is hidden while a snapshot plays). Its
//      slots are ALL hidden at the scene start and each is revealed on its beat
//      (word-accurately), so nothing is on screen before its narration. FOOTAGE
//      segments — derived where no snapshot content is on screen — have no scene:
//      the face shows.
//   4. the caption layer, above everything.
//
// All motion lives in one paused GSAP timeline registered as
// `window.__timelines["main"]` — the runtime seeks it. Beats -> motion.mjs;
// scene entrance/exit -> motion.mjs; captions are clips the runtime shows/hides.
import { renderSnapshotHtml } from './snapshot.mjs';
import { deriveSegments } from './footage.mjs';
import { beatLines, sceneLines, countUpHelper, drawHelper } from './motion.mjs';
import { loadStyle, loadBackdrop, LEXICON_PATH } from '../style.mjs';
import { fontFaceCss } from '../fonts.mjs';
import { deriveBeats } from '../beats.mjs';
import { synthesizeDiagramBeats } from '../diagrams/beats.mjs';
import { buildCaptionLayer } from '../build-captions.mjs';

const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const sceneSel = (id) => `#sc-${id}`;

/**
 * Build the runtime composition for a segment plan.
 * @returns {{ html:string, scenes:number, beats:number, tweens:number }}
 */
export function buildSnapshotComposition({
  plan,
  words = [],
  videoSrc,
  width,
  height,
  duration,
  style = null,
  lexiconPath = LEXICON_PATH,
  orientation = 'portrait',
  fit = 'cover',
  fps = 24,
  audioOnly = false,
}) {
  const s = style ?? loadStyle();
  const brand = s.brand ?? {};
  const colors = brand.colors ?? {};
  // The engine derives the visual timeline (footage + snapshots) from the words;
  // footage is a first-class segment, word-timed.
  const authored = synthesizeDiagramBeats(plan, deriveBeats(words), { style: s });
  const segments = deriveSegments(authored, {
    words,
    minGapSeconds: s?.footage?.minGapSeconds ?? 3.0,
    minSnapshotSeconds: s?.footage?.minSnapshotSeconds ?? 2.0,
  }).segments;
  const snapshots = segments.filter((x) => x.kind === 'snapshot');
  const dur = r3(duration ?? (segments.length ? segments[segments.length - 1].end : 60));
  const backdrop = loadBackdrop(s);

  // Captions (the visual layer that rides the voice, independent of segments).
  const layer = buildCaptionLayer({
    words, width, style: s, lexiconPath, emphasis: s.captions?.emphasis, duration: dur, orientation,
  });

  const sceneHtml = [];
  const sceneCss = new Map();
  const lines = [];
  const counts = [];
  let tweenCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind !== 'snapshot') continue; // footage: the face, no scene
    const next = segments[i + 1] ?? null;
    const sel = sceneSel(seg.id);
    const { html, css } = renderSnapshotHtml(seg, { style: s, width, height, orientation });
    sceneCss.set(css, true);
    // Segments are already contiguous (derived): this scene runs to its end, and
    // the next segment (a snapshot on the same backdrop, or footage) takes over.
    const holdUntil = seg.end ?? 0;
    const sceneDur = r3(Math.max(0.1, holdUntil - (seg.start ?? 0)));
    const fadeOut = !next || next.kind !== 'snapshot';
    sceneHtml.push(
      `      <div id="sc-${esc(seg.id)}" class="scene clip" data-start="${r3(seg.start ?? 0)}" ` +
      `data-duration="${sceneDur}" data-track-index="3">` +
      `<div class="sc-bg" aria-hidden="true">${backdrop}</div>${html}</div>`
    );

    for (const line of sceneLines(seg, { sceneSel: sel, style: s, fadeOut })) {
      lines.push(line); tweenCount++;
    }
    for (const b of seg.beats) {
      const { lines: bl, counts: bc } = beatLines(b, { sceneSel: sel, style: s, segment: seg, words });
      lines.push(...bl); tweenCount += bl.length;
      counts.push(...bc);
    }
  }

  for (const c of counts) {
    lines.push(`      __countUp("${c.sel}", ${c.at}, ${r3(c.dur)});`);
  }

  const brandVars = `      :root {
        --u: ${r3(width / 1080)};
        --brand-blue: ${colors.blue || '#0f4c81'};
        --brand-orange: ${colors.orange || '#EA580C'};
        --brand-surface: ${colors.surface || '#F59E0B'};
        --brand-text: ${colors.text || '#FFFFFF'};
        --brand-accent-soft: #FB923C;
        --brand-display: '${brand.fonts?.display || 'Montserrat'}', system-ui, sans-serif;
        --brand-body: '${brand.fonts?.body || 'Plus Jakarta Sans'}', system-ui, sans-serif;
        --brand-mono: '${brand.fonts?.mono || 'JetBrains Mono'}', ui-monospace, monospace;
      }`;

  const sceneCssText = [...sceneCss.keys()].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${esc(brand.name || 'Bishir Tijjani')} video</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
${fontFaceCss(s)}
${brandVars}
${layer.css}
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { background: ${colors.bg || '#EA580C'}; }
      #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: ${colors.bg || '#EA580C'}; }
      #backdrop { position: absolute; inset: 0; z-index: 0; }
      #backdrop svg { display: block; width: 100%; height: 100%; }
      #a-roll { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: ${fit === 'contain' ? 'contain' : 'cover'}; filter: ${gradeFilter(s)}; z-index: 1; }
      .scene { position: absolute; inset: 0; z-index: 2; }
      .sc-bg { position: absolute; inset: 0; z-index: 0; }
      .sc-bg svg { display: block; width: 100%; height: 100%; }
      .cap { z-index: 5; }
${sceneCssText ? sceneCssText + '\n' : ''}    </style>
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
      <div id="backdrop" aria-hidden="true">${backdrop}</div>
      ${audioOnly ? '' : `<video id="a-roll" class="clip" src="${esc(videoSrc)}" data-start="0" data-duration="${dur}" data-track-index="0" muted playsinline></video>`}
${sceneHtml.join('\n')}
${layer.html}
      <audio id="a-roll-audio" src="${esc(videoSrc)}" data-start="0" data-duration="${dur}" data-track-index="10" data-volume="1"></audio>
    </div>
    <script>
      // HyperFrames seeks the GSAP timeline but not SMIL, so the backdrop would
      // animate on wall-clock time and appear fast. Drive its clock from hf-seek.
      window.addEventListener('hf-seek', (e) => {
        const t = Number(e.detail?.time) || 0;
        for (const svg of document.querySelectorAll('#backdrop svg, .sc-bg svg')) {
          try { svg.pauseAnimations(); svg.setCurrentTime(t); } catch (_) {}
        }
      });
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${countUpHelper()}
${drawHelper()}
${lines.join('\n')}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

  return { html, scenes: snapshots.length, beats: snapshots.reduce((n, x) => n + x.beats.length, 0), tweens: tweenCount };
}

/** CSS filter from the style's grade block. */
function gradeFilter(style) {
  const g = style?.grade ?? {};
  const parts = [];
  if (g.contrast && g.contrast !== 1) parts.push(`contrast(${g.contrast})`);
  if (g.saturation && g.saturation !== 1) parts.push(`saturate(${g.saturation})`);
  if (g.brightness && g.brightness !== 1) parts.push(`brightness(${g.brightness})`);
  return parts.length ? parts.join(' ') : 'none';
}
