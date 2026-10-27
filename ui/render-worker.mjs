// Detached worker that runs a Production Engine render action out-of-process.
// Usage: node render-worker.mjs --action preview|edit --targetId N
// Env: CONTENTOS_DB (db path), CONTENT_OS_DATA_DIR (data root)
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { connect } from '@content-os/core';
import { ProductionEngine } from '@content-os/engine-production';

const args = process.argv.slice(2);
let action = null;
let targetId = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--action') action = args[++i];
  else if (args[i] === '--targetId') targetId = Number(args[++i]);
}

if (!action || !targetId) {
  console.error('usage: render-worker.mjs --action preview|edit --targetId N');
  process.exit(2);
}

const dbPath = process.env.CONTENTOS_DB || undefined;
const dataDir = process.env.CONTENT_OS_DATA_DIR || path.join(process.cwd(), '..', 'data');
const db = connect(dbPath);
const engine = new ProductionEngine(db, { dataDir });

const statusDir = path.join(dataDir, 'tmp');
mkdirSync(statusDir, { recursive: true });
const statusFile = path.join(statusDir, `render-status-${targetId}.json`);
const pidFile = path.join(statusDir, `render-${targetId}.pid`);

function writeStatus(obj) {
  try { writeFileSync(statusFile, JSON.stringify(obj, null, 2)); } catch (e) { console.error('status write failed', e.message); }
}

writeFileSync(pidFile, String(process.pid));
writeStatus({ state: 'running', action, targetId, pid: process.pid, startedAt: new Date().toISOString() });

let result = null;
let error = null;
try {
  if (action === 'preview') result = await engine.preview({ targetId });
  else if (action === 'edit') result = engine.edit({ targetId });
  else throw new Error('unknown action: ' + action);
} catch (e) {
  error = e && e.message ? e.message : String(e);
}

if (error) {
  writeStatus({ state: 'error', action, targetId, pid: process.pid, error, finishedAt: new Date().toISOString() });
  process.exit(1);
} else {
  writeStatus({ state: 'done', action, targetId, pid: process.pid, result, finishedAt: new Date().toISOString() });
  process.exit(0);
}