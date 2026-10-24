// Database startup and migrations.
//
// connect() is the path every engine and script uses, so it must bring the
// schema to the current version exactly once and refuse unsafe upgrades.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { connect, initDb, schemaVersion, SCHEMA_VERSION } from '../src/index.js';

const SCHEMA = readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');

function tempFile(name = 'test.db') {
  return path.join(mkdtempSync(path.join(tmpdir(), 'content-migrate-')), name);
}

/** A v4 database: the current schema minus posts.account. */
function makeV4(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA.replace(/^  account .*$/m, ''));
  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '4')"
  ).run();
  return db;
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some((entry) => entry.name === column);
}

function hasIndex(db, name) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?"
  ).get(name));
}

test('connect: creates the current schema on a fresh database', () => {
  const db = connect(tempFile());

  assert.equal(schemaVersion(db), SCHEMA_VERSION);
  assert.ok(hasColumn(db, 'posts', 'account'));
  assert.ok(hasColumn(db, 'posts', 'publish_claim_id'));
  assert.ok(hasColumn(db, 'posts', 'publish_claim_expires_at'));
  assert.ok(hasIndex(db, 'idx_posts_item_platform_account'));

  const index = db.prepare(
    "SELECT sql FROM sqlite_master WHERE name = 'idx_posts_item_platform_account'"
  ).get();
  assert.match(index.sql, /UNIQUE INDEX/);

  db.close();
});

test('connect: upgrades v4, adds account, preserves rows, creates the index', () => {
  const file = tempFile();
  const v4 = makeV4(file);
  v4.prepare("INSERT INTO content_items (id, title) VALUES (1, 'kept')").run();
  v4.prepare(
    "INSERT INTO posts (content_item_id, platform) VALUES (1, 'tiktok')"
  ).run();
  v4.close();

  const db = connect(file);

  assert.equal(schemaVersion(db), SCHEMA_VERSION);
  assert.ok(hasColumn(db, 'posts', 'account'));
  assert.ok(hasColumn(db, 'posts', 'publish_claim_id'));
  assert.ok(hasColumn(db, 'posts', 'publish_claim_expires_at'));

  const account = db.prepare('PRAGMA table_info(posts)').all()
    .find((entry) => entry.name === 'account');
  assert.equal(account.type, 'TEXT');
  assert.equal(account.notnull, 1);
  assert.match(String(account.dflt_value), /default/);

  assert.equal(
    db.prepare('SELECT title FROM content_items WHERE id = 1').get().title,
    'kept'
  );
  assert.equal(
    db.prepare('SELECT account FROM posts WHERE id = 1').get().account,
    'default'
  );

  assert.ok(hasIndex(db, 'idx_posts_item_platform_account'));
  assert.deepEqual(
    db.prepare('PRAGMA index_info(idx_posts_item_platform_account)').all()
      .map((entry) => entry.name),
    ['content_item_id', 'platform', 'account']
  );

  db.close();
});

test('connect: duplicate posts block the migration and change nothing', () => {
  const file = tempFile();
  const v4 = makeV4(file);
  v4.prepare("INSERT INTO content_items (id, title) VALUES (1, 'x')").run();
  v4.prepare(
    "INSERT INTO posts (content_item_id, platform) VALUES (1, 'tiktok')"
  ).run();
  v4.prepare(
    "INSERT INTO posts (content_item_id, platform) VALUES (1, 'tiktok')"
  ).run();
  v4.close();

  assert.throws(
    () => connect(file),
    /duplicate rows exist: item=1 platform=tiktok account=default rows=2/
  );

  const raw = new DatabaseSync(file);
  assert.equal(schemaVersion(raw), 4);
  assert.ok(!hasColumn(raw, 'posts', 'account'));
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 2);
  assert.ok(!hasIndex(raw, 'idx_posts_item_platform_account'));
  raw.close();
});

test('connect: a current database is left untouched on the next connect', () => {
  const file = tempFile();

  const first = connect(file);
  first.prepare(
    "INSERT INTO settings (key, value) VALUES ('sentinel', '1')"
  ).run();
  const before = first.prepare('PRAGMA schema_version').get().schema_version;
  first.close();

  const second = connect(file);
  const after = second.prepare('PRAGMA schema_version').get().schema_version;

  assert.equal(after, before, 'no DDL runs when the schema is current');
  assert.equal(
    second.prepare("SELECT value FROM settings WHERE key = 'sentinel'").get().value,
    '1'
  );
  second.close();
});

test('connect: recreates a missing unique index without touching data', () => {
  const file = tempFile();

  const first = connect(file);
  first.prepare("INSERT INTO content_items (id, title) VALUES (1, 'kept')").run();
  first.prepare(
    "INSERT INTO posts (content_item_id, platform, account) " +
    "VALUES (1, 'tiktok', 'main')"
  ).run();
  first.exec('DROP INDEX idx_posts_item_platform_account');
  first.close();

  const db = connect(file);

  assert.ok(hasIndex(db, 'idx_posts_item_platform_account'));
  assert.equal(schemaVersion(db), SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 1);
  db.close();
});

test('initDb: remains an idempotent initializer', () => {
  const file = tempFile();

  const first = initDb(file);
  assert.equal(schemaVersion(first), SCHEMA_VERSION);
  first.close();

  const second = initDb(file);
  assert.equal(schemaVersion(second), SCHEMA_VERSION);
  second.close();
});
