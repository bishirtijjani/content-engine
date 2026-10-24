// composition/snapshot.mjs — render a SNAPSHOT's completed composition.
//
// The new model: Video -> Snapshots -> Beats. A snapshot is a whole visual
// section, not one beat. This module draws the snapshot's FINISHED state — every
// element in place — which is what its beats progressively build toward. The
// beats (and their motion) are a separate concern; here we only render the
// destination.
//
// Every significant element sits on a card (rounded brand surface + soft shadow).
// A snapshot names a `concept`; the concept is the recipe that lays out the
// finished composition. Same chrome on every concept keeps the system coherent.
//
// Every part is tagged with `data-slot="…"`, so a beat can address it by name
// (`action.target`). The SAME recipe feeds the still and the video, so they can
// never drift: the still screenshots this HTML untouched (all slots visible);
// the video's timeline hides slots at t=0 and reveals them on their beats.
import { safeBox } from './layout.mjs';
import { cardBlock, surfaceText, esc } from './primitives.mjs';
import { sceneGraphToHtml } from './scene-graph.mjs';
import { loadBackdrop } from '../style.mjs';
import { renderCaptionCSS } from '../build-captions.mjs';
import { compileDiagram } from '../diagrams/compile.mjs';

// The one CSS a scene-graph scene needs (its nodes carry their own inline styles).
const SG_CSS = '.cx-sg{position:absolute;box-sizing:border-box;}' +
  '.cx-code-p{color:rgba(255,255,255,.85)}.cx-code-k{color:#7DD3FC}.cx-code-s{color:#FCD34D}' +
  '.cx-code-c{color:rgba(255,255,255,.45);font-style:italic}.cx-code-n{color:#FDBA74}' +
  '.cx-code-f{color:#C4B5FD}.cx-code-t{color:#86EFAC}';

const FONT = {
  display: 'var(--brand-display)',
  body: 'var(--brand-body)',
  mono: 'var(--brand-mono)',
};

