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
export const SCHEMA_VERSION = 2;

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

/** Open a connection (creates the file and parent dirs as needed). */
export function connect(dbPath) {
  const p = dbPath || getDbPath();
  mkdirSync(path.dirname(p), { recursive: true });
  const db = new DatabaseSync(p);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** Create the schema if needed, run migrations, stamp the version. Idempotent. */
export function initDb(dbPath) {
  const db = connect(dbPath);
  db.exec(readFileSync(SCHEMA_FILE, 'utf8'));
  migrate(db);
  // Indexes run AFTER migrations: v1 -> v2 adds columns (e.g.
  // content_items.session_id) that existing databases lack when schema.sql
  // runs, so indexes referencing them would fail before the migration.
  db.exec(readFileSync(INDEXES_FILE, 'utf8'));
  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)"
  ).run(String(SCHEMA_VERSION));
  return db;
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