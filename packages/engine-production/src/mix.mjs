// mix.mjs — lay sound effects under the voice.
//
// The voice is the video's own audio, so we do not touch it. Sound effects are
// placed at their timestamps and mixed on top, with the voice left at full
// level (amix normalize=0). No music — by design.
//
// The picture is rendered first (assemble + HyperFrames), then this runs ffmpeg
// to produce the final file.
import { spawnSync } from 'node:child_process';
import { loadStyle } from './style.mjs';

/** Map a plan sound id to a library file path. */
function resolveSound(sound, style, resolveSfx) {
  if (!sound) return null;
  if (resolveSfx) {
    const direct = resolveSfx(sound);
    if (direct) return direct;
  }
  const cueValue = style?.sfx?.cues?.[sound];
  if (cueValue && resolveSfx) {
    const viaCue = resolveSfx(cueValue);
    if (viaCue) return viaCue;
  }
  return null;
}

/**
 * Build the ffmpeg arguments for the mix. Returns null when there is nothing
 * to place (no sfx, or none resolvable) — the caller then keeps the picture as-is.
 *
 * @returns {{ args: string[], placed: number } | null}
 */
export function buildMixCommand({ videoPath, outputPath, sfx = [], style = null, resolveSfx = null } = {}) {
  const s = style ?? loadStyle();
  const level = s?.sfx?.defaultLevel ?? 0.5;

  const cues = [];
  for (const item of sfx) {
    const file = resolveSound(item.sound, s, resolveSfx);
    if (!file) continue;
    const ms = Math.max(0, Math.round((item.at ?? 0) * 1000));
    cues.push({ file, ms });
  }
  if (!cues.length) return null;

  const inputs = [videoPath, ...cues.map((c) => c.file)];
  const parts = cues.map((c, i) => `[${i + 1}:a]adelay=${c.ms}:all=1,volume=${level}[s${i}]`);
  const labels = ['[0:a]', ...cues.map((_, i) => `[s${i}]`)];
  parts.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:normalize=0[aout]`);

  const args = [
    '-y',
    ...inputs.flatMap((p) => ['-i', p]),
    '-filter_complex', parts.join(';'),
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    outputPath,
  ];
  return { args, placed: cues.length };
}

/**
 * Run the mix. Returns { mixed, placed, error }.
 * When nothing is placed, no file is written and `mixed` is false.
 */
export function mixSfx({ videoPath, outputPath, sfx = [], style = null, resolveSfx = null, run = spawnSync } = {}) {
  const cmd = buildMixCommand({ videoPath, outputPath, sfx, style, resolveSfx });
  if (!cmd) return { mixed: false, placed: 0 };

  const result = run('ffmpeg', cmd.args, { encoding: 'utf8' });
  if (result.error) return { mixed: false, placed: cmd.placed, error: result.error.message };
  if (result.status !== 0) {
    return { mixed: false, placed: cmd.placed, error: `ffmpeg exit ${result.status}: ${String(result.stderr).slice(0, 400)}` };
  }
  return { mixed: true, placed: cmd.placed };
}
