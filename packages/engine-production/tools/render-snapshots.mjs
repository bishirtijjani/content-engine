// render-snapshots.mjs — build + render a video from a snapshot plan file.
//
//   node tools/render-snapshots.mjs <plan.json> [--final]
//
// The build step: derive the narration beats, validate the snapshot plan (hard
// fail), assemble the runtime composition (Video -> Snapshots -> Beats), write it
// next to the footage, and render it with HyperFrames. Defaults to the low-res
// preview canvas; --final locks the full-res render.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(PKG_ROOT, '..', '..');
const HYPERFRAMES_BIN = path.join(REPO, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');

const { loadStyle } = await import(path.join(PKG_ROOT, 'src', 'style.mjs'));
const { deriveNarrationBeats } = await import(path.join(PKG_ROOT, 'src', 'composition', 'snapshot-plan.mjs'));
const { validateSnapshotPlan } = await import(path.join(PKG_ROOT, 'src', 'composition', 'snapshot-spec.mjs'));
const { buildSnapshotComposition } = await import(path.join(PKG_ROOT, 'src', 'composition', 'timeline.mjs'));
const { buildScriptWords } = await import(path.join(PKG_ROOT, 'src', 'script-captions.mjs'));
const { resolvePlanTarget, itemArgv } = await import(path.join(PKG_ROOT, 'tools', 'lib', 'item-dir.mjs'));
const { linkOrCopy, pruneRenderScratch } = await import(path.join(REPO, 'packages', 'core', 'src', 'paths.js'));

const argv = process.argv.slice(2);
const planPath = argv.find((a) => !a.startsWith('--'));
const final = argv.includes('--final');
if (!planPath) {
  console.error('usage: node tools/render-snapshots.mjs <plan.json> [--final] [--item <content_items.id>]');
  process.exit(2);
}
const absPlan = path.isAbsolute(planPath) ? planPath : path.join(REPO, planPath);
if (!fs.existsSync(absPlan)) {
  console.error(`no such plan file: ${absPlan}`);
  process.exit(2);
}
const plan = JSON.parse(fs.readFileSync(absPlan, 'utf8'));
const v = plan.video ?? {};
const style = loadStyle();
const read = (rel) => (rel ? fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(REPO, rel), 'utf8') : null);

// The item's id decides the folder — never the plan's free-text video.id.
let target;
try {
  target = resolvePlanTarget({ plan, argvItem: itemArgv(argv) });
} catch (err) {
  console.error(`PLAN FAILED — ${err.message}`);
  process.exit(1);
}

const orientation = v.orientation ?? 'portrait';
const mode = final ? 'final' : 'preview';
const canvas = style?.render?.[orientation]?.[mode] ?? style?.render?.[mode] ?? { width: 270, height: 480, fps: 15 };

const scriptText = read(v.script);
const transcript = v.transcript ? JSON.parse(read(v.transcript)) : null;
if (!scriptText || !transcript) {
  console.error('PLAN FAILED — the video has no script/transcript (narration is mandatory)');
  process.exit(1);
}

const beats = deriveNarrationBeats({ scriptText, transcriptJson: transcript });
const asr = Object.values(transcript).map((w) => ({ text: w.text, start: w.start, end: w.end }));
const words = buildScriptWords(scriptText, asr);
const problems = validateSnapshotPlan(plan, { beats, words });
if (problems.length) {
  console.error(`PLAN FAILED — snapshot plan is invalid:\n - ${problems.join('\n - ')}`);
  process.exit(1);
}

// The a-roll + the words, in the composition dir (next to the plan folder).
// The a-roll + the words, in the item's production folder (next to the plan).
const dir = target.paths.assertInsideData(target.productionDir);
fs.mkdirSync(dir, { recursive: true });
const srcName = `source${path.extname(v.footage)}`;
const srcAbs = path.isAbsolute(v.footage) ? v.footage : path.join(REPO, v.footage);
if (!fs.existsSync(path.join(dir, srcName))) linkOrCopy(srcAbs, path.join(dir, srcName));
const built = buildSnapshotComposition({
  plan, words, videoSrc: srcName, width: canvas.width, height: canvas.height,
  duration: v.duration, style, orientation, fps: canvas.fps ?? 24,
});
fs.writeFileSync(path.join(dir, 'index.html'), built.html, 'utf8');
console.log(`built ${built.scenes} scenes, ${built.beats} beats, ${built.tweens} tweens → ${dir}/index.html`);

const env = { ...process.env };
if (!env.HYPERFRAMES_BROWSER_PATH) {
  const chrome = '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
  if (fs.existsSync(chrome)) env.HYPERFRAMES_BROWSER_PATH = chrome;
}
const r = style?.render ?? {};
// Finished videos go to data/renders/ like every other render — never beside
// the composition (data/renders/item-<id>[.preview].mp4).
const outputPath = target.paths.assertInsideData(target.renderPath(mode));
const args = ['--disable-warning=ExperimentalWarning', HYPERFRAMES_BIN, 'render', dir, '-o', outputPath];
if (style?.output?.crf != null) args.push('--crf', String(style.output.crf));
const workers = process.env.SNAP_WORKERS ? Number(process.env.SNAP_WORKERS) : r.workers;
if (workers != null) args.push('-w', String(workers));
args.push('-f', String(canvas.fps ?? 24));
if (r.quality) args.push('-q', String(r.quality));
args.push(r.browserGpu === false ? '--no-browser-gpu' : '--browser-gpu');
args.push(r.lowMemoryMode === false ? '--no-low-memory-mode' : '--low-memory-mode');
if (r.protocolTimeoutMs != null) args.push('--protocol-timeout', String(r.protocolTimeoutMs));
if (r.protocolTimeoutMs != null) {
  env.PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS = String(r.protocolTimeoutMs);
  env.PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS = String(r.protocolTimeoutMs);
  env.PRODUCER_PLAYER_READY_TIMEOUT_MS = String(r.protocolTimeoutMs);
}
console.log(`rendering (${mode} ${canvas.width}x${canvas.height} @ ${canvas.fps}fps)…`);
const res = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: r.timeoutMs ?? 86400000, env });
if (res.error) { console.error(`RENDER FAILED — ${res.error.message}`); process.exit(1); }
if (res.status !== 0) { console.error(`RENDER FAILED — exit ${res.status}\n${(res.stderr ?? '').slice(-2000)}`); process.exit(1); }
// HyperFrames leaves scratch work dirs behind on the way out.
pruneRenderScratch(dir);
console.log(`render OK → ${outputPath}`);
