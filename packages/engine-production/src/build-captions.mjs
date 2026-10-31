// build-captions.mjs — transcript -> the caption layer of a composition,
// styled to the Bishir Tijjani caption spec (all values come from config/style.json):
//
//   - mostly navy, ALL-CAPS Montserrat 800/900
//   - NO box / no background — heavy drop shadow only
//   - one CLAUSE at a time (grouping lives in ../tools/lib/captions.mjs, regression-tested)
//   - emphasis compound term much bigger, on its own line, in accent
//   - centered in the caption band (style.captions.band.top, default 72%)
//
// Two consumers:
//   - buildCaptionLayer()   -> just the caption CSS + clips, for the assembler
//   - buildCaptionsComposition() -> a whole captioned composition (video + captions)
//
// Caption scenes come from the tested clause splitter, and validateCaptions() is a
// HARD GATE: if any scene breaks a clause, dangles a function word, or over-emphasizes,
// this throws and nothing renders.
import fs from "node:fs";
import { groupCaptions, validateCaptions, keepFirstEmphasis, normalizeCaptionLimits } from "../tools/lib/captions.mjs";
import { loadStyle } from "./style.mjs";

const MUSIC = /^[♪♫♬♩♧\s]+$/;
const r3 = (n) => Math.round(n * 1000) / 1000;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Load and apply lexicon corrections to a transcript.
 * @param {Array} words - Raw transcript words [{text, start, end}]
 * @param {string} lexiconPath - Path to lexicon.json
 * @returns {Array} Cleaned words with corrections applied
 */
export function loadTranscript(words, lexiconPath) {
  let corrections = {};
  if (lexiconPath && fs.existsSync(lexiconPath)) {
    const lx = JSON.parse(fs.readFileSync(lexiconPath, "utf8"));
    corrections = lx.corrections || lx || {};
  }
  const fixWord = (s) => {
    for (const [k, v] of Object.entries(corrections)) {
      if (k.startsWith("_") || typeof v !== "string" || k.includes(" ")) continue;
      s = s.replace(new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), v);
    }
    return s;
  };

  if (!Array.isArray(words)) throw new Error("transcript must be [{text,start,end}]");
  return words
    .filter((w) => w?.text?.trim() && !MUSIC.test(w.text.trim()))
    .map((w) => ({ text: fixWord(w.text.trim()), start: w.start, end: w.end }));
}

/**
 * Warn (in the render log) when an agent-chosen emphasis phrase is never spoken,
 * so a typo or a stale phrase cannot silently drop the emphasis.
 */
function warnMissingEmphasis(phrases, words) {
  if (!Array.isArray(phrases) || !phrases.length) return;
  const wtoks = words.map((w) => String(w.text).toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const phrase of phrases) {
    const ptoks = String(phrase).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    if (!ptoks.length) continue;
    let found = false;
    for (let i = 0; i < wtoks.length && !found; i++) {
      let ok = true;
      for (let k = 0; k < ptoks.length; k++) {
        if (wtoks[i + k] !== ptoks[k]) { ok = false; break; }
      }
      if (ok) found = true;
    }
    if (!found) console.warn(`[captions] emphasis phrase not found in narration: "${phrase}"`);
  }
}

/**
 * Transcript words -> caption scenes (with timing), plus the accent colors.
 * Throws if any caption breaks a rule.
 *
 * @returns {{ lines, duration, sceneCount, emphasisCount, leadColor, secondColor, grouping }}
 */
