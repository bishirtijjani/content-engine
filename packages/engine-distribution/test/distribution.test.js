// Distribution Engine — phase 0 + 1.
//
// adapt: per-platform copy validation, one post per eligible account,
// idempotency, published posts preserved.
// publish: injected publisher, retries, duplicate protection, frozen clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDb } from '@content-os/core';
import { DistributionEngine } from '../src/index.js';
import { validateCopy } from '../src/platforms.mjs';
import { resolveAccounts } from '../src/accounts.mjs';

const NOW = '2026-10-21T12:00:00.000Z';
const clock = () => new Date(NOW);

const ACCOUNTS = {
  accounts: [
    { platform: 'tiktok', account: 'main', label: 'TikTok main' },
    { platform: 'tiktok', account: 'clips', label: 'TikTok clips' },
    { platform: 'instagram', account: 'creator', type: 'creator', label: 'Instagram creator' },
    { platform: 'youtube', account: 'main' },
  ],
};

const COPY = {
  'tiktok:main': { caption: 'Main TikTok caption', hashtags: ['#automation'] },
  tiktok: { caption: 'TikTok caption', hashtags: ['#automation'] },
  instagram: { caption: 'Instagram caption', hashtags: ['#software'] },
  youtube: { title: 'YouTube title', caption: 'YouTube description', hashtags: ['#build'] },
};

class FakePublisher {
  constructor({ failures = {} } = {}) {
    this.calls = [];
    this.failures = { ...failures };
  }

  async publish({ platform, account, post }) {
    const key = `${platform}:${account}`;
    this.calls.push({ key, postId: post.id, caption: post.caption });
    if (this.failures[key] > 0) {
      this.failures[key] -= 1;
      throw new Error(`temporary failure for ${key}`);
    }
    return {
      externalId: `${key}-${post.id}`,
      url: `https://example.test/${key}/${post.id}`,
    };
  }
}

function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'distribution-'));
  return initDb(path.join(dir, 'test.db'));
}

function seedItem(db, { title = 'Test item', pillar = 'workflow-automation', status = 'scheduled' } = {}) {
  const res = db.prepare(
    'INSERT INTO content_items (title, status, pillar) VALUES (?, ?, ?)'
  ).run(title, status, pillar);
  return Number(res.lastInsertRowid);
}

function seedAsset(db, itemId, status = 'approved') {
  const res = db.prepare(
    "INSERT INTO assets (content_item_id, platform, file_path, status) " +
    "VALUES (?, 'original', '/tmp/master.mp4', ?)"
  ).run(itemId, status);
  return Number(res.lastInsertRowid);
}

function setSetting(db, key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, JSON.stringify(value));
}

function setup({ accounts = ACCOUNTS, pillar = null, platforms = null } = {}) {
  const db = freshDb();
  const itemId = seedItem(db);
  const assetId = seedAsset(db, itemId);
  if (accounts) setSetting(db, 'distribution', accounts);
  if (pillar) setSetting(db, 'pillar_details', pillar);
  if (platforms) setSetting(db, 'platforms', platforms);
  return { db, itemId, assetId };
}

function postKeys(db, itemId) {
  return db.prepare(
    'SELECT platform, account FROM posts WHERE content_item_id = ? ORDER BY platform, account'
  ).all(itemId).map((p) => `${p.platform}:${p.account}`);
}

// ============================================================================
// COPY VALIDATION
// ============================================================================

test('validateCopy: enforces the platform limits', () => {
  assert.equal(validateCopy('x', { caption: 'a'.repeat(280) }).ok, true);
  assert.equal(validateCopy('x', { caption: 'a'.repeat(281) }).ok, false);

  assert.equal(validateCopy('youtube', { caption: 'description only' }).ok, false);
  assert.equal(validateCopy('youtube', { title: 't'.repeat(101), caption: 'd' }).ok, false);
  assert.equal(validateCopy('youtube', { title: 'Title', caption: 'Description' }).ok, true);

  const tooManyTags = Array.from({ length: 31 }, (_, i) => `#tag${i}`);
  assert.equal(validateCopy('instagram', { caption: 'c', hashtags: tooManyTags }).ok, false);
  assert.equal(validateCopy('tiktok', { caption: 'c', hashtags: ['no-hash'] }).ok, false);
});

