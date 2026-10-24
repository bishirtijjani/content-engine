// Database layer: connection, schema init, JSON helpers.
//
// The database is the central nervous system of content-os. Every engine and
// the agent, engines, and scripts go through here. Uses Node's built-in SQLite (node:sqlite) so the
// foundation has zero dependencies. The path is overridable via the
// CONTENTOS_DB environment variable (used by the tests too).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// packages/core/src/db.js -> repo root is three levels up
export const PROJECT_ROOT = path.resolve(__dirname, '../../..');
export const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'data', 'content.db');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');
const INDEXES_FILE = path.join(__dirname, 'indexes.sql');
export const SCHEMA_VERSION = 7;

// ---------------------------------------------------------------------------
// Migrations — run after the schema file (which creates new tables with
// CREATE TABLE IF NOT EXISTS). These add columns to tables that already
// existed in older databases. Each migration is idempotent.
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  {
    version: 2,
    up(db) {
      addColumn(db, 'content_items', 'session_id', 'INTEGER REFERENCES recording_sessions(id)');
      addColumn(db, 'content_items', 'recording_id', 'INTEGER REFERENCES recordings(id)');
      addColumn(db, 'content_item_history', 'skipped_states', 'TEXT');
      addColumn(db, 'engagement_items', 'content_item_id', 'INTEGER REFERENCES content_items(id) ON DELETE SET NULL');
      addColumn(db, 'insights', 'evidence_count', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'insights', 'last_confirmed_at', 'TEXT');
    },
  },
  {
    version: 3,
    up(db) {
      // The agent-written production plan (structured JSON) for the production
      // engine: captions/emphasis, overlays (templates + b-roll), zooms, sfx.
      // Mirrors how `script` holds the agent-written script for the content engine.
      addColumn(db, 'content_items', 'video_plan', 'TEXT');
    },
  },
  {
    version: 4,
    up(db) {
      // The rendered canvas's shape, so an asset records whether it is a
      // portrait or landscape master (and at what resolution).
      addColumn(db, 'assets', 'width', 'INTEGER');
      addColumn(db, 'assets', 'height', 'INTEGER');
      addColumn(db, 'assets', 'orientation', 'TEXT');
    },
  },
  {
    version: 5,
    up(db) {
      // Which authorized account a post belongs to. One platform can have
      // several independent accounts (two TikTok accounts, an Instagram
      // Creator plus a Business account). Existing rows predate accounts and
      // take the default identity.
      addColumn(db, 'posts', 'account', "TEXT NOT NULL DEFAULT 'default'");
    },
  },
  {
    version: 6,
    up(db) {
      // Provider-owned publishing progress (container id, stage, media id).
      // Kept across failures so a retry or restart resumes instead of posting
      // the same video twice.
      addColumn(db, 'posts', 'publish_state', 'TEXT');
    },
  },
  {
    version: 7,
    up(db) {
      // Atomic publish lease. A worker or a manual publish must claim a post
      // before calling a platform, so two processes can never publish it at
      // once. An expired lease is reclaimable after a crash.
      addColumn(db, 'posts', 'publish_claim_id', 'TEXT');
      addColumn(db, 'posts', 'publish_claim_expires_at', 'TEXT');
    },
  },
];

function addColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrate(db) {
  const current = schemaVersion(db);
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      m.up(db);
      db.prepare(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)"
      ).run(String(m.version));
    }
  }
}

/** Resolve the database path: env override, else the default in data/. */
export function getDbPath() {
  return process.env.CONTENTOS_DB || DEFAULT_DB_PATH;
}

/**
 * Open a connection and bring the schema to the current version.
 *
 * Every engine and script goes through connect(), so a normal startup applies
 * pending migrations exactly once. A database already at SCHEMA_VERSION with
 * its indexes is left untouched.
 *
 * @param {string} [dbPath] defaults to CONTENTOS_DB or <repo>/data/content.db
 */
export function connect(dbPath, { ensure = true } = {}) {
  const db = openDb(dbPath);
  try {
    if (ensure) ensureSchema(db);
    return db;
  } catch (err) {
    try { db.close(); } catch { /* keep the original error */ }
    throw err;
  }
}

/**
 * Explicit initializer. Kept for callers that name it directly; connect()
 * already does the same work and is idempotent.
 */
export function initDb(dbPath) {
  return connect(dbPath);
}

function openDb(dbPath) {
  const p = dbPath || getDbPath();
  mkdirSync(path.dirname(p), { recursive: true });
  const db = new DatabaseSync(p);
  db.exec('PRAGMA foreign_keys = ON');
  // Concurrent starts wait for each other instead of failing immediately.
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function ensureSchema(db) {
  const fresh = !tableExists(db, 'meta');
  if (!fresh) {
    const current = schemaVersion(db);
    if (current >= SCHEMA_VERSION && indexExists(db, 'idx_posts_item_platform_account')) {
      return;
    }
  }

  if (db.isTransaction) {
    runSchema(db);
    return;
  }

  // One transaction covers schema, migrations, the duplicate guard and
  // indexes. A failure leaves the database exactly as it was.
  db.exec('BEGIN IMMEDIATE');
  try {
    runSchema(db);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already unwound */ }
    throw err;
  }
}

function runSchema(db) {
  db.exec(readFileSync(SCHEMA_FILE, 'utf8'));

  // The unique index is the last step. Refuse the whole migration when
  // existing rows would make it impossible, and change nothing.
  assertNoDuplicatePosts(db);

  migrate(db);

  // Indexes run AFTER migrations: older databases lack columns (for example
  // content_items.session_id) referenced by the indexes.
  db.exec(readFileSync(INDEXES_FILE, 'utf8'));

  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)"
  ).run(String(SCHEMA_VERSION));
}

function tableExists(db, name) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(name));
}

function indexExists(db, name) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?"
  ).get(name));
}

/**
 * A duplicate (content_item_id, platform, account) group makes the unique
 * index impossible. Report it before any schema change. Existing v4 rows have
 * no account column and would all take 'default', so group on that.
 */
function assertNoDuplicatePosts(db) {
  if (!tableExists(db, 'posts')) return;

  const hasAccount = db.prepare('PRAGMA table_info(posts)').all()
    .some((column) => column.name === 'account');
  const account = hasAccount ? "COALESCE(account, 'default')" : "'default'";

  const rows = db.prepare(
    `SELECT content_item_id, platform, ${account} AS account, COUNT(*) AS n ` +
    `FROM posts GROUP BY content_item_id, platform, ${account} HAVING n > 1`
  ).all();

  if (!rows.length) return;

  const duplicates = rows.map(
    (row) => `item=${row.content_item_id} platform=${row.platform} ` +
      `account=${row.account} rows=${row.n}`
  ).join('; ');

  throw new Error(
    `cannot create the unique posts index — duplicate rows exist: ${duplicates}. ` +
    'Resolve them manually; nothing was changed.'
  );
}

export function schemaVersion(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  return row ? Number(row.value) : 0;
}

/** Serialize a JS value to a JSON string (null/undefined stay null). */
export function json(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/** Deserialize a JSON string back to a JS value (null stays null). */
export function parseJson(text) {
  if (text === null || text === undefined || text === '') return null;
  return JSON.parse(text);
}