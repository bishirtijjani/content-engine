#!/usr/bin/env node
// clean.mjs — turn a folder of raw footage into one cleaned video.
//
//   data/vid1/  one video (with its own scratch audio) + one high-quality audio
//
//   1. align    sample-accurate offset + drift between the two (align.py)
//   2. place    build the aligned recording on the video's timeline (place.py)
//   3. guess    a word-timed transcript of the aligned audio (transcribe.py)
//   4. cuts     pauses, fillers, self-talk, repeated takes -> a cut list
//               (shown, never auto-applied)
//   5. apply    --apply cuts the picture and audio in one pass
//
// The engine never cuts. This tool proposes; the human approves.
//
// Usage:
//   node tools/clean/clean.mjs data/vid1            # propose (print the cut list)
//   node tools/clean/clean.mjs data/vid1 --apply    # cut
//   ... --realign                                   # ignore the cached alignment

import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, statSync, writeFileSync, readdirSync, mkdirSync, rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadStyle } from '../../src/style.mjs';
import { buildCuts } from './lib/cut.mjs';
import { wordFixes, applyWordFixes } from './lib/script.mjs';
import { assertNotInput } from './lib/guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.PYTHON || 'python';
const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.m4v', '.webm', '.avi', '.mts', '.m2ts']);
const AUDIO_EXT = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.mpeg', '.mpga', '.wma']);
const GENERATED = /\.(cleaned\.mp4|aligned\.wav|synced\.mp4)$/i;

function die(msg) {
  console.error(`\nclean: ${msg}\n`);
  process.exit(1);
}

/** Refuse to write over an input. The cleaner never modifies its footage. */
function guardOutput(outPath, inputs) {
  try {
    assertNotInput(outPath, inputs);
  } catch (err) {
    die(err.message);
  }
}

function parseArgs(argv) {
  const pos = [];
  const flags = new Set();
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply' || a === '--realign') flags.add(a);
    else if (a === '--model') opts.model = argv[++i];
    else if (!a.startsWith('--')) pos.push(a);
  }
  return { pos, flags, opts };
}

function probe(file) {
  const res = spawnSync('ffprobe', [
    '-v', 'error', '-print_format', 'json',
    '-show_entries', 'stream=index,codec_type,width,height,r_frame_rate,avg_frame_rate',
    '-show_entries', 'format=duration', file,
  ], { encoding: 'utf8' });
  if (res.status !== 0) die(`ffprobe failed on ${path.basename(file)}`);
  const data = JSON.parse(res.stdout);
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const rate = (v?.r_frame_rate && v.r_frame_rate !== '0/0') ? v.r_frame_rate : v?.avg_frame_rate;
  let fps = null;
  if (rate && rate.includes('/')) {
    const [n, d] = rate.split('/').map(Number);
    if (d) fps = n / d;
  }
  return {
    hasVideo: !!v,
    hasAudio: !!a,
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps,
    fpsRational: rate && rate !== '0/0' ? rate : null,
    duration: Number(data.format?.duration ?? 0),
  };
}

function findMedia(folder, base) {
  const files = readdirSync(folder)
    .filter((f) => !GENERATED.test(f))
    .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()) || AUDIO_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(folder, f));
  const videos = [];
  const audios = [];
  for (const f of files) {
    const p = probe(f);
    if (p.hasVideo) videos.push({ file: f, probe: p });
    else if (p.hasAudio) audios.push({ file: f, probe: p });
  }
  if (videos.length !== 1) die(`${base}: expected exactly one video in the folder, found ${videos.length}`);
  if (audios.length !== 1) die(`${base}: expected exactly one audio recording, found ${audios.length}`);
  return { video: videos[0], audio: audios[0] };
}

function runPython(scriptPath, args, label) {
  process.stdout.write(`  ${label}...\n`);
  const res = spawnSync(PY, [scriptPath, ...args], { encoding: 'utf8' });
  if (res.status !== 0) die(`${label} failed:\n${(res.stderr || res.stdout || '').trim()}`);
  return res.stdout;
}