test('validateCopy: rejects placeholders and template markers', () => {
  assert.equal(validateCopy('tiktok', { caption: 'TBD' }).ok, false);
  assert.equal(validateCopy('tiktok', { caption: 'Draft TODO caption' }).ok, false);
  assert.equal(validateCopy('tiktok', { caption: 'Hello {{name}}' }).ok, false);
  assert.equal(validateCopy('tiktok', { caption: 'Real caption' }).ok, true);
});

test('validateCopy: counts hashtags against the caption where the platform does', () => {
  const caption = 'a'.repeat(270);
  const tags = ['#one', '#two', '#three']; // 1 + 19 = 20 chars, 290 total
  assert.equal(validateCopy('x', { caption, hashtags: tags }).ok, false);

  const youtube = validateCopy('youtube', {
    title: 'Title',
    caption: 'a'.repeat(5000),
    hashtags: tags,
  });
  assert.equal(youtube.ok, true, 'YouTube hashtags live in the description, not the title');
});

// ============================================================================
// ADAPT — accounts and eligibility
// ============================================================================

test('adapt: one post per eligible platform/account', () => {
  const { db, itemId, assetId } = setup();
  const engine = new DistributionEngine(db, { clock });

  const result = engine.adapt({ targetId: itemId, copy: COPY });

  assert.equal(result.processed, 4);
  assert.equal(result.skipped, 0);
  assert.deepEqual(postKeys(db, itemId), [
    'instagram:creator',
    'tiktok:clips',
    'tiktok:main',
    'youtube:main',
  ]);

  const rows = db.prepare('SELECT * FROM posts WHERE content_item_id = ?').all(itemId);
  for (const row of rows) {
    assert.equal(row.status, 'scheduled');
    assert.equal(row.asset_id, assetId);
  }

  const main = db.prepare(
    "SELECT * FROM posts WHERE content_item_id = ? AND platform = 'tiktok' AND account = 'main'"
  ).get(itemId);
  assert.equal(main.caption, 'Main TikTok caption');

  const clips = db.prepare(
    "SELECT * FROM posts WHERE content_item_id = ? AND platform = 'tiktok' AND account = 'clips'"
  ).get(itemId);
  assert.equal(clips.caption, 'TikTok caption', 'platform copy is the fallback for the second account');

  db.close();
});

test('adapt: two TikTok accounts are authorized independently', () => {
  const { db, itemId } = setup({
    accounts: {
      accounts: [
        { platform: 'tiktok', account: 'main', authorized: true },
        { platform: 'tiktok', account: 'clips', authorized: false },
        { platform: 'instagram', account: 'creator', type: 'creator' },
      ],
    },
  });
  const engine = new DistributionEngine(db, { clock });

  const result = engine.adapt({ targetId: itemId, copy: COPY });

  assert.equal(result.processed, 2);
  assert.deepEqual(postKeys(db, itemId), ['instagram:creator', 'tiktok:main']);
  db.close();
});

test('adapt: supports an Instagram Creator account', () => {
  const { db, itemId } = setup({
    accounts: { accounts: [{ platform: 'instagram', account: 'creator', type: 'creator' }] },
  });
  const engine = new DistributionEngine(db, { clock });

  const result = engine.adapt({ targetId: itemId, copy: COPY });

  assert.equal(result.processed, 1);
  assert.deepEqual(postKeys(db, itemId), ['instagram:creator']);
  db.close();
});

test('adapt: falls back to settings.platforms with one default account each', () => {
  const { db, itemId } = setup({
    accounts: null,
    platforms: {
      tiktok: { cadence: '5x/week' },
      youtube: { cadence: '2x/week' },
    },
  });
  const engine = new DistributionEngine(db, { clock });

  const result = engine.adapt({ targetId: itemId, copy: COPY });

  assert.equal(result.processed, 2);
  assert.deepEqual(postKeys(db, itemId), ['tiktok:default', 'youtube:default']);
  db.close();
});

test('adapt: pillar platforms restrict eligibility', () => {
  const { db, itemId } = setup({
    pillar: { 'workflow-automation': { platforms: ['tiktok'] } },
  });
  const engine = new DistributionEngine(db, { clock });

  const result = engine.adapt({ targetId: itemId, copy: COPY });

  assert.equal(result.processed, 2);
  assert.deepEqual(postKeys(db, itemId), ['tiktok:clips', 'tiktok:main']);
  db.close();
});

