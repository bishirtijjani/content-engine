// Production Engine — the full segment-plan flow, end to end.
//
// save_snapshot_plan -> plan_snapshots (derive beats, validate, render the plan)
//   -> approve_snapshot_plan -> edit (build). This exercises the REAL engine
// path (not the CLI tools), including the still render, so it is skipped unless
// Chrome and ffprobe are both available.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initDb } from '@content-os/core';
import { ProductionEngine } from '../src/index.js';

const CHROME = [
  process.env.CHROME_PATH,
  process.env.HYPERFRAMES_BROWSER_PATH,
  '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
].find((p) => p && existsSync(p));
const HAS_FFPROBE = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0;
const SKIP = !CHROME || !HAS_FFPROBE ? 'needs Chrome + ffprobe' : false;

test('engine flow: save -> plan -> approve -> build', { skip: SKIP }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'engine-e2e-'));
  const dataDir = path.join(root, 'data');
  mkdirSync(dataDir, { recursive: true });

  // A tiny real clip so ffprobe can read it.
  const video = path.join(root, 'clip.mp4');
  const made = spawnSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=720x1280:d=6', '-pix_fmt', 'yuv420p', video,
  ], { encoding: 'utf8' });
  assert.equal(made.status, 0, `ffmpeg failed: ${made.stderr}`);

  const script = 'Do the math across your business. The numbers tell you where to look.';
  writeFileSync(video.replace(/\.[^.]+$/, '.transcript.json'), JSON.stringify([
    { text: 'Do', start: 0.2, end: 0.4 }, { text: 'the', start: 0.4, end: 0.6 }, { text: 'math', start: 0.6, end: 0.9 },
    { text: 'across', start: 0.9, end: 1.3 }, { text: 'your', start: 1.3, end: 1.6 }, { text: 'business.', start: 1.6, end: 2.1 },
    { text: 'The', start: 2.4, end: 2.7 }, { text: 'numbers', start: 2.7, end: 3.2 }, { text: 'tell', start: 3.2, end: 3.5 },
    { text: 'you', start: 3.5, end: 3.7 }, { text: 'where', start: 3.7, end: 4.1 }, { text: 'to', start: 4.1, end: 4.3 },
    { text: 'look.', start: 4.3, end: 4.8 },
  ]));

  const db = initDb(path.join(root, 'test.db'));
  db.prepare("INSERT INTO content_items (title, status, script) VALUES ('E2E', 'shot', ?)").run(JSON.stringify({ script }));
  db.prepare("INSERT INTO recording_sessions (title) VALUES ('S')").run();
  const rec = db.prepare("INSERT INTO recordings (session_id, file_path, status) VALUES (1, ?, 'uploaded')").run(video);
  db.prepare('INSERT INTO content_item_recordings (content_item_id, recording_id, role) VALUES (1, ?, ?)')
    .run(Number(rec.lastInsertRowid), 'primary');

  const engine = new ProductionEngine(db, { dataDir });
  const plan = {
    video: { id: 'e2e', item: 1, duration: 6 },
    segments: [{
      id: 's1', kind: 'snapshot', concept: 'cta', frame: 'full', start: 0, end: 6,
      composition: { text: 'Do the math across your business.', handle: '@x' },
      beats: [{ id: 'b1', start: 0, end: 6, spoken: script, action: { op: 'introduce', target: ['text', 'handle'] }, element: 'cta' }],
    }],
  };

  assert.equal(engine.saveSnapshotPlan({ targetId: 1, plan }).saved, true);

  const planned = await engine.planSnapshots({ targetId: 1 });
  assert.equal(planned.summary.snapshots, 1);
  assert.equal(planned.summary.segments, 1);
  assert.equal(engine.snapshotPlanApproved(1), false, 'plan is not approved yet');

  engine.approveSnapshotPlan({ targetId: 1 });
  assert.equal(engine.snapshotPlanApproved(1), true);

  const built = engine.edit({ targetId: 1, dryRun: true });
  assert.equal(built.processed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n, 0, 'dry run writes no asset');

  db.close();
  rmSync(root, { recursive: true, force: true });
});
