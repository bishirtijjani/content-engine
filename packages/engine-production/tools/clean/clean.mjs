#!/usr/bin/env node
// clean.mjs — turn a folder of raw footage into one cleaned video.
//
//   data/vid1/  one video (with its own scratch audio) + one high-quality audio
//
//   1. align    sample-accurate offset + drift between the two (align.py)
//   2. place    build the aligned recording on the video's timeline (place.py)
//   3. guess    a word-timed transcript of the aligned audio (transcribe.py)
//   4. cuts     pauses, fillers, retakes -> a cut list  (shown, never auto-applied)
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
  existsSync, readFileSync, statSync, writeFileSync, readdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadStyle } from '../../src/style.mjs';
import { buildCuts } from './lib/cut.mjs';
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
  console.log('   #  reason      start      end        len     detail');
  cuts.forEach((c, i) => {
    const detail = c.detail ? c.detail.slice(0, 46) : '';
    console.log(
      `  ${String(i + 1).padStart(2)}  ${c.reason.padEnd(10)}  ${fmt(c.start).padStart(8)}  ` +
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

function cutArgs({ video, audio, keeps, crf, fpsRational, audioBitrate, out }) {
  const parts = [];
  const vs = [];
  const as = [];
  keeps.forEach((k, i) => {
    parts.push(`[0:v]trim=start=${k.start.toFixed(6)}:end=${k.end.toFixed(6)},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[1:a]atrim=start=${k.start.toFixed(6)}:end=${k.end.toFixed(6)},asetpts=PTS-STARTPTS[a${i}]`);
    vs.push(`[v${i}]`);
    as.push(`[a${i}]`);
  });
  if (keeps.length > 1) {
    parts.push(`${vs.join('')}concat=n=${keeps.length}:v=1:a=0[vout]`);
    parts.push(`${as.join('')}concat=n=${keeps.length}:v=0:a=1[aout]`);
  } else {
    parts.push('[v0]null[vout]');
    parts.push('[a0]null[aout]');
  }
  const args = [
    '-y', '-i', video, '-i', audio,
    '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', audioBitrate, '-movflags', '+faststart',
  ];
  if (fpsRational) args.push('-r', fpsRational);
  args.push(out);
  return args;
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

  // 2b. measure silence from the audio (pauses never come from transcript gaps)
  const silPath = path.join(folder, `${base}.silences.json`);
  if (realign || stale(silPath, alignPath)) {
    guardOutput(silPath, INPUTS);
    runPython(path.join(HERE, 'silence.py'), ['--audio', wav, '--min', String(cleanCfg.gapMin ?? 0.6), '--out', silPath], 'measuring silence');
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

  // 4. build the cut list
  const result = buildCuts({
    words,
    span: { start: align.overlap_start, end: align.overlap_end },
    silences,
    config: { ...cleanCfg, frameFps: video.probe.fps },
  });
  const cutsPath = path.join(folder, `${base}.cuts.json`);
  guardOutput(cutsPath, INPUTS);
  writeFileSync(
    cutsPath,
    JSON.stringify({ align, span: result.span, stats: result.stats, cuts: result.cuts, keeps: result.keeps }, null, 2),
    'utf8',
  );

  console.log(`\nproposed cuts (${result.cuts.length}) — nothing has been cut\n`);
  printTable(result.cuts);
  const total = result.stats.kept + result.stats.removed;
  const pct = total ? (result.stats.removed / total) * 100 : 0;
  console.log(`\n  ${fmt(align.overlap_duration)} -> ${fmt(result.stats.kept)}   removed ${fmt(result.stats.removed)} (${pct.toFixed(1)}%)`);

  if (!apply) {
    console.log(`\n  review the list, then: npm run clean -- ${folderArg} --apply\n`);
    return;
  }

  // 5. apply
  const cleaned = path.join(folder, `${base}.cleaned.mp4`);
  guardOutput(cleaned, INPUTS);
  const crf = outCfg.crf ?? 18;
  const audioBitrate = outCfg.audioBitrate ?? '192k';
  console.log(`\n  cutting ${result.keeps.length} keep(s) -> ${path.basename(cleaned)} (crf ${crf})...\n`);
  const args = cutArgs({
    video: video.file, audio: wav, keeps: result.keeps,
    crf, fpsRational: video.probe.fpsRational, audioBitrate, out: cleaned,
  });
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
  if (res.status !== 0) die(`ffmpeg cut failed:\n${(res.stderr || '').slice(-600)}`);

  writeFileSync(path.join(folder, `${base}.cleaned.transcript.json`), JSON.stringify(remapTranscript(words, result.keeps), null, 2), 'utf8');

  const cProbe = probe(cleaned);
  const mb = (statSync(cleaned).size / 1e6).toFixed(0);
  console.log(`  done  ${path.basename(cleaned)}  ${fmt(cProbe.duration)}  ${mb} MB\n`);
  console.log(`  next: engine.processFootage({ targetId, filePath: '${path.relative(process.cwd(), cleaned).replace(/\\/g, '/')}' })\n`);
}

main();