test('adapt: explicit platforms override the pillar and account list', () => {
  const { db, itemId } = setup({
    pillar: { 'workflow-automation': { platforms: ['tiktok'] } },
  });
  const engine = new DistributionEngine(db, { clock });

  const result = engine.adapt({ targetId: itemId, copy: COPY, platforms: ['instagram'] });

  assert.equal(result.processed, 1);
  assert.deepEqual(postKeys(db, itemId), ['instagram:creator']);
  db.close();
});

test('adapt: rejects duplicate account identities in settings', () => {
  const { db, itemId } = setup({
    accounts: {
      accounts: [
        { platform: 'tiktok', account: 'main' },
        { platform: 'tiktok', account: 'MAIN' },
      ],
    },
  });
  const engine = new DistributionEngine(db, { clock });
  assert.throws(() => engine.adapt({ targetId: itemId, copy: COPY }), /duplicate distribution account/);
  db.close();
});

test('adapt: rejects an unknown Instagram account type', () => {
  const { db, itemId } = setup({
    accounts: { accounts: [{ platform: 'instagram', account: 'x', type: 'personal' }] },
  });
  const engine = new DistributionEngine(db, { clock });
  assert.throws(() => engine.adapt({ targetId: itemId, copy: COPY }), /invalid instagram account type/);
  db.close();
});

test('resolveAccounts: excludes disabled and unauthorized accounts', () => {
  const accounts = resolveAccounts({
    distribution: {
      accounts: [
        { platform: 'tiktok', account: 'a', enabled: false },
        { platform: 'tiktok', account: 'b', authorized: false },
        { platform: 'tiktok', account: 'c' },
      ],
    },
  });
  assert.deepEqual(accounts.map((a) => a.account), ['c']);
});

// ============================================================================
// ADAPT — invalid copy, assets, dry run
// ============================================================================

test('adapt: skips invalid copy per account and logs the reason', () => {
  const { db, itemId } = setup({
    accounts: {
      accounts: [
        { platform: 'tiktok', account: 'main' },
        { platform: 'youtube', account: 'main' },
        { platform: 'instagram', account: 'creator', type: 'creator' },
      ],
    },
  });
  const engine = new DistributionEngine(db, { clock });

  const result = engine.adapt({
    targetId: itemId,
    copy: {
      tiktok: { caption: 'Valid TikTok caption' },
      youtube: { caption: 'Missing the required title' },
      instagram: {
        caption: 'Too many tags',
        hashtags: Array.from({ length: 31 }, (_, i) => `#tag${i}`),
      },
    },
  });

  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 2);
  assert.deepEqual(postKeys(db, itemId), ['tiktok:main']);

  const log = db.prepare(
    "SELECT message FROM engine_logs WHERE engine = 'distribution' AND action = 'adapt' " +
    "AND status = 'skipped' ORDER BY id"
  ).all().map((r) => r.message);
  assert.ok(log.some((m) => /youtube:main copy rejected — title is required/.test(m)));
  assert.ok(log.some((m) => /instagram:creator copy rejected — 31 hashtags/.test(m)));
  db.close();
});

test('adapt: skips an item with no approved asset', () => {
  const { db, itemId } = setup();
  db.prepare("UPDATE assets SET status = 'review' WHERE content_item_id = ?").run(itemId);
  const engine = new DistributionEngine(db, { clock });

  const result = engine.adapt({ targetId: itemId, copy: COPY });

  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 0);
  db.close();
});

test('adapt: dry run validates but writes nothing', () => {
  const { db, itemId } = setup();
  const engine = new DistributionEngine(db, { clock });

  const result = engine.adapt({ targetId: itemId, copy: COPY, dryRun: true });

  assert.equal(result.processed, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 0);
  db.close();
});

// ============================================================================
// ADAPT — idempotency and published preservation
// ============================================================================