/** A cached step is stale when it is missing or older than the alignment. */
function stale(file, ref) {
  return !existsSync(file) || statSync(file).mtimeMs < statSync(ref).mtimeMs;
}

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function printTable(cuts) {
  if (!cuts.length) {
    console.log('  (no cuts proposed — the take is already clean)');
    return;
  }
  const w = Math.max(12, ...cuts.map((c) => c.reason.length));
  console.log(`   #  ${'reason'.padEnd(w)}  start      end        len     detail`);
  cuts.forEach((c, i) => {
    const detail = c.detail ? c.detail.slice(0, 46) : '';
    console.log(
      `  ${String(i + 1).padStart(2)}  ${c.reason.padEnd(w)}  ${fmt(c.start).padStart(8)}  ` +
      `${fmt(c.end).padStart(8)}  ${(c.end - c.start).toFixed(2).padStart(5)}s  ${detail}`,
    );
  });
}

/** Move word times onto the cleaned timeline (drops words inside cuts). */
function remapTranscript(words, keeps) {
  const out = [];
  let removed = 0;
  for (const k of keeps) {
    for (const w of words) {
      if (w.start >= k.start - 1e-6 && w.end <= k.end + 1e-6) {
        out.push({
          text: w.text,
          start: +(w.start - k.start + removed).toFixed(3),
          end: +(w.end - k.start + removed).toFixed(3),
        });
      }
    }
    removed += k.end - k.start;
  }
  return out;
}

/**
 * Cut by encoding each keep on its own (input seek, no filter graph) then
 * joining the pieces with the concat demuxer. On a small CPU a single
 * filter-graph cut runs many times slower than plain encodes.
 */
