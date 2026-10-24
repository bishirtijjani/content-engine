// Distribution worker: exclusive lock, one pass, partial failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from '@content-os/core';
import { DistributionEngine } from '../src/index.js';
import { NginxMediaHost } from '../src/media-host.mjs';
import { acquireLock, releaseLock, runWorker } from '../src/worker.mjs';

class FakePublisher {
  constructor() {
    this.calls = [];
    this.cleanupCalls = 0;
  }

  async publish(args) {
    this.calls.push(args);
    return { externalId: 'ext-1', url: 'https://example.test/1' };
  }

  async cleanup() {
    this.cleanupCalls++;
    return 2;
  }

  health() {
    return { publishers: ['tiktok:main'], missing: {} };
  }
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'distribution-worker-'));
  const dbPath = path.join(dir, 'test.db');
  const dataDir = path.join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const db = initDb(dbPath);
  const item = db.prepare(
    "INSERT INTO content_items (title, status, pillar) VALUES ('Item', 'scheduled', NULL)"
  ).run();
  const itemId = Number(item.lastInsertRowid);

  db.prepare(
    "INSERT INTO assets (content_item_id, platform, file_path, status) " +
    "VALUES (?, 'original', '/tmp/master.mp4', 'approved')"
  ).run(itemId);
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?)'
  ).run('distribution', JSON.stringify({
    accounts: [{ platform: 'tiktok', account: 'main', authorized: true }],
  }));

  return { db, itemId, dir, dbPath, dataDir };
}

function seedPost(db, itemId) {
  new DistributionEngine(db, {}).adapt({
    targetId: itemId,
    copy: { tiktok: { caption: 'Caption' } },
  });
  return db.prepare('SELECT * FROM posts WHERE content_item_id = ?').get(itemId);
}

test('worker lock: one holder, stale locks replaced', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'distribution-lock-'));
  const lockPath = path.join(dir, 'worker.lock');

  assert.equal(acquireLock(lockPath, { pid: 100, isAlive: () => true }).acquired, true);
  assert.equal(acquireLock(lockPath, { pid: 200, isAlive: () => true }).acquired, false);
  assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).pid, 100);

  releaseLock(lockPath, 200);
  assert.ok(existsSync(lockPath), 'another pid does not release the lock');
  releaseLock(lockPath, 100);
  assert.equal(existsSync(lockPath), false);

  writeFileSync(lockPath, JSON.stringify({ pid: 100, startedAt: 'x' }));
  const stale = acquireLock(lockPath, { pid: 200, isAlive: () => false });
  assert.equal(stale.acquired, true);
  assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).pid, 200);
  releaseLock(lockPath, 200);

  writeFileSync(lockPath, 'not-json');
  assert.equal(acquireLock(lockPath, { pid: 300, isAlive: () => true }).acquired, true);
  releaseLock(lockPath, 300);

  // A live PID with an old start time is treated as stale (PID reuse guard).
  writeFileSync(lockPath, JSON.stringify({
    pid: 400,
    startedAt: new Date(0).toISOString(),
  }));
  const replaced = acquireLock(lockPath, {
    pid: 401,
    isAlive: () => true,
    staleAfterMs: 1000,
    now: () => 10000,
  });
  assert.equal(replaced.acquired, true);
  releaseLock(lockPath, 401);
});

test('worker: publishes a due post, cleans media, and logs the pass', async () => {
  const { db, itemId } = setup();
  seedPost(db, itemId);
  const publisher = new FakePublisher();

  const result = await runWorker({
    db,
    publisher,
    schedule: false,
    publish: true,
    cleanup: true,
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.published.published, 1);
  assert.equal(result.published.failed, 0);
  assert.equal(result.cleanupRemoved, 2);
  assert.equal(publisher.cleanupCalls, 1);
  assert.equal(publisher.calls.length, 1);

  const post = db.prepare('SELECT * FROM posts WHERE content_item_id = ?').get(itemId);
  assert.equal(post.status, 'published');
  assert.equal(post.external_id, 'ext-1');
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'published'
  );

  const log = db.prepare(
    "SELECT status, message FROM engine_logs WHERE engine = 'distribution' AND action = 'worker'"
  ).get();
  assert.equal(log.status, 'success');
  assert.match(log.message, /"published":1/);

  db.close();
});

test('worker: adapts only with explicitly supplied copy', async () => {
  const { db, itemId } = setup();
  const publisher = new FakePublisher();

  const result = await runWorker({
    db,
    publisher,
    schedule: false,
    publish: false,
    cleanup: false,
    adaptCopy: { tiktok: { caption: 'Agent copy' } },
  });

  assert.equal(result.adapted.processed, 1);
  assert.equal(publisher.calls.length, 0);
  const post = db.prepare('SELECT * FROM posts WHERE content_item_id = ?').get(itemId);
  assert.equal(post.caption, 'Agent copy');
  assert.equal(post.status, 'scheduled');

  db.close();
});