export function computeCaptionScenes({
  words: rawWords,
  width,
  style,
  lexiconPath,
  emphasis,
  duration: explicitDuration,
}) {
  const s = style ?? loadStyle();
  const brand = s.brand ?? {};
  const capCfg = s.captions ?? {};
  const g = {
    maxWords: 5, maxChars: 30, pauseGap: 0.7, minDuration: 0.6, hold: 0.15,
    ...(capCfg.grouping || {}),
  };

  const account = brand.account || "founder";
  const ORANGE = brand.colors?.orange || "#EA580C";
  const NAVY = brand.colors?.blue || "#0f4c81";
  const leadColor = account === "agency" ? ORANGE : NAVY;
  const secondColor = account === "agency" ? NAVY : ORANGE;

  const words = loadTranscript(rawWords, lexiconPath);
  const duration = Number(explicitDuration) || (words.length ? words[words.length - 1].end + 0.4 : 1);

  const emphasisList = emphasis ?? capCfg.emphasis ?? [];
  const gOpts = {
    emphasis: emphasisList,
    maxWords: g.maxWords,
    maxChars: g.maxChars,
    pauseGap: g.pauseGap,
    maxEmphasisPerPhrase: capCfg.maxEmphasisPerPhrase ?? 1,
  };
  let caps = groupCaptions(words, gOpts);
  keepFirstEmphasis(caps);
  // Demoting a second emphasis can push a caption back over the read limit; re-split.
  caps = normalizeCaptionLimits(caps, gOpts);
  keepFirstEmphasis(caps);
  if (Array.isArray(emphasis)) warnMissingEmphasis(emphasisList, words);
  const problems = validateCaptions(caps, gOpts);
  if (problems.length) {
    throw new Error(
      `[build-captions] REFUSING TO BUILD — ${problems.length} caption rule violation(s):\n` +
      problems.map((p) => `  x ${p}`).join("\n")
    );
  }

  let emphasisCount = 0;
  const lines = caps.map((c) => {
    const segs = [];
    let buf = [];
    for (const t of c) {
      if (t.emph) {
        if (buf.length) { segs.push({ type: "plain", text: buf.join(" ") }); buf = []; }
        segs.push({ type: "emph", text: t.text.replace(/[.,;:!?]+$/, "") });
        emphasisCount++;
      } else buf.push(t.text);
    }
    if (buf.length) segs.push({ type: "plain", text: buf.join(" ") });
    return { segs, start: c[0].start, end: c[c.length - 1].end };
  });

  // A caption stays up for every word inside it. The speaker runs words together
  // (median inter-word gap is ~0), so ending a caption at its own last word makes
  // it flip exactly as the next words begin — the outgoing caption vanishes while
  // its final word is still sounding ("the captions get off the recording").
  // Instead: lead a hair before the first word, hold past the last word, and only
  // yield once the next caption's first word is actually starting.
  const lead = g.lead ?? 0.08;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const nextStart = i + 1 < lines.length ? lines[i + 1].start : Infinity;
    const prevEnd = i > 0 ? lines[i - 1].end : 0;
    const wantEnd = Math.max(L.end + g.hold, L.start + g.minDuration);
    // never run past the next caption's first word (they must not overlap on screen)
    L.end = Math.min(wantEnd, nextStart, duration);
    // lead a hair before the first word, but never before the previous caption ends
    L.start = Math.max(0, prevEnd, L.start - lead);
    L.start = r3(L.start);
    L.end = r3(L.end);
    L.dur = r3(Math.max(0.1, L.end - L.start));
  }

  return { lines, duration: r3(duration), sceneCount: lines.length, emphasisCount, leadColor, secondColor, grouping: g };
}

/** The caption CSS (band position, type, shadow). */
export function renderCaptionCSS(style, width, orientation = null) {
  const s = style ?? loadStyle();
  const brand = s.brand ?? {};
  const capCfg = s.captions ?? {};
  // A portrait canvas needs its own band position and type scale. The locked
  // style carries them under captions.orientation.portrait; landscape uses the base.
  const ori = orientation ? (capCfg.orientation?.[orientation] ?? {}) : {};
  const fontCfg = { ...(capCfg.font || {}), ...(ori.font || {}) };
  const bandCfg = { ...(capCfg.band || {}), ...(ori.band || {}) };
  const base = Math.max(14, Math.round(width * (fontCfg.baseRatio ?? 0.052)));
  const emph = Math.round(base * (fontCfg.emphRatio ?? 1.8));
  const plainWeight = fontCfg.plainWeight ?? 600;
  const emphWeight = fontCfg.emphWeight ?? 900;
  const display = brand.fonts?.display || "Montserrat";
  const bandTop = Math.round((bandCfg.top ?? 0.72) * 1000) / 10;

  return `      :root { --cap-shadow: 0 2px 6px rgba(0,0,0,.85), 0 6px 22px rgba(0,0,0,.75), 0 1px 2px rgba(0,0,0,.9); }
      .cap {
        position: absolute; left: 0; right: 0; top: ${bandTop}%; transform: translateY(-50%);
        display: flex; justify-content: center; padding: 0 6%; box-sizing: border-box;
      }
      .cap-inner { display: flex; flex-direction: column; align-items: center; text-align: center; }
      .l, .e { display: block; font-family: '${display}', system-ui, sans-serif; text-transform: uppercase; text-shadow: var(--cap-shadow); }
      .l { font-weight: ${plainWeight}; font-size: ${base}px; line-height: 1.15; letter-spacing: 0.02em; color: ${brand.colors?.text || "#FFFFFF"}; opacity: 0.95; }
      .e { font-weight: ${emphWeight}; font-size: ${emph}px; line-height: 1.02; letter-spacing: -0.01em; }`;
}