test('adapt: re-running updates the same rows, never duplicates', () => {
  const { db, itemId } = setup();
  const engine = new DistributionEngine(db, { clock });

  engine.adapt({ targetId: itemId, copy: COPY });
  const before = db.prepare('SELECT id, platform, account FROM posts ORDER BY id').all();

  const second = engine.adapt({
    targetId: itemId,
    copy: { ...COPY, tiktok: { caption: 'Updated TikTok caption' } },
  });

  assert.equal(second.processed, 4);
  assert.deepEqual(
    db.prepare('SELECT id, platform, account FROM posts ORDER BY id').all(),
    before
  );
  assert.equal(
    db.prepare("SELECT caption FROM posts WHERE platform = 'tiktok' AND account = 'clips'").get().caption,
    'Updated TikTok caption'
  );
  db.close();
});

test('adapt: never modifies a published post', () => {
  const { db, itemId } = setup();
  const engine = new DistributionEngine(db, { clock });
  engine.adapt({ targetId: itemId, copy: COPY });

  db.prepare(
    "UPDATE posts SET status = 'published', external_id = 'ext-1', caption = 'Original caption', " +
    "published_at = ? WHERE platform = 'tiktok' AND account = 'main'"
  ).run(NOW);

  const result = engine.adapt({
    targetId: itemId,
    copy: {
      ...COPY,
      'tiktok:main': { caption: 'Replacement caption' },
    },
  });

  assert.equal(result.preserved, 1);
  assert.equal(result.processed, 3);

  const row = db.prepare(
    "SELECT * FROM posts WHERE platform = 'tiktok' AND account = 'main'"
  ).get();
  assert.equal(row.status, 'published');
  assert.equal(row.caption, 'Original caption');
  assert.equal(row.external_id, 'ext-1');
  db.close();
});

test('adapt: adds a missing platform to an already-published item without touching the published post', () => {
  const { db, itemId } = setup();
  const engine = new DistributionEngine(db, { clock });
  engine.adapt({ targetId: itemId, copy: COPY });

  const published = db.prepare(
    "SELECT * FROM posts WHERE platform = 'tiktok' AND account = 'main'"
  ).get();
  db.prepare("UPDATE posts SET status = 'published', external_id = 'ext-1' WHERE id = ?").run(published.id);
  db.prepare("DELETE FROM posts WHERE platform = 'tiktok' AND account = 'clips'").run();

  const result = engine.adapt({
    targetId: itemId,
    copy: {
      ...COPY,
      'tiktok:main': { caption: 'Replacement caption' },
    },
  });

  assert.equal(result.preserved, 1);
  assert.equal(result.processed, 3);

  const preserved = db.prepare(
    "SELECT * FROM posts WHERE platform = 'tiktok' AND account = 'main'"
  ).get();
  assert.equal(preserved.status, 'published');
  assert.equal(preserved.caption, 'Main TikTok caption');
  assert.equal(preserved.external_id, 'ext-1');

  const created = db.prepare(
    "SELECT * FROM posts WHERE platform = 'tiktok' AND account = 'clips'"
  ).get();
  assert.ok(created);
  assert.equal(created.status, 'scheduled');
  assert.equal(created.caption, 'TikTok caption');
  db.close();
});

test('adapt: repeated adapt on a published item does not duplicate posts', () => {
  const { db, itemId } = setup();
  const engine = new DistributionEngine(db, { clock });
  engine.adapt({ targetId: itemId, copy: COPY });

  db.prepare(
    "UPDATE posts SET status = 'published', external_id = 'ext-1' WHERE platform = 'tiktok' AND account = 'main'"
  ).run();

  const first = engine.adapt({ targetId: itemId, copy: COPY });
  const second = engine.adapt({ targetId: itemId, copy: COPY });

  assert.equal(first.preserved, 1);
  assert.equal(second.preserved, 1);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM posts WHERE content_item_id = ?').get(itemId).n,
    4
  );
  db.close();
});