/** The count-up metadata for a value, or null when it is not a number. */
export function numMeta(value) {
  const raw = String(value ?? '').trim();
  if (!/\d/.test(raw)) return null;
  const currency = raw.includes('$');
  const percent = raw.includes('%');
  const decimal = raw.includes('.');
  const n = Number(raw.replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return null;
  const format = currency ? 'currency' : percent ? 'percent' : decimal ? 'decimal' : 'int';
  return { to: n, format };
}

/** A line of text with explicit type (cards set their own colours). */
function line(text, { font = 'body', size = 32, weight = 600, color = 'var(--brand-text)', tracking, caps, lh = 1.15, opacity, slot, raw = false } = {}) {
  return (
    `<div${slot ? ` data-slot="${esc(slot)}"` : ''} style="font-family:${FONT[font]};font-size:${size}px;font-weight:${weight};line-height:${lh};color:${color};overflow-wrap:break-word;` +
    `${tracking != null ? `letter-spacing:${tracking}em;` : ''}${caps ? 'text-transform:uppercase;' : ''}` +
    `${opacity != null ? `opacity:${opacity};` : ''}">${raw ? text : esc(text)}</div>`
  );
}

/** A figure ("40"), carrying count-up metadata when it is a real number. */
function figureEl(text, { size = 150, color = 'var(--brand-text)', slot = null } = {}) {
  const meta = numMeta(text);
  const span = `<span class="cx-num"${meta ? ` data-count-to="${meta.to}" data-count-format="${meta.format}"` : ''}>${esc(text)}</span>`;
  return (
    `<div${slot ? ` data-slot="${esc(slot)}"` : ''} style="font-family:${FONT.display};font-size:${size}px;font-weight:900;` +
    `line-height:1;letter-spacing:-0.03em;color:${color}">${span}</div>`
  );
}

const S = {
  kicker: (t, slot) => line(t, { size: 30, weight: 800, tracking: 0.22, caps: true, opacity: 0.85, slot }),
  headline: (t, color, slot) => line(t, { font: 'display', size: 84, weight: 900, lh: 1.04, color, slot }),
  figure: (t, opts) => figureEl(t, opts),
  label: (t, color, slot) => line(t, { size: 36, weight: 600, color, lh: 1.2, slot }),
  small: (t, color, slot) => line(t, { size: 30, weight: 600, color, opacity: 0.85, slot }),
};

/** A big number with a small unit on the same baseline. */
function figureLine(value, unit, { size = 120, color = 'var(--brand-text)' } = {}) {
  return (
    `<div style="display:flex;align-items:baseline;justify-content:center;gap:8px">` +
    figureEl(value, { size, color }) +
    (unit ? line(unit, { font: 'display', size: Math.round(size * 0.42), weight: 800, color }) : '') +
    `</div>`
  );
}

/** The shared stage: a fixed box, content centered, on a left axis. */
function stageCss(safe) {
  return `
    .cx-stage{position:absolute;left:${safe.x}px;top:${safe.y}px;width:${safe.w}px;height:${safe.h}px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;z-index:2;gap:${Math.round(safe.h * 0.035)}px}
    .cx-head{display:flex;flex-direction:column;align-items:center;gap:${Math.round(safe.h * 0.014)}px}
    .cx-card{position:relative}`;
}

/** The shared head: kicker + a short rule. */
function head(snapshot) {
  const items = [];
  if (snapshot.kicker) items.push(S.kicker(snapshot.kicker));
  items.push(`<div style="width:64px;height:4px;border-radius:2px;background:var(--brand-text);opacity:.9"></div>`);
  return `<div class="cx-head" data-slot="head">${items.join('')}</div>`;
}

// ---- recipes (each returns the snapshot's finished composition) ------------

/** Title + a vertical list of numbered step cards. */
function titleSteps(sn) {
  const cards = (sn.steps ?? [])
    .map((text, i) =>
      cardBlock(
        `<div style="display:flex;align-items:center;gap:34px">
           <div style="flex:0 0 auto;width:72px;height:72px;border-radius:50%;background:var(--brand-orange);
             display:flex;align-items:center;justify-content:center;font-family:${FONT.display};font-weight:900;font-size:38px;color:var(--brand-text)">${i + 1}</div>
           <div style="text-align:left">${S.label(text, 'var(--brand-text)')}</div>
         </div>`,
        { tone: 'blue', padX: 40, padY: 30, radius: 34, style: 'width:100%', slot: `step-${i}` }
      )
    )
    .join('');
  return `
    ${head(sn)}
    ${sn.headline ? S.headline(sn.headline, 'var(--brand-text)', 'headline') : ''}
    <div style="display:flex;flex-direction:column;gap:24px;width:100%">${cards}</div>`;
}

/** An arithmetic build: full-width rows (terms, then an emphasised result), a note row. */
function equation(sn) {
  const row = (slot, op, fig, unit, label, { tone = 'ghost', big = false, labelColor = 'var(--brand-text)' } = {}) =>
    cardBlock(
      `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:8px;gap:24px;width:100%">
         <div style="display:flex;align-items:baseline;gap:22px;min-width:0">
           ${op ? line(op, { font: 'display', size: big ? 92 : 66, weight: 900, color: 'var(--brand-blue)' }) : ''}
           ${fig ? figureLine(fig, unit, { size: big ? 150 : 106 }) : ''}
         </div>
         <div style="text-align:right;min-width:0">${S.label(label, labelColor)}</div>
       </div>`,
      { tone, padX: 48, padY: big ? 34 : 24, radius: 36, style: 'width:100%', slot }
    );
  const rows = [];
  (sn.terms ?? []).forEach((t, i) => rows.push(row(`term-${i}`, i > 0 ? '×' : '', t.value, t.unit, t.label)));
  if (sn.result) rows.push(row('result', '=', sn.result.value, sn.result.unit, sn.result.label, { tone: 'blue', big: true }));
  const note = sn.note
    ? cardBlock(
        `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;row-gap:8px;gap:24px;width:100%">
           <div style="display:flex;align-items:baseline;gap:22px;min-width:0">${figureLine(sn.note.value, sn.note.unit, { size: 92, color: 'var(--brand-blue)' })}</div>
           <div style="text-align:right;min-width:0">${S.label(sn.note.label, 'var(--brand-blue)')}</div>
         </div>`,
        { tone: sn.note.tone ?? 'amber', padX: 48, padY: 24, radius: 36, style: 'width:100%', slot: 'note' }
      )
    : '';
  return `
    ${head(sn)}
    <div style="display:flex;flex-direction:column;gap:16px;width:100%">${rows.join('')}${note}</div>`;
}

/** One statement on a single card, with optional chips. */
function keypoint(sn) {
  const chips = (sn.chips ?? [])
    .map((c, i) => cardBlock(S.label(c, 'var(--brand-blue)'), { tone: 'amber', padX: 32, padY: 18, radius: 999, slot: `chip-${i}` }))
    .join('');
  return `
    ${head(sn)}
    ${cardBlock(`<div style="text-align:center">${S.headline(sn.text, 'var(--brand-text)')}</div>`, { tone: 'blue', padX: 64, padY: 56, radius: 48, slot: 'text' })}
    ${chips ? `<div style="display:flex;gap:20px">${chips}</div>` : ''}`;
}

/** A worksheet: an amber header row and blank fill-in rows. */
function worksheet(sn) {
  const cols = sn.columns ?? [];
  const grid = (inner) => `<div style="display:grid;grid-template-columns:repeat(${cols.length},1fr);gap:22px;width:100%">${inner}</div>`;
  const header = cardBlock(
    grid(cols.map((c) => `<div style="text-align:left">${line(c, { size: 30, weight: 800, tracking: 0.06, caps: true, color: 'var(--brand-blue)' })}</div>`).join('')),
    { tone: 'amber', padX: 40, padY: 26, radius: 28, style: 'width:100%', slot: 'header' }
  );
  const rows = Array.from({ length: sn.rows ?? 2 })
    .map((_, i) =>
      cardBlock(
        grid(cols.map(() => '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,.30)"></div>').join('')),
        { tone: 'ghost', padX: 40, padY: 30, radius: 26, style: 'width:100%;display:flex;align-items:center;min-height:84px', slot: `row-${i}` }
      )
    )
    .join('');
  return `
    ${head(sn)}
    ${sn.headline ? S.headline(sn.headline, 'var(--brand-text)', 'headline') : ''}
    <div style="display:flex;flex-direction:column;gap:18px;width:100%">${header}${rows}</div>`;
}

/** Labeled proportional bars (comparisons). */
function bars(sn) {
  const rows = (sn.bars ?? [])
    .map((b, i) => {
      const max = Number(b.max) || 1;
      const pct = Math.max(0, Math.min(1, Number(b.value) / max)) * 100;
      const fill = b.tone === 'amber' ? 'var(--brand-orange)' : 'var(--brand-text)';
      return cardBlock(
        `<div style="width:100%">
           <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
             ${S.label(b.label, 'var(--brand-text)')}${S.label(String(b.display ?? b.value), 'var(--brand-text)')}
           </div>
           <div style="height:22px;border-radius:11px;background:rgba(255,255,255,.18);overflow:hidden">
             <div class="cx-bar-fill" style="width:${pct.toFixed(1)}%;height:100%;border-radius:11px;background:${fill}"></div>
           </div>
         </div>`,
        { tone: 'ghost', padX: 40, padY: 28, radius: 30, style: 'width:100%', slot: `bar-${i}` }
      );
    })
    .join('');
  return `
    ${head(sn)}
    ${sn.headline ? S.headline(sn.headline, 'var(--brand-text)', 'headline') : ''}
    <div style="display:flex;flex-direction:column;gap:18px;width:100%">${rows}</div>`;
}

/** A question card with branch cards. */
function decision(sn) {
  const branches = (sn.branches ?? [])
    .map((b, i) => cardBlock(S.label(b.text, surfaceText(b.tone ?? 'ghost')), { tone: b.tone ?? 'ghost', padX: 44, padY: 30, radius: 34, slot: `branch-${i}` }))
    .join('');
  return `
    ${head(sn)}
    ${cardBlock(`<div style="text-align:center">${S.headline(sn.question, 'var(--brand-text)')}</div>`, { tone: 'blue', padX: 60, padY: 50, radius: 44, slot: 'question' })}
    <div style="display:flex;gap:24px;flex-wrap:wrap;justify-content:center">${branches}</div>`;
}

/** A quote card, optionally with a struck-through line above it. */
function quote(sn) {
  const struck = sn.struck
    ? `<div data-slot="struck" style="position:relative;display:inline-block;opacity:.75;margin-bottom:26px">${S.headline(sn.struck, 'var(--brand-text)')}
         <div style="position:absolute;left:-3%;top:54%;width:106%;height:7px;border-radius:3px;background:var(--brand-orange);transform:rotate(-3deg)"></div></div>`
    : '';
  return `
    ${head(sn)}
    ${struck}
    ${cardBlock(`<div style="text-align:center">${line(sn.text, { size: 56, weight: 600, lh: 1.3, color: 'var(--brand-text)' })}</div>`, { tone: 'blue', padX: 64, padY: 56, radius: 48, slot: 'text' })}`;
}

/** A closing call to action. */
function cta(sn) {
  return `
    ${head(sn)}
    ${cardBlock(`<div style="text-align:center">${S.headline(sn.text, 'var(--brand-text)')}</div>`, { tone: 'blue', padX: 64, padY: 56, radius: 48, slot: 'text' })}
    ${sn.handle ? cardBlock(S.label(sn.handle, 'var(--brand-blue)'), { tone: 'amber', padX: 40, padY: 22, radius: 999, slot: 'handle' }) : ''}
    ${sn.sub ? S.label(sn.sub, 'var(--brand-text)', 'sub') : ''}`;
}

export const SNAPSHOT_RECIPES = {
  'title-steps': titleSteps,
  equation,
  keypoint,
  worksheet,
  decision,
  bars,
  quote,
  cta,
};

/**
 * Render one snapshot's completed composition to { html, css }. The stage's
 * parts carry `data-slot` ids so a beat can address them. Used for BOTH the
 * still (untouched) and the video (its timeline hides then reveals slots).
 */
export function renderSnapshotScene(snapshot, { style, width, height, orientation = 'portrait' }) {
  const recipe = SNAPSHOT_RECIPES[snapshot?.concept];
  if (!recipe) throw new Error(`no snapshot recipe for concept "${snapshot?.concept}"`);
  // The recipes are drawn on a fixed design canvas (the locked output), then the
  // whole canvas is scaled to fit the actual render size. So a 1080x1920 still
  // and a 270x480 preview are the SAME design, never a re-layout.
  const designW = orientation === 'portrait' ? 1080 : 1920;
  const designH = orientation === 'portrait' ? 1920 : 1080;
  const scale = width / designW;
  const safe = safeBox(style, { width: designW, height: designH, orientation });
  const css = stageCss(safe) + `\n    .cx-scale{position:absolute;left:0;top:0;width:${designW}px;height:${designH}px;transform:scale(${scale});transform-origin:0 0}`;
  // A snapshot's `composition` holds the completed composition's content.
  const inner = recipe(snapshot.composition ?? snapshot);
  const html = `<div class="cx-scale"><div class="cx-stage">${inner}</div></div>`;
  return { html, css };
}

/** Render one snapshot's completed composition to { html, css }. */
export function composeSnapshot(snapshot, opts) {
  return renderSnapshotScene(snapshot, opts);
}

/**
 * Render one snapshot's completed composition to { html, css } — the ONE entry
 * point for both the still and the video. A scene-graph snapshot renders through
 * the generic scene-graph renderer (no concept/recipe); a concept snapshot renders
 * through its recipe. Both return slot-tagged HTML on the fixed design canvas.
 */
export function renderSnapshotHtml(snapshot, { style, width, height, orientation = 'portrait' } = {}) {
  // A diagram is an authoring layer: compile it to the same scene-graph the
  // renderer already understands, for this orientation.
  const sg = snapshot?.sceneGraph
    ?? (snapshot?.diagram
      ? compileDiagram({ name: snapshot.diagram.name, spec: snapshot.diagram.spec, style, orientation }).sceneGraph
      : null);
  if (sg) {
    return { html: sceneGraphToHtml(sg, { width, height, orientation, style }), css: SG_CSS };
  }
  return renderSnapshotScene(snapshot, { style, width, height, orientation });
}

/**
 * A full standalone page for a snapshot still (backdrop + completed composition
 * + optional caption band), using the SAME caption CSS the engine renders.
 */
export function composeSnapshotHTML({ snapshot, caption = '', style, width = 1080, height = 1920, orientation = 'portrait' }) {
  const { html, css } = renderSnapshotHtml(snapshot, { style, width, height, orientation });
  const backdrop = loadBackdrop(style);
  const capCss = renderCaptionCSS(style, width, orientation);
  const capHtml = caption ? `<div class="cap"><div class="cap-inner">${caption}</div></div>` : '';
  const brand = style.brand ?? {};
  const colors = brand.colors ?? {};
  const fontVar = (k, fallback) => `'${brand.fonts?.[k] ?? fallback}',${k === 'mono' ? 'ui-monospace,monospace' : 'system-ui,sans-serif'}`;
  const brandVars =
    `:root{--brand-blue:${colors.blue || '#0f4c81'};--brand-orange:${colors.orange || '#EA580C'};` +
    `--brand-surface:${colors.surface || '#F59E0B'};--brand-text:${colors.text || '#FFFFFF'};--brand-accent-soft:#FB923C;` +
    `--brand-display:${fontVar('display', 'Montserrat')};--brand-body:${fontVar('body', 'Plus Jakarta Sans')};--brand-mono:${fontVar('mono', 'JetBrains Mono')};}`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800;900&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>${brandVars}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{width:${width}px;height:${height}px;background:${colors.bg || '#EA580C'}}
#root{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${colors.bg || '#EA580C'}}
#backdrop{position:absolute;inset:0;z-index:0}#backdrop svg{display:block;width:100%;height:100%}
${capCss}
${css}
</style></head><body><div id="root">
<div id="backdrop" aria-hidden="true">${backdrop}</div>
${html}
${capHtml}
</div></body></html>`;
}
