// Content OS — local control center server.
//
// Zero runtime dependencies: uses node:http + node:sqlite via @content-os/core.
// Binds to 127.0.0.1 by default. Engines are invoked server-side; the DB is
// the contract. No secrets are ever sent to the client.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect, contentItem, asset as assetModel, post as postModel } from '@content-os/core';
import { ContentEngine } from '@content-os/engine-content';
import { ProductionEngine } from '@content-os/engine-production';
import { DistributionEngine } from '@content-os/engine-distribution';
import { EngagementEngine } from '@content-os/engine-engagement';
import { AnalyticsEngine } from '@content-os/engine-analytics';
import { createPublisherFromSettings } from '@content-os/engine-distribution';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_ROOT = path.join(REPO_ROOT, 'data');

const PORT = Number(process.env.CONTENTOS_UI_PORT || 4317);
const HOST = process.env.CONTENTOS_UI_HOST || '127.0.0.1';
const SOCKET = process.env.CONTENTOS_UI_SOCKET || null;

const db = connect();
const contentEngine = new ContentEngine(db);
const productionEngine = new ProductionEngine(db, { dataDir: DATA_ROOT });
let distributionEngine = null;
function getDistributionEngine() {
  if (distributionEngine) return distributionEngine;
  try {
    const publisher = createPublisherFromSettings(db);
    distributionEngine = new DistributionEngine(db, { publisher });
  } catch (e) {
    distributionEngine = new DistributionEngine(db);
  }
  return distributionEngine;
}
const engagementEngine = new EngagementEngine(db);
const analyticsEngine = new AnalyticsEngine(db);

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function writeStatusFile(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch (e) { /* ignore */ }
}
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5 * 1024 * 1024) reject(new Error('body too large')); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function sendFile(res, filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.writeHead(404); res.end();
  }
}

