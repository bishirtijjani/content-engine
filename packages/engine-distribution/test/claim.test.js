// Atomic publish lease: one publisher per post, crash-safe expiry, safe retry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb } from '@content-os/core';
import { DistributionEngine } from '../src/index.js';

const NOW = '2026-10-22T12:00:00.000Z';
const clock = () => new Date(NOW);

function setup(accounts = [{ platform: 'tiktok', account: 'main', authorized: true }]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'distribution-claim-'));
  const db = initDb(path.join(dir, 'test.db'));
  const item = db.prepare(
    "INSERT INTO content_items (title, status, pillar) VALUES ('Item', 'scheduled', NULL)"
  ).run();
  const itemId = Number(item.lastInsertRowid);
  db.prepare(
    "INSERT INTO assets (content_item_id, platform, file_path, status) " +
    "VALUES (?, 'original', '/tmp/master.mp4', 'approved')"
  ).run(itemId);
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    'distribution',
    JSON.stringify({ accounts })
  );

  new DistributionEngine(db, {}).adapt({
    targetId: itemId,
    copy: { tiktok: { caption: 'Caption' } },
  });

  return { db, itemId };
}

function postRow(db, itemId) {
  return db.prepare('SELECT * FROM posts WHERE content_item_id = ?').get(itemId);
}

function setClaim(db, itemId, claimId, expiresAt) {
  db.prepare(
    'UPDATE posts SET publish_claim_id = ?, publish_claim_expires_at = ? WHERE content_item_id = ?'
  ).run(claimId, expiresAt, itemId);
}

test('claim: concurrent engines publish a post exactly once', async () => {
  const { db, itemId } = setup();
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });

  const makePublisher = (name) => ({
    async publish({ post }) {
      calls.push({ name, postId: post.id });
      await gate;
      return { externalId: `${name}-1`, url: null };
    },
  });

  const first = new DistributionEngine(db, { publisher: makePublisher('first'), clock });
  const second = new DistributionEngine(db, { publisher: makePublisher('second'), clock });

  const p1 = first.publish({ targetId: itemId });
  const p2 = second.publish({ targetId: itemId });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1, 'only one engine reaches the publisher');
  release();
  const [r1, r2] = await Promise.all([p1, p2]);

  assert.equal(calls.length, 1);
  assert.equal(r1.published + r2.published, 1);
  assert.equal(r1.skipped + r2.skipped, 1);
  const row = postRow(db, itemId);
  assert.equal(row.status, 'published');
  assert.equal(row.publish_claim_id, null);
  db.close();
});

test('claim: stale due-list cannot republish a post another engine already published', async () => {
  const { db, itemId } = setup([
    { platform: 'tiktok', account: 'main', authorized: true },
    { platform: 'tiktok', account: 'clips', authorized: true },
  ]);
  const posts = db.prepare(
    'SELECT id, account FROM posts WHERE content_item_id = ? ORDER BY id'
  ).all(itemId);
  const firstId = posts[0].id;
  const secondId = posts[1].id;

  const calls = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const slowPublisher = {
    async publish({ post, state }) {
      calls.push({ engine: 'slow', postId: post.id, state });
      if (post.id === firstId) await firstGate;
      return { externalId: `slow-${post.id}`, url: null };
    },
  };
  const fastPublisher = {
    async publish({ post, state }) {
      calls.push({ engine: 'fast', postId: post.id, state });
      return { externalId: `fast-${post.id}`, url: null };
    },
  };

  const slow = new DistributionEngine(db, { publisher: slowPublisher, clock });
  const fast = new DistributionEngine(db, { publisher: fastPublisher, clock });

  const slowRun = slow.publish({ targetId: itemId });
  await new Promise((resolve) => setImmediate(resolve));
  const fastResult = await fast.publish({ targetId: itemId });
  releaseFirst();
  const slowResult = await slowRun;

  assert.equal(calls.filter((call) => call.postId === secondId).length, 1);
  assert.equal(fastResult.posts.find((p) => p.id === secondId).status, 'published');
  assert.equal(slowResult.posts.find((p) => p.id === secondId).status, 'skipped');

  const row = db.prepare('SELECT status, external_id FROM posts WHERE id = ?').get(secondId);
  assert.equal(row.status, 'published');
  assert.equal(row.external_id, `fast-${secondId}`);
  db.close();
});

test('claim: refuses a scheduled post that already has an external id', () => {
  const { db, itemId } = setup();
  db.prepare(
    "UPDATE posts SET external_id = 'already-there' WHERE content_item_id = ?"
  ).run(itemId);
  const engine = new DistributionEngine(db, { clock });
  const row = postRow(db, itemId);

  assert.equal(engine._claimPost(row.id, NOW), null);
  assert.equal(postRow(db, itemId).publish_claim_id, null);
  assert.equal(postRow(db, itemId).external_id, 'already-there');
  db.close();
});

test('claim: an expired lease is reclaimable after a crash', async () => {
  const { db, itemId } = setup();
  setClaim(db, itemId, 'dead-worker', '2026-10-22T11:00:00.000Z');

  const calls = [];
  const publisher = {
    async publish({ post }) {
      calls.push(post.id);
      return { externalId: 'after-crash', url: null };
    },
  };

  const engine = new DistributionEngine(db, { publisher, clock });
  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.published, 1);
  assert.equal(calls.length, 1);
  assert.equal(postRow(db, itemId).status, 'published');
  db.close();
});

test('claim: a live lease blocks a concurrent publisher until it is released', async () => {
  const { db, itemId } = setup();
  setClaim(db, itemId, 'live-worker', '2026-10-22T13:00:00.000Z');

  let calls = 0;
  const publisher = {
    async publish() {
      calls++;
      return { externalId: 'later', url: null };
    },
  };

  const engine = new DistributionEngine(db, { publisher, clock });
  const first = await engine.publish({ targetId: itemId });

  assert.equal(first.skipped, 1);
  assert.equal(calls, 0);
  assert.equal(postRow(db, itemId).status, 'scheduled');

  db.prepare(
    'UPDATE posts SET publish_claim_id = NULL, publish_claim_expires_at = NULL WHERE content_item_id = ?'
  ).run(itemId);

  const second = await engine.publish({ targetId: itemId });
  assert.equal(second.published, 1);
  assert.equal(calls, 1);
  db.close();
});

test('claim: a failed attempt releases the lease for a safe retry', async () => {
  const { db, itemId } = setup();
  let calls = 0;
  const failing = {
    async publish() {
      calls++;
      throw new Error('transport failed');
    },
  };

  const engine = new DistributionEngine(db, { publisher: failing, clock, maxAttempts: 1 });
  const first = await engine.publish({ targetId: itemId });

  assert.equal(first.failed, 1);
  assert.equal(postRow(db, itemId).publish_claim_id, null);

  const healthy = {
    async publish() {
      calls++;
      return { externalId: 'retry-ok', url: null };
    },
  };
  const retry = new DistributionEngine(db, { publisher: healthy, clock, maxAttempts: 1 });
  const second = await retry.publish({ targetId: itemId });

  assert.equal(second.published, 1);
  assert.equal(calls, 2);
  assert.equal(postRow(db, itemId).status, 'published');
  db.close();
});