test('publish: a late platform failure preserves an already-published first platform and retries only the failed post', async () => {
  const { db, itemId } = setup();
  const failing = new FakePublisher({ failures: { 'tiktok:clips': 999 } });
  const engine = new DistributionEngine(db, { publisher: failing, clock, maxAttempts: 1 });
  engine.adapt({ targetId: itemId, copy: COPY });

  const clipsId = db.prepare(
    "SELECT id FROM posts WHERE platform = 'tiktok' AND account = 'clips'"
  ).get().id;
  db.prepare(
    "UPDATE posts SET status = 'published', external_id = 'ext-1' WHERE platform = 'tiktok' AND account = 'main'"
  ).run();
  db.prepare("UPDATE content_items SET status = 'published' WHERE id = ?").run(itemId);

  const first = await engine.publish({ postId: clipsId, maxAttempts: 1 });
  assert.equal(first.failed, 1);
  assert.equal(first.published, 0);
  assert.equal(
    db.prepare("SELECT status FROM posts WHERE platform = 'tiktok' AND account = 'main'").get().status,
    'published'
  );
  assert.equal(
    db.prepare("SELECT status FROM posts WHERE platform = 'tiktok' AND account = 'clips'").get().status,
    'failed'
  );
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'published'
  );

  const healthy = new FakePublisher();
  const retry = new DistributionEngine(db, { publisher: healthy, clock });
  const second = await retry.publish({ postId: clipsId });

  assert.equal(second.published, 1);
  assert.equal(healthy.calls.length, 1);
  assert.equal(healthy.calls[0].key, 'tiktok:clips');
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'published'
  );
  db.close();
});

test('crossPost: uses the same idempotent fan-out as adapt', () => {
  const { db, itemId } = setup();
  const engine = new DistributionEngine(db, { clock });

  engine.adapt({ targetId: itemId, copy: COPY });
  const result = engine.crossPost({ targetId: itemId, copy: COPY });

  assert.equal(result.processed, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 4);
  db.close();
});

// ============================================================================
// PUBLISH
// ============================================================================

test('publish: publishes scheduled posts and stamps the frozen clock', async () => {
  const { db, itemId } = setup();
  const publisher = new FakePublisher();
  const engine = new DistributionEngine(db, { publisher, clock });
  engine.adapt({ targetId: itemId, copy: COPY });

  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.published, 4);
  assert.equal(result.failed, 0);
  assert.equal(publisher.calls.length, 4);

  const rows = db.prepare('SELECT * FROM posts WHERE content_item_id = ?').all(itemId);
  for (const row of rows) {
    assert.equal(row.status, 'published');
    assert.equal(row.published_at, NOW);
    assert.match(row.external_id, /^(tiktok|instagram|youtube):/);
    assert.match(row.url, /^https:\/\/example\.test\//);
    assert.equal(row.publish_error, null);
  }
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'published'
  );
  db.close();
});

test('publish: a second run never calls the publisher again', async () => {
  const { db, itemId } = setup();
  const publisher = new FakePublisher();
  const engine = new DistributionEngine(db, { publisher, clock });
  engine.adapt({ targetId: itemId, copy: COPY });

  await engine.publish({ targetId: itemId });
  const calls = publisher.calls.length;
  const second = await engine.publish({ targetId: itemId });

  assert.equal(second.processed, 0);
  assert.equal(publisher.calls.length, calls);
  db.close();
});

test('publish: a post with an external id is reconciled, not sent again', async () => {
  const { db, itemId } = setup();
  const publisher = new FakePublisher();
  const engine = new DistributionEngine(db, { publisher, clock });
  engine.adapt({ targetId: itemId, copy: COPY });

  db.prepare(
    "UPDATE posts SET external_id = 'already-on-platform' " +
    "WHERE platform = 'tiktok' AND account = 'main'"
  ).run();

  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.published, 3);
  assert.equal(publisher.calls.length, 3, 'the reconciled post is not sent');
  assert.ok(!publisher.calls.some((c) => c.key === 'tiktok:main'));

  const row = db.prepare(
    "SELECT * FROM posts WHERE platform = 'tiktok' AND account = 'main'"
  ).get();
  assert.equal(row.status, 'published');
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'published'").get().n,
    4
  );
  db.close();
});

test('publish: retries a transient failure and succeeds', async () => {
  const { db, itemId } = setup();
  const publisher = new FakePublisher({ failures: { 'tiktok:clips': 2 } });
  const engine = new DistributionEngine(db, { publisher, clock, maxAttempts: 3 });
  engine.adapt({ targetId: itemId, copy: COPY });

  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.published, 4);
  assert.equal(
    publisher.calls.filter((c) => c.key === 'tiktok:clips').length,
    3
  );
  db.close();
});