/** The caption clip elements. Emphasis alternates accent colors. */
export function renderCaptionClips(lines, { leadColor = "#0f4c81", secondColor = "#EA580C" } = {}) {
  let emphIndex = 0;
  return lines
    .map((L, i) => {
      const inner = L.segs
        .map((seg) => {
          if (seg.type === "emph") {
            const color = emphIndex++ % 2 === 0 ? leadColor : secondColor;
            return `<span class="e" style="color:${color}">${esc(seg.text)}</span>`;
          }
          return `<span class="l">${esc(seg.text)}</span>`;
        })
        .join("");
      return `      <div id="cap-${i + 1}" class="clip cap" data-start="${L.start}" data-duration="${L.dur}" data-track-index="${5 + (i % 2)}"><div class="cap-inner">${inner}</div></div>`;
    })
    .join("\n");
}

/**
 * The caption layer: CSS + clip HTML + scene metadata, ready to drop into a
 * composition built by the assembler.
 */
export function buildCaptionLayer({ words, width, style, lexiconPath, emphasis, duration, orientation = null } = {}) {
  const s = style ?? loadStyle();
  const scenes = computeCaptionScenes({ words, width, style: s, lexiconPath, emphasis, duration });
  return {
    css: renderCaptionCSS(s, width, orientation),
    html: renderCaptionClips(scenes.lines, scenes),
    lines: scenes.lines,
    duration: scenes.duration,
    sceneCount: scenes.sceneCount,
    emphasisCount: scenes.emphasisCount,
    leadColor: scenes.leadColor,
  };
}

/**
 * A whole captioned composition (a-roll + captions). Kept for the simple path
 * and for audio-only sources where captions are the visual layer.
 * @returns {{ html, sceneCount, emphasisCount, leadColor }}
 */
export function buildCaptionsComposition(opts) {
  const {
    words,
    videoSrc,
    width,
    height,
    title = "Bishir Tijjani video",
    configPath,
    lexiconPath,
    duration: explicitDuration,
    audioOnly = false,
    emphasis: emphasisOverride,
  } = opts;

  if (!words || !width || !height) {
    throw new Error("buildCaptionsComposition requires: words, width, height");
  }

  const style = configPath && fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : loadStyle();
  const brand = style.brand ?? {};

  const layer = buildCaptionLayer({
    words, width, style, lexiconPath, emphasis: emphasisOverride, duration: explicitDuration,
  });
  const dur = layer.duration;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${esc(title)}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      /* Bishir Tijjani caption spec — no box, heavy shadow, ALL-CAPS Montserrat */
${layer.css}
      body { margin: 0; background: ${brand.colors?.bg || "#0B1220"}; }
      #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: ${brand.colors?.bg || "#0B1220"}; }
      #a-roll { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-width="${width}"
      data-height="${height}"
      data-duration="${dur}"
    >
      ${audioOnly ? '' : `<video id="a-roll" class="clip" src="${videoSrc}" data-start="0" data-duration="${dur}" data-track-index="0" muted playsinline></video>`}
${layer.html}
      <audio id="a-roll-audio" src="${videoSrc}" data-start="0" data-duration="${dur}" data-track-index="10" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;

  return { html, sceneCount: layer.sceneCount, emphasisCount: layer.emphasisCount, leadColor: layer.leadColor };
}
