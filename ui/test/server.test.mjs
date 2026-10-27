import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

let server;
let base;
let tmpDir;
let dbPath;

before(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'cos-ui-'));
  dbPath = path.join(tmpDir, 'content.db');
  process.env.CONTENTOS_DB = dbPath;
  process.env.CONTENTOS_UI_PORT = '0';
  // import server after env set
  const mod = await import('../server.mjs');
  server = mod.server;
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.on('listening', resolve);
  });
  const addr = server.address();
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (server) server.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env.CONTENTOS_DB;
});

function req(p, opts = {}) {
  return fetch(base + p, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (r) => {
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: r.status, json };
  });
}

test('health', async () => {
  const r = await req('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('content items empty initially', async () => {
  const r = await req('/api/content-items');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.items));
});

test('create idea via action', async () => {
  const r = await req('/api/actions/content', { method: 'POST', body: { action: 'addIdeas', ideas: [{ title: 'Test idea', source: 'experience' }] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.processed, 1);
  const list = await req('/api/content-items');
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.items[0].title, 'Test idea');
});

test('patch content item', async () => {
  const list = await req('/api/content-items');
  const id = list.json.items[0].id;
  const r = await req(`/api/content-items/${id}`, { method: 'PATCH', body: { research_notes: 'a'.repeat(120) } });
  assert.equal(r.status, 200);
  assert.equal(r.json.item.research_notes.length, 120);
});

test('content override updates fields and records a human audit entry', async () => {
  const list = await req('/api/content-items');
  const id = list.json.items[0].id;
  const script = { hook: 'Hook', script: 'one two three', points: [], cta: 'Follow', shot_notes: '' };
  const r = await req('/api/overrides/content', { method: 'POST', body: { targetId: id, reason: 'test override', fields: { script, research_notes: 'notes' } } });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.json.item.script).hook, 'Hook');
  assert.equal(r.json.item.research_notes, 'notes');
  const logs = await req('/api/engine-logs');
  assert.ok(logs.json.logs.some((l) => l.engine === 'human' && l.action === 'override_content' && l.target_id === id));
});

test('content override rejects a script that is not JSON', async () => {
  const list = await req('/api/content-items');
  const id = list.json.items[0].id;
  const r = await req('/api/overrides/content', { method: 'POST', body: { targetId: id, fields: { script: 'not json' } } });
  assert.equal(r.status, 400);
});

test('gates list', async () => {
  const r = await req('/api/gates');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.gates));
});

test('static assets served', async () => {
  const html = await fetch(base + '/').then((r) => r.text());
  assert.match(html, /app\.js/);
  assert.match(html, /styles\.css/);
  const js = await fetch(base + '/app.js').then((r) => r.text());
  assert.match(js, /initIcons/);
  const css = await fetch(base + '/styles.css').then((r) => r.text());
  assert.match(css, /\.table-wrap/);
  assert.match(css, /\.nav-item \.ico svg/);
});