test('publish: an exhausted post fails and keeps the item retryable', async () => {
  const { db, itemId } = setup();
  const failing = new FakePublisher({ failures: { 'instagram:creator': 999 } });
  const engine = new DistributionEngine(db, { publisher: failing, clock, maxAttempts: 2 });
  engine.adapt({ targetId: itemId, copy: COPY });

  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.published, 3);
  assert.equal(result.failed, 1);
  assert.equal(failing.calls.filter((c) => c.key === 'instagram:creator').length, 2);

  const failed = db.prepare(
    "SELECT * FROM posts WHERE platform = 'instagram' AND account = 'creator'"
  ).get();
  assert.equal(failed.status, 'failed');
  assert.match(failed.publish_error, /temporary failure for instagram:creator/);
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'scheduled',
    'one retryable post keeps the item in scheduled'
  );

  const healthy = new FakePublisher();
  const retry = new DistributionEngine(db, { publisher: healthy, clock });
  const second = await retry.publish({ targetId: itemId });

  assert.equal(second.published, 1);
  assert.equal(healthy.calls.length, 1, 'only the failed post is retried');
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'published'
  );
  db.close();
});

test('publish: skips and failed posts do not block the item', async () => {
  const { db, itemId } = setup();
  const publisher = new FakePublisher();
  const engine = new DistributionEngine(db, { publisher, clock });
  engine.adapt({ targetId: itemId, copy: COPY });

  db.prepare(
    "UPDATE posts SET status = 'skipped' WHERE platform = 'youtube'"
  ).run();

  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.published, 3);
  assert.equal(publisher.calls.length, 3);
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'published'
  );
  db.close();
});

test('publish: refuses an asset that is no longer approved', async () => {
  const { db, itemId } = setup();
  const publisher = new FakePublisher();
  const engine = new DistributionEngine(db, { publisher, clock });
  engine.adapt({ targetId: itemId, copy: COPY });

  db.prepare("UPDATE assets SET status = 'review' WHERE content_item_id = ?").run(itemId);

  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.failed, 4);
  assert.equal(publisher.calls.length, 0);
  const posts = db.prepare('SELECT publish_error FROM posts WHERE content_item_id = ?').all(itemId);
  assert.ok(posts.every((post) => post.publish_error === 'asset is not approved'));
  db.close();
});

test('publish: records publisher warnings without failing the post', async () => {
  const { db, itemId } = setup();
  const engine = new DistributionEngine(db, { clock });
  engine.adapt({ targetId: itemId, copy: COPY });
  engine.publisher = {
    async publish() {
      return {
        externalId: 'warn-1',
        url: 'https://example.test/warn-1',
        warnings: ['config_issue=CAPTION_NOT_ATTACHED'],
      };
    },
  };

  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.published, 4);
  const posts = db.prepare('SELECT status, publish_error FROM posts WHERE content_item_id = ?').all(itemId);
  assert.ok(posts.every((post) => post.status === 'published' && post.publish_error === null));
  const warnings = db.prepare(
    "SELECT message FROM engine_logs WHERE action = 'publish' AND message LIKE '%warnings:%'"
  ).all();
  assert.ok(warnings.length >= 1);
  assert.match(warnings[0].message, /CAPTION_NOT_ATTACHED/);
  db.close();
});

test('publish: one account failure preserves the others and retries only the failure', async () => {
  const { db, itemId } = setup();
  const failing = new FakePublisher({ failures: { 'tiktok:clips': 999 } });
  const first = new DistributionEngine(db, { publisher: failing, clock, maxAttempts: 1 });
  first.adapt({ targetId: itemId, copy: COPY });

  const firstRun = await first.publish({ targetId: itemId });

  assert.equal(firstRun.published, 3);
  assert.equal(firstRun.failed, 1);
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'scheduled'
  );
  const published = db.prepare(
    "SELECT platform, account FROM posts WHERE status = 'published' ORDER BY platform, account"
  ).all().map((post) => `${post.platform}:${post.account}`);
  assert.deepEqual(published, ['instagram:creator', 'tiktok:main', 'youtube:main']);

  const healthy = new FakePublisher();
  const retry = new DistributionEngine(db, { publisher: healthy, clock });
  const secondRun = await retry.publish({ targetId: itemId });

  assert.equal(secondRun.published, 1);
  assert.equal(healthy.calls.length, 1);
  assert.equal(healthy.calls[0].key, 'tiktok:clips');
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'published'
  );
  db.close();
});