// ---- helpers ----
function listContentItems(status) {
  const sql = status ? "SELECT * FROM content_items WHERE status = ? ORDER BY id" : "SELECT * FROM content_items ORDER BY id";
  const rows = status ? db.prepare(sql).all(status) : db.prepare(sql).all();
  return rows.map(contentItem);
}
function getContentItem(id) {
  const row = db.prepare('SELECT * FROM content_items WHERE id = ?').get(id);
  return row ? contentItem(row) : null;
}
function listGates(status) {
  const sql = status ? "SELECT * FROM gates WHERE status = ? ORDER BY id DESC" : "SELECT * FROM gates ORDER BY id DESC";
  return status ? db.prepare(sql).all(status) : db.prepare(sql).all();
}
function listAssets() { return db.prepare('SELECT * FROM assets ORDER BY id DESC').all().map(assetModel); }
function listPosts() { return db.prepare('SELECT * FROM posts ORDER BY id DESC').all().map(postModel); }
function listCalendar() { return db.prepare('SELECT * FROM calendar_entries ORDER BY date DESC').all(); }
function listEngagement() { return db.prepare('SELECT * FROM engagement_items ORDER BY id DESC').all(); }
function listConversations() { return db.prepare('SELECT * FROM conversations ORDER BY id DESC').all(); }
function listMetrics() { return db.prepare('SELECT * FROM metrics ORDER BY id DESC').all(); }
function listInsights() { return db.prepare('SELECT * FROM insights ORDER BY id DESC').all(); }
function listPlaybook() { return db.prepare('SELECT * FROM playbook_rules ORDER BY id DESC').all(); }
function listSettings() { return db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all(); }
function getSetting(key) { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; }
function listEngineLogs() { return db.prepare('SELECT * FROM engine_logs ORDER BY id DESC LIMIT 200').all(); }
function listSessions() { return db.prepare('SELECT * FROM recording_sessions ORDER BY id DESC').all(); }
function listRecordings() { return db.prepare('SELECT * FROM recordings ORDER BY id DESC').all(); }

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const method = req.method;

  // --- health ---
  if (p === '/api/health' && method === 'GET') {
    return json(res, 200, { ok: true, schema_version: 7, db: 'content.db' });
  }

  // --- content items ---
  if (p === '/api/content-items' && method === 'GET') {
    const status = url.searchParams.get('status');
    return json(res, 200, { items: listContentItems(status) });
  }
  const itemMatch = p.match(/^\/api\/content-items\/(\d+)$/);
  if (itemMatch && method === 'GET') {
    const item = getContentItem(Number(itemMatch[1]));
    if (!item) return json(res, 404, { error: 'not found' });
    return json(res, 200, { item });
  }
  if (itemMatch && method === 'PATCH') {
    const id = Number(itemMatch[1]);
    const body = await readBody(req);
    const allowed = ['research_notes', 'script', 'video_plan', 'shot_instructions', 'notes', 'title', 'pillar', 'format', 'angle', 'target_audience', 'hook_style', 'cta', 'desired_length_seconds', 'series', 'priority', 'tags'];
    const sets = []; const vals = [];
    for (const k of allowed) {
      if (body[k] !== undefined) { sets.push(`${k} = ?`); vals.push(typeof body[k] === 'object' && body[k] !== null ? JSON.stringify(body[k]) : body[k]); }
    }
    if (!sets.length) return json(res, 400, { error: 'no updatable fields' });
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    db.prepare(`UPDATE content_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return json(res, 200, { item: getContentItem(id) });
  }

  // --- human overrides (recorded in the audit trail) ---
  if (p === '/api/overrides/content' && method === 'POST') {
    const body = await readBody(req);
    const id = Number(body.targetId);
    const item = getContentItem(id);
    if (!item) return json(res, 404, { error: 'not found' });
    const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
    const allowed = ['research_notes', 'script', 'video_plan', 'shot_instructions', 'notes', 'title', 'pillar', 'format', 'angle', 'target_audience', 'hook_style', 'cta', 'desired_length_seconds', 'series', 'priority', 'tags'];
    const sets = []; const vals = [];
    for (const k of allowed) {
      if (fields[k] === undefined) continue;
      let v = fields[k];
      if (k === 'script' && v && typeof v === 'object') v = JSON.stringify(v);
      if (k === 'script' && typeof v === 'string' && v.trim()) {
        try {
          const parsed = JSON.parse(v);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be an object');
        } catch (e) { return json(res, 400, { error: `script must be a JSON object: ${e.message}` }); }
      }
      sets.push(`${k} = ?`);
      vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
    }
    if (!sets.length) return json(res, 400, { error: 'no updatable fields' });
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    db.prepare(`UPDATE content_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const reason = String(body.reason || '').trim().slice(0, 500);
    db.prepare(
      "INSERT INTO engine_logs (engine, action, target_type, target_id, status, message) VALUES ('human', 'override_content', 'content_item', ?, 'success', ?)"
    ).run(id, reason ? `manual override: ${reason}` : 'manual override');
    return json(res, 200, { item: getContentItem(id) });
  }

  if (p === '/api/overrides/plan' && method === 'POST') {
    const body = await readBody(req);
    const targetId = Number(body.targetId);
    try {
      const saved = productionEngine.saveSnapshotPlan({ targetId, plan: body.plan });
      const reason = String(body.reason || '').trim().slice(0, 500);
      db.prepare(
        "INSERT INTO engine_logs (engine, action, target_type, target_id, status, message) VALUES ('human', 'override_plan', 'content_item', ?, 'success', ?)"
      ).run(targetId, reason ? `manual plan override: ${reason}` : 'manual plan override');
      return json(res, 200, { ...saved, targetId });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // --- gates ---
  if (p === '/api/gates' && method === 'GET') {
    const status = url.searchParams.get('status');
    return json(res, 200, { gates: listGates(status) });
  }
  const gateDecide = p.match(/^\/api\/gates\/(\d+)\/decide$/);
  if (gateDecide && method === 'POST') {
    const id = Number(gateDecide[1]);
    const body = await readBody(req);
    const { decideGate } = await import('@content-os/core');
    try {
      decideGate(db, id, body.decision, { decidedBy: body.decidedBy || 'human', notes: body.notes || null });
    } catch (e) { return json(res, 400, { error: e.message }); }
    const row = db.prepare('SELECT * FROM gates WHERE id = ?').get(id);
    return json(res, 200, { gate: row });
  }

  // --- assets / posts / calendar / engagement / analytics ---
  if (p === '/api/assets' && method === 'GET') return json(res, 200, { assets: listAssets() });
  if (p === '/api/posts' && method === 'GET') return json(res, 200, { posts: listPosts() });
  if (p === '/api/calendar' && method === 'GET') return json(res, 200, { entries: listCalendar() });
  if (p === '/api/engagement' && method === 'GET') return json(res, 200, { items: listEngagement() });
  if (p === '/api/conversations' && method === 'GET') return json(res, 200, { conversations: listConversations() });
  if (p === '/api/metrics' && method === 'GET') return json(res, 200, { metrics: listMetrics() });
  if (p === '/api/insights' && method === 'GET') return json(res, 200, { insights: listInsights() });
  if (p === '/api/insights' && method === 'PATCH') {
    // manual accept/reject
    const body = await readBody(req);
    if (!body.id || !['accepted', 'rejected', 'proposed'].includes(body.status)) return json(res, 400, { error: 'bad request' });
    db.prepare("UPDATE insights SET status = ?, updated_at = datetime('now') WHERE id = ?").run(body.status, body.id);
    // if accepted, optionally create playbook rule
    return json(res, 200, { ok: true });
  }
  if (p === '/api/playbook' && method === 'GET') return json(res, 200, { rules: listPlaybook() });
  if (p === '/api/settings' && method === 'GET') return json(res, 200, { settings: listSettings() });
  const settingMatch = p.match(/^\/api\/settings\/(.+)$/);
  if (settingMatch && method === 'PUT') {
    const key = decodeURIComponent(settingMatch[1]);
    const body = await readBody(req);
    const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value);
    // validate JSON
    try { JSON.parse(value); } catch (e) { return json(res, 400, { error: 'value must be valid JSON' }); }
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/engine-logs' && method === 'GET') return json(res, 200, { logs: listEngineLogs() });
  if (p === '/api/sessions' && method === 'GET') return json(res, 200, { sessions: listSessions(), recordings: listRecordings() });
  if (p === '/api/footage' && method === 'GET') return json(res, 200, productionEngine.listFootage());

  // style config (locked production style)
  if (p === '/api/style-config' && method === 'GET') {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'engine-production', 'config', 'style.json'), 'utf8'));
      return json(res, 200, { config: cfg });
    } catch (e) { return json(res, 500, { error: e.message }); }
  }

  // render status (detached render progress)
  if (p === '/api/production/render-status' && method === 'GET') {
    const targetId = Number(url.searchParams.get('targetId'));
    const tmpDir = path.join(DATA_ROOT, 'tmp');
    const statusFile = path.join(tmpDir, `render-status-${targetId}.json`);
    const pidFile = path.join(tmpDir, `render-${targetId}.pid`);
    let status = null;
    if (fs.existsSync(statusFile)) {
      try { status = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch { status = null; }
    }
    let running = false;
    if (pidFile && fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      running = pid && isAlive(pid);
      if (!running) { try { fs.unlinkSync(pidFile); } catch {} }
    }
    if (status && status.state === 'running' && !running) {
      // process died without updating status
      status = { ...status, state: 'error', error: 'render process exited unexpectedly' };
      writeStatusFile(statusFile, status);
    }
    return json(res, 200, { targetId, running, status });
  }

  // saved snapshot plan (parsed JSON) for inspection/editing
  if (p === '/api/production/plan' && method === 'GET') {
    const targetId = Number(url.searchParams.get('targetId'));
    const plan = productionEngine._readSnapshotPlan(targetId);
    return json(res, 200, { targetId, plan });
  }

  // validate a snapshot plan against the engine's actual checks
  if (p === '/api/production/validate-plan' && method === 'POST') {
    const body = await readBody(req);
    const targetId = Number(body.targetId);
    const item = productionEngine._item(targetId);
    let plan = body.plan;
    if (!plan) plan = productionEngine._readSnapshotPlan(targetId);
    if (!plan) return json(res, 400, { error: 'no plan to validate' });
    const result = productionEngine.validatePlan(targetId, plan);
    return json(res, 200, { targetId, problems: result.problems, ok: result.ok, footage: result.footage });
  }

  // plan stills (images rendered by planSnapshots)
  if (p === '/api/production/plan-stills' && method === 'GET') {
    const targetId = Number(url.searchParams.get('targetId'));
    const dir = productionEngine.paths.resolvePlanDir(targetId);
    const files = [];
    try {
      for (const name of fs.readdirSync(dir)) {
        if (/\.(png|jpg|jpeg|webp)$/i.test(name)) {
          files.push({ name, url: `/media/${path.relative(DATA_ROOT, path.join(dir, name)).split(path.sep).join('/')}` });
        }
      }
    } catch {}
    // also include composition index.html if present
    const compDir = productionEngine.paths.resolveProductionDir(targetId);
    const indexHtml = path.join(compDir, 'index.html');
    const hasComposition = fs.existsSync(indexHtml);
    return json(res, 200, { targetId, files, compositionUrl: hasComposition ? `/media/${path.relative(DATA_ROOT, indexHtml).split(path.sep).join('/')}` : null });
  }

  // --- engine actions ---
  if (p === '/api/actions/content' && method === 'POST') {
    const body = await readBody(req);
    const { action, targetId, dryRun, ideas } = body;
    try {
      if (action === 'addIdeas') {
        const r = contentEngine.addIdeas(ideas || []);
        return json(res, 200, r);
      }
      if (action === 'resubmit') {
        const r = contentEngine.resubmit({ targetId, dryRun });
        return json(res, 200, r);
      }
      const r = contentEngine.run({ action, targetId: targetId || null, dryRun: !!dryRun });
      return json(res, 200, r);
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (p === '/api/actions/production' && method === 'POST') {
    const body = await readBody(req);
    const { action, targetId, dryRun, filePath, plan } = body;
    try {
      if (action === 'process_footage') {
        const r = productionEngine.processFootage({ targetId, filePath, dryRun: !!dryRun });
        return json(res, 200, r);
      }
      if (action === 'save_snapshot_plan') {
        const r = productionEngine.saveSnapshotPlan({ targetId, plan });
        return json(res, 200, r);
      }
      if (action === 'plan_snapshots') {
        const r = await productionEngine.planSnapshots({ targetId });
        return json(res, 200, r);
      }
      if (action === 'approve_snapshot_plan') {
        const r = productionEngine.approveSnapshotPlan({ targetId });
        return json(res, 200, r);
      }
      if (action === 'preview' || action === 'edit') {
        // Detached render: spawn a worker process so the server stays responsive.
        const tmpDir = path.join(DATA_ROOT, 'tmp');
        try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
        const pidFile = path.join(tmpDir, `render-${targetId}.pid`);
        const statusFile = path.join(tmpDir, `render-status-${targetId}.json`);
        // check if already running
        let alreadyRunning = false;
        if (fs.existsSync(pidFile)) {
          const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
          if (pid && isAlive(pid)) alreadyRunning = true;
          else { try { fs.unlinkSync(pidFile); } catch {} }
        }
        if (alreadyRunning) {
          return json(res, 409, { error: 'a render is already running for this item', targetId });
        }
        const logOut = path.join(tmpDir, `render-${targetId}.out`);
        const logErr = path.join(tmpDir, `render-${targetId}.err`);
        const outFd = fs.openSync(logOut, 'a');
        const errFd = fs.openSync(logErr, 'a');
        const child = spawn(process.execPath, [
          '--disable-warning=ExperimentalWarning',
          path.join(__dirname, 'render-worker.mjs'),
          '--action', action,
          '--targetId', String(targetId),
        ], {
          detached: true,
          stdio: ['ignore', outFd, errFd],
          env: { ...process.env, CONTENTOS_DB: process.env.CONTENTOS_DB || path.join(REPO_ROOT, 'data', 'content.db'), CONTENT_OS_DATA_DIR: DATA_ROOT },
          cwd: REPO_ROOT,
        });
        child.unref();
        try { fs.closeSync(outFd); } catch {}
        try { fs.closeSync(errFd); } catch {}
        fs.writeFileSync(pidFile, String(child.pid));
        writeStatusFile(statusFile, { state: 'running', action, targetId, pid: child.pid, startedAt: new Date().toISOString() });
        return json(res, 202, { started: true, action, targetId, pid: child.pid });
      }
      if (action === 'request_review') {
        const r = productionEngine.requestReview({ targetId, dryRun: !!dryRun });
        return json(res, 200, r);
      }
      if (action === 'resubmit') {
        const r = productionEngine.resubmit({ targetId, dryRun: !!dryRun });
        return json(res, 200, r);
      }
      if (action === 'schedule') {
        const r = productionEngine.schedule({ targetId, dryRun: !!dryRun });
        return json(res, 200, r);
      }
      if (action === 'list_footage') {
        return json(res, 200, productionEngine.listFootage());
      }
      if (action === 'menu') {
        return json(res, 200, productionEngine.menu({ targetId: targetId || null }));
      }
      return json(res, 400, { error: 'unknown action' });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (p === '/api/actions/distribution' && method === 'POST') {
    const body = await readBody(req);
    const { action, targetId, dryRun, copy, platforms, postId, maxAttempts } = body;
    const de = getDistributionEngine();
    try {
      if (action === 'adapt') {
        const r = de.adapt({ targetId: targetId || null, copy: copy || null, platforms: platforms || null, dryRun: !!dryRun });
        return json(res, 200, r);
      }
      if (action === 'schedule') {
        const r = de.schedule({ targetId: targetId || null, dryRun: !!dryRun });
        return json(res, 200, r);
      }
      if (action === 'publish') {
        const r = await de.publish({ targetId: targetId || null, postId: postId || null, dryRun: !!dryRun, maxAttempts: maxAttempts || null });
        return json(res, 200, r);
      }
      if (action === 'reset_publish_state') {
        const r = de.resetPublishState({ postId, confirm: !!body.confirm });
        return json(res, 200, r);
      }
      return json(res, 400, { error: 'unknown action' });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (p === '/api/actions/engagement' && method === 'POST') {
    const body = await readBody(req);
    const { action, id, patch } = body;
    try {
      if (action === 'triage') {
        // manual triage write
        const sets = []; const vals = [];
        if (patch && typeof patch === 'object') {
          for (const k of ['classification', 'status', 'reply_text', 'conversation_id']) {
            if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
          }
        }
        if (sets.length) {
          vals.push(id);
          db.prepare(`UPDATE engagement_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        }
        // save as idea
        if (patch && patch.saveAsIdea) {
          const row = db.prepare('SELECT * FROM engagement_items WHERE id = ?').get(id);
          if (row) {
            const exists = db.prepare('SELECT id FROM content_items WHERE title = ?').get(row.text.slice(0, 200));
            if (!exists) {
              db.prepare("INSERT INTO content_items (title, source, pillar, priority) VALUES (?, 'comment', NULL, 'medium')").run(row.text.slice(0, 200));
              db.prepare("UPDATE engagement_items SET status = 'saved_as_idea' WHERE id = ?").run(id);
            }
          }
        }
        return json(res, 200, { ok: true });
      }
      // engine survey (non-mutating)
      const r = engagementEngine.run({});
      return json(res, 200, r);
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (p === '/api/actions/analytics' && method === 'POST') {
    const body = await readBody(req);
    const { action, id, patch } = body;
    try {
      if (action === 'promote_insight') {
        const insight = db.prepare('SELECT * FROM insights WHERE id = ?').get(id);
        if (!insight) return json(res, 404, { error: 'not found' });
        // create playbook rule from insight
        db.prepare("INSERT INTO playbook_rules (insight_id, rule, dimension, dimension_value, metric, effect, magnitude, confidence, status) VALUES (?,?,?,?,?,?,?,?, 'active')").run(
          insight.id, insight.claim, insight.dimension, insight.dimension_value, insight.metric, insight.effect, insight.magnitude, insight.confidence
        );
        db.prepare("UPDATE insights SET status = 'accepted' WHERE id = ?").run(id);
        return json(res, 200, { ok: true });
      }
      if (action === 'set_insight_status') {
        db.prepare("UPDATE insights SET status = ? WHERE id = ?").run(patch.status, id);
        return json(res, 200, { ok: true });
      }
      const r = analyticsEngine.run ? analyticsEngine.run({}) : { note: 'stub' };
      return json(res, 200, r);
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (p === '/api/fast-track' && method === 'POST') {
    const body = await readBody(req);
    const { fastTrack } = await import('@content-os/core');
    try {
      const r = fastTrack(db, body.itemId, body.toStatus, { actor: 'human', reason: body.reason });
      return json(res, 200, r);
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // --- static files ---
  // docs (read-only reference files: diagram catalogs, etc.)
  if (p.startsWith('/docs/')) {
    const rel = p.replace(/^\/docs\//, '');
    const filePath = path.join(REPO_ROOT, 'docs', rel);
    if (!filePath.startsWith(path.join(REPO_ROOT, 'docs'))) { res.writeHead(403); res.end(); return; }
    return sendFile(res, filePath);
  }
  // media/renders under data/
  if (p.startsWith('/media/')) {
    const rel = p.replace(/^\/media\//, '');
    const filePath = path.join(DATA_ROOT, rel);
    // guard: must stay inside DATA_ROOT
    if (!filePath.startsWith(DATA_ROOT)) { res.writeHead(403); res.end(); return; }
    return sendFile(res, filePath);
  }
  // public assets
  let filePath = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p.replace(/^\//, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  if (fs.existsSync(filePath)) return sendFile(res, filePath);
  // SPA fallback
  return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    try { json(res, 500, { error: e.message }); } catch { res.writeHead(500); res.end(); }
  });
});

function startListening() {
  if (SOCKET) {
    try { if (fs.existsSync(SOCKET)) fs.unlinkSync(SOCKET); } catch { /* ignore */ }
    const dir = path.dirname(SOCKET);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    server.listen(SOCKET, () => {
      try { fs.chmodSync(SOCKET, 0o666); } catch { /* ignore */ }
      console.log(`Content OS UI: unix:${SOCKET}`);
    });
  } else {
    server.listen(PORT, HOST, () => {
      console.log(`Content OS UI: http://${HOST}:${PORT}`);
    });
  }
}
startListening();

export { server, db };