function cutVideo({ video, audio, keeps, crf, fpsRational, audioBitrate, out, folder }) {
  const segDir = path.join(folder, '_segments');
  if (existsSync(segDir)) rmSync(segDir, { recursive: true, force: true });
  mkdirSync(segDir, { recursive: true });
  const list = [];
  keeps.forEach((k, i) => {
    const dur = k.end - k.start;
    const f = path.join(segDir, `seg${String(i).padStart(4, '0')}.mp4`);
    const args = [
      '-y', '-v', 'error',
      '-ss', k.start.toFixed(6), '-t', dur.toFixed(6), '-i', video,
      '-ss', k.start.toFixed(6), '-t', dur.toFixed(6), '-i', audio,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', audioBitrate,
    ];
    if (fpsRational) args.push('-r', fpsRational);
    args.push(f);
    if (i % 10 === 0) process.stdout.write(`  encode ${i + 1}/${keeps.length}\n`);
    const res = spawnSync('ffmpeg', args, { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
    if (res.status !== 0) die(`ffmpeg segment ${i + 1}/${keeps.length} failed:\n${(res.stderr || '').slice(-600)}`);
    list.push(`file '${f.replace(/\\/g, '/')}'`);
  });
  const listPath = path.join(segDir, 'list.txt');
  writeFileSync(listPath, list.join('\n'), 'utf8');
  const res = spawnSync('ffmpeg', [
    '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', out,
  ], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
  if (res.status !== 0) die(`ffmpeg concat failed:\n${(res.stderr || '').slice(-600)}`);
  rmSync(segDir, { recursive: true, force: true });
}

/** One answers file the agent fills: lines, wrong words, asides. */
function printReview(review) {
  const unsure = review.lines.filter((L) => L.status === 'missing');
  console.log('\nlines — engine placed these out of the script; set "decision" to "keep" or "skip"');
  review.lines.forEach((L) => {
    const mark = L.status === 'found' ? 'found' : 'not found';
    const heard = L.heard ? `  heard: ${L.heard.slice(0, 80)}` : '';
    console.log(`  ${String(L.line + 1).padStart(2)}  ${mark.padEnd(9)}  ${L.decision.padEnd(4)}  ${L.script.slice(0, 70)}${heard}`);
  });
  if (unsure.length) console.log(`  -> ${unsure.length} line(s) not found: ${unsure.map((L) => L.line + 1).join(',')}`);

  if (review.words.length) {
    console.log('\nwords — engine heard one thing, the script says another; set "decision" to "fix" or "leave"');
    review.words.forEach((w) => {
      console.log(`  @${fmt(w.at).padStart(8)}  ${w.decision.padEnd(5)}  heard "${w.heard}"  ->  "${w.fix}"`);
    });
  }

  console.log(`\nasides (${review.asides.length}) — set "decision" to "keep" or "drop"`);
  review.asides.forEach((a, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ${a.decision.padEnd(4)}  ${fmt(a.start)} .. ${fmt(a.end)}  ` +
      `${(a.end - a.start).toFixed(1).padStart(5)}s  ${a.text.slice(0, 70)}`);
  });
}

/** Things the eye would catch on the render, flagged before anything is cut. */
function printWarnings(warnings) {
  console.log(`\ncheck these before you approve (${warnings.length})`);
  for (const w of warnings) {
    if (w.kind === 'silence') {
      console.log(`  SILENCE  ${fmt(w.start)} .. ${fmt(w.end)}  ${w.seconds}s of dead air left inside a take`);
    } else if (w.kind === 'repeat') {
      console.log(`  REPEAT   line ${w.line + 1}  says "${w.phrase}" twice  (${fmt(w.start)} .. ${fmt(w.end)})`);
    }
  }
}

function main() {
  const { pos, flags, opts } = parseArgs(process.argv.slice(2));
  const folderArg = pos[0] ?? 'data/vid1';
  const folder = path.resolve(process.cwd(), folderArg);
  if (!existsSync(folder)) die(`folder not found: ${folder}`);
  const base = path.basename(folder);
  const apply = flags.has('--apply');
  const realign = flags.has('--realign');
  const model = opts.model ?? 'base.en';

  const style = loadStyle();
  const cleanCfg = style.clean ?? {};
  const outCfg = style.output ?? {};

  console.log(`\nclean ${folderArg}  (${apply ? 'apply' : 'propose'})\n`);
  const { video, audio } = findMedia(folder, base);
  const INPUTS = [video.file, audio.file];
  if (!video.probe.hasAudio) {
    die('the video has no audio track — alignment needs the camera\'s own scratch audio to lock onto the recording');
  }
  console.log(`  video  ${path.basename(video.file)}  ${video.probe.width}x${video.probe.height}  ${video.probe.duration.toFixed(2)}s`);
  console.log(`  audio  ${path.basename(audio.file)}  ${audio.probe.duration.toFixed(2)}s`);

  // 1. align
  const alignPath = path.join(folder, `${base}.align.json`);
  if (!realign && existsSync(alignPath)) {
    console.log(`  align  cached (${path.basename(alignPath)})`);
  } else {
    guardOutput(alignPath, INPUTS);
    writeFileSync(alignPath, runPython(path.join(HERE, 'align.py'), ['--video', video.file, '--audio', audio.file], 'aligning'), 'utf8');
  }
  const align = JSON.parse(readFileSync(alignPath, 'utf8'));
  if (!align.ok) die(`alignment failed: ${align.reason}`);
  console.log(`  align  offset ${align.offset.toFixed(4)}s  drift ${align.drift_ppm.toFixed(1)}ppm  residual ${align.residual_ms.toFixed(2)}ms  windows ${align.inliers}/${align.windows}`);
  if (align.residual_ms > 20 || align.inliers < 4) die('alignment not confident enough to cut on');
  if (!(align.overlap_duration > 0)) die('the video and the recording do not overlap in time');
  console.log(`  span   ${fmt(align.overlap_start)} .. ${fmt(align.overlap_end)}  (${fmt(align.overlap_duration)})  [trim ${align.lead_trim.toFixed(2)}s lead, ${align.tail_trim.toFixed(2)}s tail]`);

  // 2. place the aligned recording on the video timeline
  const wav = path.join(folder, `${base}.aligned.wav`);
  if (realign || stale(wav, alignPath)) {
    guardOutput(wav, INPUTS);
    runPython(path.join(HERE, 'place.py'), ['--video', video.file, '--audio', audio.file, '--align', alignPath, '--out', wav], 'placing audio');
  } else {
    console.log('  place  cached (aligned.wav)');
  }

  // 2b. measure silence from the audio (pauses never come from transcript gaps).
  //     Measured to a small fixed floor so the recording is analysed once; which
  //     silences get cut is decided later by cleanCfg.gapMin, no re-measure.
  const SIL_FLOOR = 0.12;
  const silPath = path.join(folder, `${base}.silences.json`);
  const silFloorPath = path.join(folder, `${base}.silences.floor`);
  const floorOk = existsSync(silFloorPath)
    && readFileSync(silFloorPath, 'utf8').trim() === String(SIL_FLOOR);
  if (realign || stale(silPath, alignPath) || !floorOk) {
    guardOutput(silPath, INPUTS);
    runPython(path.join(HERE, 'silence.py'), ['--audio', wav, '--min', String(SIL_FLOOR), '--out', silPath], 'measuring silence');
    writeFileSync(silFloorPath, String(SIL_FLOOR), 'utf8');
  } else {
    console.log('  quiet  cached (silences.json)');
  }
  const silences = JSON.parse(readFileSync(silPath, 'utf8'));

  // 3. transcribe the aligned audio
  const tPath = path.join(folder, `${base}.transcript.json`);
  if (realign || stale(tPath, alignPath)) {
    guardOutput(tPath, INPUTS);
    runPython(path.join(HERE, '..', 'transcribe.py'), [wav, '--model', model, '--out', tPath], 'transcribing');
  } else {
    console.log('  guess  cached (transcript.json)');
  }
  const words = JSON.parse(readFileSync(tPath, 'utf8'));

  // the script is the spine: which words belong to which line, last take wins
  const scriptPath = path.join(folder, 'script.txt');
  const script = existsSync(scriptPath)
    ? readFileSync(scriptPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    : null;
  if (script) console.log(`  script ${script.length} line(s) (${path.basename(scriptPath)})`);

  // the agent's one answers file: not-sure lines, wrong words, asides
  const reviewPath = path.join(folder, `${base}.review.json`);
  const priorReview = existsSync(reviewPath) ? JSON.parse(readFileSync(reviewPath, 'utf8')) : null;

  // 4. build the cut list
  const result = buildCuts({
    words,
    span: { start: align.overlap_start, end: align.overlap_end },
    silences,
    script,
    config: { ...cleanCfg, frameFps: video.probe.fps, review: priorReview },
  });
  if (result.qa) {
    const q = result.qa;
    const miss = q.missing.length ? `  lines the engine could not place: ${q.missing.map((n) => n + 1).join(',')}` : '';
    const asides = q.asides ? `  asides ${q.keptAsides}/${q.asides} kept` : '';
    console.log(`  check  ${q.kept}/${q.lines} line(s) kept${miss}  (lines with retries: ${q.retried.length})${asides}`);
  }

  // write the review file: keep decisions and windows the agent already set
  const priorLine = new Map((priorReview?.lines ?? []).map((L) => [L.line, L]));
  const keepWord = new Map((priorReview?.words ?? []).map((w) => [w.index, w.decision]));
  const keepAside = new Map((priorReview?.asides ?? []).map((a) => [Math.round(a.start * 10), a.decision]));
  const proposed = script ? wordFixes(words, script) : [];
  const proposedIdx = new Set(proposed.map((w) => w.index));
  const extra = (priorReview?.words ?? [])
    .filter((w) => !proposedIdx.has(w.index) && Number.isInteger(w.index) && w.index >= 0 && w.index < words.length)
    .map((w) => ({ index: w.index, at: words[w.index].start, heard: words[w.index].text, fix: w.fix, decision: w.decision ?? 'leave' }));
  const review = {
    lines: (result.lines ?? []).map((L) => {
      const p = priorLine.get(L.line);
      return {
        ...L,
        start: Number.isFinite(p?.start) ? p.start : L.start,
        end: Number.isFinite(p?.end) ? p.end : L.end,
        decision: p?.decision ?? (L.status === 'found' ? 'keep' : 'skip'),
      };
    }),
    words: [
      ...proposed.map((w) => ({ ...w, decision: keepWord.get(w.index) ?? 'leave' })),
      ...extra,
    ],
    asides: (result.asides ?? []).map((a) => ({ ...a, decision: keepAside.get(Math.round(a.start * 10)) ?? 'drop' })),
    cuts: priorReview?.cuts ?? [],
  };
  guardOutput(reviewPath, INPUTS);
  writeFileSync(reviewPath, JSON.stringify(review, null, 2), 'utf8');

  const cutsPath = path.join(folder, `${base}.cuts.json`);
  guardOutput(cutsPath, INPUTS);
  writeFileSync(
    cutsPath,
    JSON.stringify({ align, span: result.span, stats: result.stats, cuts: result.cuts, keeps: result.keeps, warnings: result.warnings }, null, 2),
    'utf8',
  );

  // the whole edit, as text: one paragraph per kept line, in order. Reading by
  // line (not by cut segment) keeps a phrase together across a trimmed pause,
  // the same way the video joins the two sides of a cut.
  const fixed = applyWordFixes(words, review.words);
  const readPath = path.join(folder, `${base}.read.txt`);
  guardOutput(readPath, INPUTS);
  const agentCuts = review.cuts ?? [];
  const cutOut = (w) => agentCuts.some((c) => w.start < c.end - 1e-6 && w.end > c.start + 1e-6);
  const readText = review.lines
    .filter((L) => L.decision === 'keep')
    .map((L) => ({ L, s: L.start ?? L.candidate?.start, e: L.end ?? L.candidate?.end }))
    .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.e))
    .sort((a, b) => a.s - b.s)
    .map(({ s, e }) => fixed.filter((w) => w.start >= s - 1e-6 && w.end <= e + 1e-6 && !cutOut(w)).map((w) => w.text).join(' ').trim())
    .filter(Boolean);
  writeFileSync(readPath, `${readText.join('\n\n')}\n`, 'utf8');

  console.log(`\nproposed cuts (${result.cuts.length}) — nothing has been cut\n`);
  printTable(result.cuts);
  printReview(review);
  if (result.warnings?.length) printWarnings(result.warnings);
  const total = result.stats.kept + result.stats.removed;
  const pct = total ? (result.stats.removed / total) * 100 : 0;
  console.log(`\n  ${fmt(align.overlap_duration)} -> ${fmt(result.stats.kept)}   removed ${fmt(result.stats.removed)} (${pct.toFixed(1)}%)`);

  if (!apply) {
    console.log(`\n  READ  ${path.relative(process.cwd(), readPath).replace(/\\/g, '/')}  — the whole edit, top to bottom.`);
    console.log(`  EDIT  ${path.basename(reviewPath)}  — set each line keep/skip, each word fix/leave, each aside keep/drop.`);
    console.log('\n  Nothing is cut until you approve. When the read looks right:');
    console.log(`    npm run clean -- ${folderArg} --apply\n`);
    return;
  }

  // 5. apply
  const cleaned = path.join(folder, `${base}.cleaned.mp4`);
  guardOutput(cleaned, INPUTS);
  const crf = outCfg.crf ?? 18;
  const audioBitrate = outCfg.audioBitrate ?? '192k';
  console.log(`\n  cutting ${result.keeps.length} keep(s) -> ${path.basename(cleaned)} (crf ${crf})...\n`);
  cutVideo({
    video: video.file, audio: wav, keeps: result.keeps,
    crf, fpsRational: video.probe.fpsRational, audioBitrate, out: cleaned, folder,
  });

  writeFileSync(path.join(folder, `${base}.cleaned.transcript.json`), JSON.stringify(remapTranscript(applyWordFixes(words, review.words), result.keeps), null, 2), 'utf8');

  const cProbe = probe(cleaned);
  const mb = (statSync(cleaned).size / 1e6).toFixed(0);
  console.log(`  done  ${path.basename(cleaned)}  ${fmt(cProbe.duration)}  ${mb} MB\n`);
  console.log(`  next: engine.processFootage({ targetId, filePath: '${path.relative(process.cwd(), cleaned).replace(/\\/g, '/')}' })\n`);
}

main();