test('publish: reconciles a scheduled item whose posts were all published before settlement', async () => {
  const { db, itemId } = setup();
  const engine = new DistributionEngine(db, {
    clock,
    publisher: {
      async publish() {
        throw new Error('publisher must not be called for reconciliation');
      },
    },
  });
  engine.adapt({ targetId: itemId, copy: COPY });

  const posts = db.prepare(
    'SELECT id FROM posts WHERE content_item_id = ? ORDER BY id'
  ).all(itemId);
  for (const post of posts) {
    db.prepare(
      "UPDATE posts SET status = 'published', external_id = ?, published_at = ?, " +
      "updated_at = datetime('now') WHERE id = ?"
    ).run(`crash-${post.id}`, NOW, post.id);
  }

  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'scheduled'
  );

  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.processed, 0);
  assert.equal(result.published, 0);
  assert.equal(result.failed, 0);
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'published'
  );
  db.close();
});

test('publish: an inbox upload is recorded as a draft and is not retried', async () => {
  const { db, itemId } = setup();
  let calls = 0;
  const publisher = {
    async publish() {
      calls++;
      return {
        externalId: 'draft-1',
        draft: true,
        manualCompletionRequired: true,
        url: null,
        warnings: ['draft-only'],
      };
    },
  };
  const engine = new DistributionEngine(db, { publisher, clock });
  engine.adapt({ targetId: itemId, copy: COPY });

  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.published, 0);
  assert.equal(result.drafts, 4);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);
  assert.equal(calls, 4);

  const posts = db.prepare(
    'SELECT status, external_id, publish_state FROM posts WHERE content_item_id = ? ORDER BY platform, account'
  ).all(itemId);
  assert.ok(posts.every((post) => post.status === 'draft' && post.external_id === null));
  assert.ok(posts.every((post) => JSON.parse(post.publish_state).stage === 'inbox_uploaded'));

  const second = await engine.publish({ targetId: itemId });
  assert.equal(second.drafts, 0);
  assert.equal(second.published, 0);
  assert.equal(calls, 4);
  db.close();
});

test('publish: a draft upload failure preserves state and retries only the failed post', async () => {
  const { db, itemId } = setup();
  let calls = 0;
  const failing = {
    async publish({ state, updateState }) {
      calls++;
      if (!state?.publishId) {
        updateState({ stage: 'initiating', initRequestedAt: '2026-10-21T12:00:00.000Z', mode: 'inbox' });
        updateState({
          stage: 'uploading',
          publishId: 'draft-1',
          uploadUrl: 'https://upload.test/video',
          videoSize: 1024,
          chunkSize: 1024,
          totalChunks: 1,
          uploadedBytes: 0,
          mode: 'inbox',
        });
        throw new Error('upload failed');
      }
      return {
        externalId: 'draft-1',
        draft: true,
        manualCompletionRequired: true,
        url: null,
      };
    },
  };
  const engine = new DistributionEngine(db, { publisher: failing, clock, maxAttempts: 1 });
  engine.adapt({ targetId: itemId, copy: COPY });

  const first = await engine.publish({ targetId: itemId, maxAttempts: 1 });
  assert.equal(first.failed, 4);
  assert.equal(first.drafts, 0);
  assert.equal(calls, 4);

  const failed = db.prepare(
    "SELECT status, publish_state FROM posts WHERE content_item_id = ? AND platform = 'tiktok' AND account = 'clips'"
  ).get(itemId);
  assert.equal(failed.status, 'failed');
  assert.equal(JSON.parse(failed.publish_state).stage, 'uploading');

  const healthy = {
    async publish({ state }) {
      calls++;
      assert.equal(state?.stage, 'uploading');
      assert.equal(state?.publishId, 'draft-1');
      return {
        externalId: 'draft-1',
        draft: true,
        manualCompletionRequired: true,
        url: null,
      };
    },
  };
  const retry = new DistributionEngine(db, { publisher: healthy, clock });
  const second = await retry.publish({ targetId: itemId });

  assert.equal(second.drafts, 4);
  assert.equal(second.failed, 0);
  assert.equal(calls, 8);
  assert.equal(healthy.calls?.length ?? 0, 0);
  const drafted = db.prepare(
    "SELECT status, external_id, publish_state FROM posts WHERE content_item_id = ? AND platform = 'tiktok' AND account = 'clips'"
  ).get(itemId);
  assert.equal(drafted.status, 'draft');
  assert.equal(drafted.external_id, null);
  assert.equal(JSON.parse(drafted.publish_state).stage, 'inbox_uploaded');
  db.close();
});

