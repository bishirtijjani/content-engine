// build-captions.mjs — transcript.json -> a renderable HyperFrames composition,
// styled to the Bishir Tijjani caption spec:
//
//   - mostly navy, ALL-CAPS Montserrat 800/900
//   - NO box / no background — heavy drop shadow only (--cap-shadow)
//   - one CLAUSE at a time (grouping lives in ./lib/captions.mjs, regression-tested)
//   - emphasis compound term much bigger, on its own line, in accent (orange)
//   - centered low-third (y ~= h * 0.72)
//
// Caption scenes come from the tested clause splitter, and validateCaptions() is a
// HARD GATE: if any scene breaks a clause, dangles a function word, or over-emphasizes,
// this script throws and nothing renders. See tools/captions.test.mjs.
import fs from "node:fs";
import path from "node:path";
import { groupCaptions, validateCaptions } from "../tools/lib/captions.mjs";

const DEFAULT_CONFIG = {
  brand: {
    name: "Bishir Tijjani",
    account: "founder",
    colors: {
      bg: "#EA580C",
      surface: "#F59E0B",
      text: "#FFFFFF",
      muted: "#FFFFFF",
      orange: "#EA580C",
      blue: "#0f4c81",
    },
    fonts: {
      display: "Montserrat",
      body: "Plus Jakarta Sans",
      mono: "JetBrains Mono",
    },
  },
  captions: {
    model: "base.en",
    language: "en",
    style: "codeket-locked",
    emphasis: ["AI automation", "AI engineer", "Bishir Tijjani"],
    maxEmphasisPerPhrase: 1,
    font: { baseRatio: 0.052, emphRatio: 1.8, plainWeight: 600, emphWeight: 900 },
    grouping: {
      maxWords: 5,
      maxChars: 30,
      pauseGap: 0.7,
      minDuration: 0.6,
      hold: 0.15,
    },
  },
};

const MUSIC = /^[♪♫♬♩♧\s]+$/;

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
   * Build a HyperFrames composition HTML from a transcript, with Bishir Tijjani caption spec.
 * @param {Object} opts
 * @param {Array} opts.words - Transcript words [{text, start, end}]
 * @param {string} opts.videoSrc - Path to the source video
 * @param {number} opts.width - Video width
 * @param {number} opts.height - Video height
 * @param {string} opts.title - Composition title
 * @param {string} [opts.configPath] - Path to videoer.config.json
 * @param {string} [opts.lexiconPath] - Path to lexicon.json
 * @param {number} [opts.duration] - Total duration in seconds
 * @param {string} [opts.account] - Brand account (founder/agency)
 * @param {boolean} [opts.audioOnly] - Source is audio-only (no video stream).
 *   Omits the <video> a-roll element so the renderer does not expect a real
 *   video file; captions become the visual layer.
 * @returns {{ html: string, sceneCount: number, emphasisCount: number, leadColor: string }}
 */
