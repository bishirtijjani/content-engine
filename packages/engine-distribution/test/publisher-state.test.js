// The engine must persist provider state across failures and restarts and
// clear it only when the platform confirms a publish.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb } from '@content-os/core';
import { DistributionEngine } from '../src/index.js';

const NOW = '2026-10-22T12:00:00.000Z';
const clock = () => new Date(NOW);

class StatefulPublisher {
  constructor() {
    this.calls = [];
  }

  async publish({ state, updateState }) {
    this.calls.push(state ? { ...state } : null);

    if (!state?.containerId) {
      updateState({ containerId: 'container-1', stage: 'created' });
      const err = new Error('connection dropped');
      err.retryable = true;
      throw err;
    }

    updateState({ stage: 'published', mediaId: 'media-1' });
    return { externalId: 'media-1', url: 'https://www.instagram.com/reel/abc/' };
  }
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'publisher-state-'));
  const db = initDb(path.join(dir, 'test.db'));
  const item = db.prepare(
    "INSERT INTO content_items (title, status, pillar) VALUES ('Item', 'scheduled', 'workflow-automation')"
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

  const engine = new DistributionEngine(db, { clock });
  engine.adapt({
    targetId: itemId,
    copy: { tiktok: { caption: 'Caption' } },
  });

  return { db, itemId, engine };
}

function postRow(db, itemId) {
  return db.prepare('SELECT * FROM posts WHERE content_item_id = ? ORDER BY id').get(itemId);
}

test('publish state survives a failed attempt and resumes on the next run', async () => {
  const { db, itemId, engine } = setup();
  const publisher = new StatefulPublisher();
  engine.publisher = publisher;

  const first = await engine.publish({ targetId: itemId, maxAttempts: 1 });
  assert.equal(first.failed, 1);

  let row = postRow(db, itemId);
  assert.equal(row.status, 'failed');
  assert.equal(row.publish_claim_id, null, 'the failed attempt releases its claim');
  const stored = JSON.parse(row.publish_state);
  assert.equal(stored.containerId, 'container-1');
  assert.equal(stored.stage, 'created');

  const second = await engine.publish({ targetId: itemId, maxAttempts: 1 });
  assert.equal(second.published, 1);
  assert.equal(publisher.calls.length, 2);
  assert.equal(publisher.calls[1].containerId, 'container-1',
    'the second attempt receives the persisted container');

  row = postRow(db, itemId);
  assert.equal(row.status, 'published');
  assert.equal(row.external_id, 'media-1');
  assert.equal(row.publish_state, null);
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'published'
  );

  db.close();
});

test('adapt refuses to erase state during an in-flight publish', async () => {
  const { db, itemId, engine } = setup();
  engine.publisher = new StatefulPublisher();

  await engine.publish({ targetId: itemId, maxAttempts: 1 });
  const before = postRow(db, itemId);
  assert.ok(before.publish_state);

  const result = engine.adapt({
    targetId: itemId,
    copy: { tiktok: { caption: 'Rewritten caption' } },
  });

  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  const row = postRow(db, itemId);
  assert.equal(row.status, 'failed');
  assert.equal(row.caption, 'Caption', 'copy is not changed under an in-flight container');
  assert.equal(JSON.parse(row.publish_state).containerId, 'container-1');

  db.close();
});

test('adapt refuses to change copy while a live publish claim exists', () => {
  const { db, itemId, engine } = setup();
  const post = postRow(db, itemId);
  db.prepare(
    'UPDATE posts SET publish_claim_id = ?, publish_claim_expires_at = ? WHERE id = ?'
  ).run('live-claim', '2026-10-22T13:00:00.000Z', post.id);

  const result = engine.adapt({
    targetId: itemId,
    copy: { tiktok: { caption: 'Rewritten under a live claim' } },
  });

  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  const row = postRow(db, itemId);
  assert.equal(row.caption, 'Caption');
  assert.equal(row.publish_claim_id, 'live-claim');
  db.close();
});

test('resetPublishState requires confirmation and clears only unpublished work', async () => {
  const { db, itemId, engine } = setup();
  engine.publisher = new StatefulPublisher();

  await engine.publish({ targetId: itemId, maxAttempts: 1 });
  const postId = postRow(db, itemId).id;

  assert.throws(() => engine.resetPublishState({ postId }), /confirm/);
  assert.ok(postRow(db, itemId).publish_state);

  db.prepare(
    'UPDATE posts SET publish_claim_id = ?, publish_claim_expires_at = ? WHERE id = ?'
  ).run('stale-claim', '2026-10-22T13:00:00.000Z', postId);

  const result = engine.resetPublishState({ postId, confirm: true });
  assert.equal(result.reset, true);
  const row = postRow(db, itemId);
  assert.equal(row.publish_state, null);
  assert.equal(row.publish_claim_id, null);
  assert.equal(row.publish_claim_expires_at, null);
  assert.equal(row.status, 'scheduled');
  assert.equal(row.publish_error, null);

  db.close();
});

test('a post with an external id is reconciled and its state cleared', async () => {
  const { db, itemId, engine } = setup();
  const publisher = new StatefulPublisher();
  engine.publisher = publisher;

  db.prepare(
    "UPDATE posts SET external_id = 'already-posted', " +
    "publish_state = '{\"containerId\":\"container-1\"}' WHERE content_item_id = ?"
  ).run(itemId);

  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.processed, 0);
  assert.equal(publisher.calls.length, 0);
  const row = postRow(db, itemId);
  assert.equal(row.status, 'published');
  assert.equal(row.external_id, 'already-posted');
  assert.equal(row.publish_state, null);

  db.close();
});
