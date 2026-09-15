#!/usr/bin/env node
/**
 * build-captions.mjs — transcript.json -> a renderable HyperFrames composition,
 * styled to the Bishir Tijjani caption spec:
 *
 *   - mostly navy, ALL-CAPS Montserrat 800/900
 *   - NO box / no background — heavy drop shadow only (--cap-shadow)
 *   - one CLAUSE at a time (grouping lives in ./lib/captions.mjs, regression-tested)
 *   - emphasis compound term much bigger, on its own line, in accent (orange)
 *   - centered low-third (y ~= h * 0.72)
 *
 * Caption scenes come from the tested clause splitter, and validateCaptions() is a
 * HARD GATE: if any scene breaks a clause, dangles a function word, or over-emphasizes,
 * this script throws and nothing renders. See tools/captions.test.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupCaptions, validateCaptions } from "./lib/captions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};

const videoSrc = arg("video", "source.mp4");
const transcriptPath = arg("transcript");
const outPath = arg("out", "index.html");
const width = Number(arg("width"));
const height = Number(arg("height"));
const title = arg("title", "Bishir Tijjani video");
const configPath = arg("config");
const lexiconPath = arg("lexicon");
const gsapSrc = arg("gsap-src", "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js");

if (!transcriptPath || !width || !height) {
  console.error("usage: build-captions.mjs --transcript <json> --width W --height H [...]");
  process.exit(1);
}

const cfg = configPath && fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
const brand = cfg.brand || {};
const capCfg = cfg.captions || {};
const g = {
  maxWords: 5, maxChars: 30, pauseGap: 0.7, minDuration: 0.6, hold: 0.15,
  ...(capCfg.grouping || {}),
};
const maxEmph = capCfg.maxEmphasisPerPhrase ?? 1;

const account = arg("account", brand.account || "founder");
const ORANGE = brand.colors?.orange || "#EA580C";
const NAVY = brand.colors?.blue || "#0f4c81";
// founder(@iambishir)=navy lead; agency=@codekethq removed
const LEAD = account === "agency" ? ORANGE : NAVY;
const SECOND = account === "agency" ? NAVY : ORANGE;

// ---- load + clean transcript, apply lexicon per token -----------------------
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

const MUSIC = /^[♪♫♬♩♧�\s]+$/;
let words = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
if (!Array.isArray(words)) throw new Error("transcript must be [{text,start,end}]");
words = words
  .filter((w) => w?.text?.trim() && !MUSIC.test(w.text.trim()))
  .map((w) => ({ text: fixWord(w.text.trim()), start: w.start, end: w.end }));

const duration = Number(arg("duration")) || (words.length ? words[words.length - 1].end + 0.4 : 1);

// ---- group into caption scenes (tested lib) + HARD-GATE validate ------------
const gOpts = { emphasis: capCfg.emphasis || [], maxWords: g.maxWords, maxChars: g.maxChars, pauseGap: g.pauseGap, maxEmphasisPerPhrase: maxEmph };
const caps = groupCaptions(words, gOpts);
const problems = validateCaptions(caps, gOpts);
if (problems.length) {
  console.error(`[build-captions] REFUSING TO BUILD — ${problems.length} caption rule violation(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

// ---- token scenes -> plain/emph lines with timing ---------------------------
const r3 = (n) => Math.round(n * 1000) / 1000;
let emphCount = 0;
let lines = caps.map((c) => {
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

// ---- emit -------------------------------------------------------------------
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
    <script src="${gsapSrc}"></script>
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
      <video id="a-roll" class="clip" src="${videoSrc}" data-start="0" data-duration="${dur}" data-track-index="0" muted playsinline></video>
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

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, html, "utf8");
console.error(`[build-captions] ${lines.length} scenes · ${emphCount} emphasis · account=${account} (lead ${LEAD}) · ${dur}s · GATE PASSED -> ${outPath}`);