test('publish: a draft keeps a scheduled item from settling to published', async () => {
  const { db, itemId } = setup();
  const engine = new DistributionEngine(db, {
    clock,
    publisher: {
      async publish() {
        throw new Error('publisher must not be called for reconciliation');
      },
    },
  });
  engine.adapt({ targetId: itemId, copy: COPY });

  const posts = db.prepare('SELECT id FROM posts WHERE content_item_id = ? ORDER BY id').all(itemId);
  for (const post of posts) {
    db.prepare(
      "UPDATE posts SET status = 'published', external_id = ?, published_at = ?, " +
      "updated_at = datetime('now') WHERE id = ?"
    ).run(`ext-${post.id}`, NOW, post.id);
  }
  const draftPost = posts[0].id;
  db.prepare("UPDATE posts SET status = 'draft', external_id = NULL, publish_state = ? WHERE id = ?").run(
    JSON.stringify({ stage: 'inbox_uploaded', publishId: 'draft-1' }),
    draftPost
  );
  db.prepare("UPDATE content_items SET status = 'scheduled' WHERE id = ?").run(itemId);

  const result = await engine.publish({ targetId: itemId });

  assert.equal(result.processed, 0);
  assert.equal(result.published, 0);
  assert.equal(result.drafts, 0);
  assert.equal(result.failed, 0);
  assert.equal(
    db.prepare('SELECT status FROM content_items WHERE id = ?').get(itemId).status,
    'scheduled'
  );
  db.close();
});

test('publish: refuses without a publisher', async () => {
  const { db } = setup();
  const engine = new DistributionEngine(db, { clock });
  await assert.rejects(engine.publish(), /needs a publisher/);
  db.close();
});

test('publish: dry run makes no calls and changes no state', async () => {
  const { db, itemId } = setup();
  const publisher = new FakePublisher();
  const engine = new DistributionEngine(db, { publisher, clock });
  engine.adapt({ targetId: itemId, copy: COPY });

  const result = await engine.publish({ targetId: itemId, dryRun: true });

  assert.equal(result.processed, 4);
  assert.equal(publisher.calls.length, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'scheduled'").get().n,
    4
  );
  db.close();
});

test('publish: postId publishes that post before its slot', async () => {
  const { db, itemId } = setup();
  const publisher = new FakePublisher();
  const engine = new DistributionEngine(db, { publisher, clock });
  engine.adapt({ targetId: itemId, copy: COPY });

  const target = db.prepare(
    "SELECT id FROM posts WHERE platform = 'tiktok' AND account = 'main'"
  ).get();
  db.prepare(
    "UPDATE posts SET scheduled_at = '2099-01-01T00:00:00.000Z' WHERE id = ?"
  ).run(target.id);

  const result = await engine.publish({ postId: target.id });

  assert.equal(result.published, 1);
  assert.equal(publisher.calls.length, 1);
  assert.equal(
    db.prepare('SELECT status FROM posts WHERE id = ?').get(target.id).status,
    'published'
  );
  db.close();
});

// ============================================================================
// RUN
// ============================================================================

test('run: dispatches adapt and rejects unknown actions', () => {
  const { db, itemId } = setup();
  const engine = new DistributionEngine(db, { clock });

  const result = engine.run({ action: 'adapt', targetId: itemId, copy: COPY });
  assert.equal(result.processed, 4);

  const scheduled = engine.run({ action: 'schedule', targetId: itemId });
  assert.equal(scheduled.processed, 1);

  assert.throws(() => engine.run({ action: 'bogus' }), /unknown distribution action/);
  db.close();
});
