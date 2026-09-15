#!/usr/bin/env node
/**
 * job.mjs — the videoer machine's operator interface (thin orchestrator).
 *
 *   node tools/job.mjs new <input> [--slug s]   scaffold a job from footage/audio/script/url/pr
 *   node tools/job.mjs caption <slug>           transcribe source -> source/transcript.json (+ lexicon)
 *   node tools/job.mjs cut <slug> <start> <end> <name>   ffmpeg-trim a short's source clip
 *   node tools/job.mjs render <slug>            render long/ + shorts/* sequentially -> output/
 *   node tools/job.mjs status <slug>            print the job manifest
 *
 * Creative authoring (composition HTML, choosing short moments) is done by the agent
 * via the HyperFrames skills; this script owns the deterministic plumbing around it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "videoer.config.json"), "utf8"));
const JOBS = path.join(ROOT, CONFIG.paths.jobs);
const OUTPUT = path.join(ROOT, CONFIG.paths.output);

const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]);
const TEXT_EXT = new Set([".md", ".txt"]);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
  return r;
}
function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
const flag = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const today = () => new Date().toISOString().slice(0, 10);
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function jobDir(slug) {
  const hits = fs.existsSync(JOBS) ? fs.readdirSync(JOBS).filter((d) => d.endsWith(`-${slug}`) || d === slug) : [];
  if (!hits.length) throw new Error(`no job matching "${slug}" under ${JOBS}`);
  return path.join(JOBS, hits.sort().reverse()[0]);
}
const readManifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "job.json"), "utf8"));
const writeManifest = (dir, m) => fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(m, null, 2) + "\n");

function detectType(input) {
  if (/^https?:\/\//i.test(input)) {
    return /github\.com\/[^/]+\/[^/]+\/pull\//i.test(input) ? "pr" : "url";
  }
  const ext = path.extname(input).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "footage";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (TEXT_EXT.has(ext)) return "script";
  throw new Error(`cannot detect input type for "${input}"`);
}

// ---- commands ---------------------------------------------------------------
function cmdNew(input) {
  if (!input) throw new Error("usage: job new <input> [--slug s]");
  const type = detectType(input);
  const slug = flag("slug", type === "url" || type === "pr" ? slugify(input.replace(/^https?:\/\//, "")) : slugify(path.basename(input, path.extname(input))));
  const dir = path.join(JOBS, `${today()}-${slug}`);
  if (fs.existsSync(dir)) throw new Error(`job already exists: ${dir}`);
  fs.mkdirSync(path.join(dir, "source"), { recursive: true });
  fs.mkdirSync(path.join(dir, "shorts"), { recursive: true });

  const manifest = {
    slug, date: today(), created: new Date().toISOString(),
    input: { raw: input, type },
    route: CONFIG.routing[type] || CONFIG.routing.longform,
    source: {}, status: "new", long: null, shorts: [], outputs: [],
  };

  if (type === "footage" || type === "audio") {
    const src = path.resolve(input.startsWith(ROOT) ? input : path.join(ROOT, input));
    const dest = path.join(dir, "source", type === "footage" ? "source.mp4" : "track" + path.extname(input));
    fs.copyFileSync(src, dest);
    manifest.source[type === "footage" ? "video" : "audio"] = path.relative(dir, dest).replace(/\\/g, "/");
  } else if (type === "script") {
    const dest = path.join(dir, "source", "script.md");
    fs.copyFileSync(path.resolve(path.join(ROOT, input)), dest);
    manifest.source.script = "source/script.md";
  } else {
    manifest.source.url = input;
  }

  writeManifest(dir, manifest);
  console.log(`✓ new job: ${path.relative(ROOT, dir)}  (type=${type}, route=${manifest.route})`);
}

function cmdCaption(slug) {
  const dir = jobDir(slug);
  const m = readManifest(dir);
  const src = m.source.video || m.source.audio;
  if (!src) throw new Error("job has no footage/audio source to transcribe");
  const out = path.join(dir, "source", "transcript.json");
  const lex = path.join(ROOT, CONFIG.brand.lexicon);
  run("python", [path.join(ROOT, "tools", "transcribe.py"),
    path.join(dir, src), "--model", CONFIG.captions.model, "--out", out, "--lexicon", lex]);
  m.source.transcript = "source/transcript.json";
  m.status = "captioned";
  writeManifest(dir, m);
  console.log(`✓ transcript: ${path.relative(ROOT, out)}`);
}

function cmdCut(slug, start, end, name) {
  const dir = jobDir(slug);
  const m = readManifest(dir);
  if (!m.source.video) throw new Error("cut needs footage");
  if (!start || !end || !name) throw new Error("usage: job cut <slug> <start> <end> <name>");
  const shortDir = path.join(dir, "shorts", name);
  fs.mkdirSync(shortDir, { recursive: true });
  const dest = path.join(shortDir, "source.mp4");
  run("ffmpeg", ["-y", "-ss", String(start), "-to", String(end), "-i", path.join(dir, m.source.video),
    "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", dest]);
  if (!m.shorts.includes(name)) { m.shorts.push(name); writeManifest(dir, m); }
  console.log(`✓ short clip: ${path.relative(ROOT, dest)}`);
}

function cmdBuild(slug) {
  const dir = jobDir(slug);
  const m = readManifest(dir);
  if (!m.source.video) {
    throw new Error(`auto-build only handles footage; route "${m.route}" is agent-authored (use the ${m.route} skill)`);
  }
  if (!m.source.transcript) throw new Error(`run "job caption ${slug}" first`);

  const longDir = path.join(dir, "long");
  fs.mkdirSync(longDir, { recursive: true });
  fs.copyFileSync(path.join(dir, m.source.video), path.join(longDir, "source.mp4"));

  const probe = JSON.parse(capture("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-show_entries", "format=duration",
    "-of", "json", path.join(dir, m.source.video)]));
  const { width, height } = probe.streams[0];
  const duration = Number(probe.format.duration);

  run("node", [path.join(ROOT, "tools", "build-captions.mjs"),
    "--video", "source.mp4",
    "--transcript", path.join(dir, m.source.transcript),
    "--out", path.join(longDir, "index.html"),
    "--width", String(width), "--height", String(height), "--duration", String(duration),
    "--title", `${m.slug} — ${CONFIG.brand.name}`,
    "--config", path.join(ROOT, "config", "videoer.config.json"),
    "--lexicon", path.join(ROOT, CONFIG.brand.lexicon)]);

  m.long = "long/index.html";
  m.status = "built";
  writeManifest(dir, m);
  console.log(`✓ composition: ${path.relative(ROOT, path.join(longDir, "index.html"))} (${width}x${height}) — run "npx hyperframes check" in it, then "job render ${slug}"`);
}

function cmdRender(slug) {
  const dir = jobDir(slug);
  const m = readManifest(dir);
  const outDir = path.join(OUTPUT, path.basename(dir));
  fs.mkdirSync(outDir, { recursive: true });

  const targets = [];
  if (fs.existsSync(path.join(dir, "long", "index.html"))) targets.push(["long", path.join(dir, "long")]);
  for (const s of fs.existsSync(path.join(dir, "shorts")) ? fs.readdirSync(path.join(dir, "shorts")) : []) {
    if (fs.existsSync(path.join(dir, "shorts", s, "index.html"))) targets.push([s, path.join(dir, "shorts", s)]);
  }
  if (!targets.length) throw new Error(`nothing to render — no index.html in ${dir}/long or /shorts/* (author it first)`);

  m.outputs = [];
  for (const [name, proj] of targets) {
    let outFile = path.join(outDir, `${name}.mp4`);
    // Windows holds a lock on a file that's open in a preview; the renderer's
    // final rename then fails with EPERM. Version around a locked prior output.
    if (fs.existsSync(outFile)) {
      try { fs.rmSync(outFile); }
      catch {
        outFile = path.join(outDir, `${name}-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}.mp4`);
        console.log(`  (previous ${name}.mp4 is locked/open — writing ${path.basename(outFile)})`);
      }
    }
    console.log(`\n▶ rendering ${name} …`);
    run("npx", ["hyperframes", "render", "--output", outFile], { cwd: proj });
    const ok = fs.existsSync(outFile) && fs.statSync(outFile).size > 0;
    console.log(ok ? `  ✓ ${path.relative(ROOT, outFile)} (${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB)` : `  ✗ ${name} produced no output`);
    m.outputs.push({ name, file: path.relative(ROOT, outFile).replace(/\\/g, "/"), ok });
  }
  m.status = "rendered";
  writeManifest(dir, m);
  console.log(`\n✓ outputs in ${path.relative(ROOT, outDir)}`);
}

function cmdStatus(slug) {
  console.log(JSON.stringify(readManifest(jobDir(slug)), null, 2));
}

// ---- dispatch ---------------------------------------------------------------
const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "new") cmdNew(rest[0]);
  else if (cmd === "caption") cmdCaption(rest[0]);
  else if (cmd === "build") cmdBuild(rest[0]);
  else if (cmd === "cut") cmdCut(rest[0], rest[1], rest[2], rest[3]);
  else if (cmd === "render") cmdRender(rest[0]);
  else if (cmd === "status") cmdStatus(rest[0]);
  else {
    console.log("commands: new <input> [--slug s] | caption <slug> | build <slug> | cut <slug> <start> <end> <name> | render <slug> | status <slug>");
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
}