export function buildCaptionsComposition(opts) {
  const {
    words: rawWords,
    videoSrc,
    width,
    height,
    title = "Bishir Tijjani video",
    configPath,
    lexiconPath,
    duration: explicitDuration,
    account: accountOverride,
    audioOnly = false,
    emphasis: emphasisOverride,
  } = opts;

  if (!rawWords || !width || !height) {
    throw new Error("buildCaptionsComposition requires: words, width, height");
  }

  const cfg = configPath && fs.existsSync(configPath)
    ? { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, "utf8")) }
    : DEFAULT_CONFIG;

  const brand = cfg.brand || DEFAULT_CONFIG.brand;
  const capCfg = cfg.captions || DEFAULT_CONFIG.captions;
  const g = {
    maxWords: 5, maxChars: 30, pauseGap: 0.7, minDuration: 0.6, hold: 0.15,
    ...(capCfg.grouping || {}),
  };
  const maxEmph = capCfg.maxEmphasisPerPhrase ?? 1;

  const account = accountOverride || brand.account || "founder";
  const ORANGE = brand.colors?.orange || "#EA580C";
  const NAVY = brand.colors?.blue || "#0f4c81";
  const LEAD = account === "agency" ? ORANGE : NAVY;
  const SECOND = account === "agency" ? NAVY : ORANGE;

  // Load + clean transcript, apply lexicon
  const words = loadTranscript(rawWords, lexiconPath);
  const duration = Number(explicitDuration) || (words.length ? words[words.length - 1].end + 0.4 : 1);

  // Group into caption scenes + HARD-GATE validate
  const gOpts = {
    emphasis: emphasisOverride ?? capCfg.emphasis ?? [],
    maxWords: g.maxWords,
    maxChars: g.maxChars,
    pauseGap: g.pauseGap,
    maxEmphasisPerPhrase: maxEmph,
  };
  const caps = groupCaptions(words, gOpts);
  const problems = validateCaptions(caps, gOpts);
  if (problems.length) {
    throw new Error(
      `[build-captions] REFUSING TO BUILD — ${problems.length} caption rule violation(s):\n` +
      problems.map((p) => `  ✗ ${p}`).join("\n")
    );
  }

  // Token scenes -> plain/emph lines with timing
  const r3 = (n) => Math.round(n * 1000) / 1000;
  let emphCount = 0;
  const lines = caps.map((c) => {
    const segs = [];
    let buf = [];
    for (const t of c) {
      if (t.emph) {
        if (buf.length) { segs.push({ type: "plain", text: buf.join(" ") }); buf = []; }
        segs.push({ type: "emph", text: t.text.replace(/[.,;:!?]+$/, ""), color: emphCount++ % 2 === 0 ? LEAD : SECOND });
      } else buf.push(t.text);
    }
    if (buf.length) segs.push({ type: "plain", text: buf.join(" ") });
    return { segs, start: c[0].start, end: c[c.length - 1].end };
  });

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    L.end = Math.min(Math.max(L.end, L.start + g.minDuration) + g.hold, i + 1 < lines.length ? lines[i + 1].start : Infinity, duration);
    L.start = r3(L.start);
    L.end = r3(L.end);
    L.dur = r3(Math.max(0.1, L.end - L.start));
  }

  // Emit HTML
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fontCfg = capCfg.font || {};
  const base = Math.max(14, Math.round(width * (fontCfg.baseRatio ?? 0.052)));
  const emph = Math.round(base * (fontCfg.emphRatio ?? 1.8));
  const plainWeight = fontCfg.plainWeight ?? 600;
  const emphWeight = fontCfg.emphWeight ?? 900;
  const dur = r3(duration);
  const display = brand.fonts?.display || "Montserrat";

  const capEls = lines
    .map((L, i) => {
      const inner = L.segs
        .map((s) => s.type === "emph"
          ? `<span class="e" style="color:${s.color}">${esc(s.text)}</span>`
          : `<span class="l">${esc(s.text)}</span>`)
        .join("");
      return `      <div id="cap-${i + 1}" class="clip cap" data-start="${L.start}" data-duration="${L.dur}" data-track-index="${5 + (i % 2)}"><div class="cap-inner">${inner}</div></div>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>${esc(title)}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      /* Bishir Tijjani caption spec — no box, heavy shadow, ALL-CAPS Montserrat */
      :root { --cap-shadow: 0 2px 6px rgba(0,0,0,.85), 0 6px 22px rgba(0,0,0,.75), 0 1px 2px rgba(0,0,0,.9); }
      body { margin: 0; background: ${brand.colors?.bg || "#0B1220"}; }
      #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: ${brand.colors?.bg || "#0B1220"}; }
      #a-roll { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .cap {
        position: absolute; left: 0; right: 0; top: 72%; transform: translateY(-50%);
        display: flex; justify-content: center; padding: 0 6%; box-sizing: border-box;
      }
      .cap-inner { display: flex; flex-direction: column; align-items: center; text-align: center; }
      .l, .e { display: block; font-family: '${display}', system-ui, sans-serif; text-transform: uppercase; text-shadow: var(--cap-shadow); }
      .l { font-weight: ${plainWeight}; font-size: ${base}px; line-height: 1.15; letter-spacing: 0.02em; color: ${brand.colors?.text || "#FFFFFF"}; opacity: 0.95; }
      .e { font-weight: ${emphWeight}; font-size: ${emph}px; line-height: 1.02; letter-spacing: -0.01em; }
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
${capEls}
      <audio id="a-roll-audio" src="${videoSrc}" data-start="0" data-duration="${dur}" data-track-index="10" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;

  return { html, sceneCount: lines.length, emphasisCount: emphCount, leadColor: LEAD };
}