test('worker: a partial platform failure is reported, not hidden', async () => {
  const { db, itemId } = setup();
  seedPost(db, itemId);
  db.prepare(
    "UPDATE assets SET status = 'review' WHERE content_item_id = ?"
  ).run(itemId);

  const publisher = new FakePublisher();
  const result = await runWorker({
    db,
    publisher,
    schedule: false,
    publish: true,
    cleanup: false,
  });

  assert.equal(result.published.failed, 1);
  assert.equal(result.published.published, 0);
  assert.equal(publisher.calls.length, 0);
  assert.equal(
    db.prepare('SELECT publish_error FROM posts WHERE content_item_id = ?').get(itemId).publish_error,
    'asset is not approved'
  );

  db.close();
});

test('worker: refuses to run without a publisher', async () => {
  const { db } = setup();
  await assert.rejects(runWorker({ db }), /requires \{ publisher \}/);
  db.close();
});

test('worker: dry-run changes no rows, logs, or media', async () => {
  const { db, itemId, dir } = setup();
  seedPost(db, itemId);

  const mediaDir = path.join(dir, 'media');
  mkdirSync(mediaDir, { recursive: true });
  const oldFile = path.join(mediaDir, 'old.mp4');
  writeFileSync(oldFile, 'old');
  const oldDate = new Date('2026-10-20T00:00:00.000Z');
  utimesSync(oldFile, oldDate, oldDate);

  const host = new NginxMediaHost({
    config: {
      publicBaseUrl: 'https://example.test/media',
      rootDir: mediaDir,
      keyPrefix: 'instagram',
      ttlHours: 1,
    },
    clock: () => new Date('2026-10-22T12:00:00.000Z'),
  });

  let publishCalls = 0;
  const publisher = {
    async publish() {
      publishCalls++;
      return { externalId: 'should-not-publish', url: null };
    },
    async cleanup() {
      return host.cleanup();
    },
  };

  const before = {
    posts: db.prepare('SELECT * FROM posts ORDER BY id').all(),
    calendar: db.prepare('SELECT * FROM calendar_entries ORDER BY id').all(),
    logs: db.prepare('SELECT COUNT(*) AS n FROM engine_logs').get().n,
  };

  const result = await runWorker({
    db,
    publisher,
    schedule: true,
    publish: true,
    cleanup: true,
    dryRun: true,
    adaptCopy: { tiktok: { caption: 'Dry run copy' } },
  });

  assert.equal(publishCalls, 0);
  assert.equal(result.cleanupRemoved, 0);
  assert.ok(existsSync(oldFile), 'dry-run must not delete expired media');
  assert.deepEqual(db.prepare('SELECT * FROM posts ORDER BY id').all(), before.posts);
  assert.deepEqual(db.prepare('SELECT * FROM calendar_entries ORDER BY id').all(), before.calendar);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM engine_logs').get().n, before.logs);
  db.close();
});

test('worker CLI: dry-run creates no lock file and no log row', () => {
  const { db, itemId, dbPath, dataDir, dir } = setup();
  seedPost(db, itemId);
  const beforeLogs = db.prepare('SELECT COUNT(*) AS n FROM engine_logs').get().n;
  db.close();

  const envFile = path.join(dir, '.env');
  writeFileSync(envFile, [
    'MEDIA_HOST_PROVIDER=nginx',
    'MEDIA_HOST_PUBLIC_BASE_URL=https://example.test/media',
    `MEDIA_HOST_ROOT_DIR=${path.join(dir, 'media')}`,
    'MEDIA_HOST_KEY_PREFIX=instagram',
    'MEDIA_HOST_TTL_HOURS=24',
    '',
  ].join('\n'), { mode: 0o600 });

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const run = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    path.join(repoRoot, 'scripts/distribution-worker.mjs'),
    '--dry-run', '--no-schedule', '--no-publish', '--no-cleanup', '--json',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CONTENTOS_DB: dbPath,
      CONTENT_OS_DATA_DIR: dataDir,
      CONTENT_OS_ENV_FILE: envFile,
    },
  });

  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.status, 'ok');
  assert.equal(existsSync(path.join(dataDir, 'tmp', 'distribution-worker.lock')), false);
  assert.equal(existsSync(path.join(dir, 'media')), false, 'dry-run must not create the media root');

  const raw = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 1);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM engine_logs').get().n, beforeLogs);
  raw.close();
});
