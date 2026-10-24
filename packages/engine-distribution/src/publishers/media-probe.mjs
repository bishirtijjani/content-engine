// Video metadata probe. Uses the ffprobe already required by the Production
// engine; no npm dependency. The publisher can inject a probe for tests.
import { spawnSync } from 'node:child_process';

export function probeVideo(filePath, { spawn = spawnSync, timeoutMs = 10000 } = {}) {
  const result = spawn('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate,duration',
    '-of', 'json',
    filePath,
  ], { encoding: 'utf8', timeout: timeoutMs });

  if (result.error || result.status !== 0) return null;

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }

  const stream = parsed.streams?.[0];
  if (!stream) return null;

  return {
    width: Number(stream.width) || null,
    height: Number(stream.height) || null,
    fps: parseRate(stream.r_frame_rate) ?? parseRate(stream.avg_frame_rate),
    duration: Number(stream.duration) || null,
  };
}

function parseRate(value) {
  if (!value) return null;
  const [numerator, denominator] = String(value).split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}
