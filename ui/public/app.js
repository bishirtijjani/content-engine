// Content OS UI — client logic (vanilla, no deps)
const API = '';
let currentView = 'dashboard';
let dataCache = {};

// ---- theme ----
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'system') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', mode);
  }
  localStorage.setItem('co-theme', mode);
}
const savedTheme = localStorage.getItem('co-theme') || 'system';
applyTheme(savedTheme);
document.getElementById('themeSelect').value = savedTheme;
document.getElementById('themeSelect').addEventListener('change', (e) => applyTheme(e.target.value));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem('co-theme') || 'system') === 'system') applyTheme('system');
});

// ---- utils ----
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error((json && json.error) || res.statusText);
  return json;
}
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.innerHTML = `<div class="toast ${type}">${msg}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 3500);
}
function openModal(title, bodyHtml, opts = {}) {
  const backdrop = document.getElementById('modalBackdrop');
  const modalEl = backdrop.querySelector('.modal');
  if (modalEl) modalEl.style.maxWidth = opts.wide ? '980px' : '';
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  const confirmBtn = document.getElementById('modalConfirm');
  const cancelBtn = document.getElementById('modalCancel');
  confirmBtn.textContent = opts.confirmLabel || 'Confirm';
  cancelBtn.textContent = opts.cancelLabel || 'Cancel';
  const newConfirm = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  const newCancel = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
  newConfirm.addEventListener('click', async () => {
    newConfirm.disabled = true;
    try {
      if (opts.onConfirm) {
        const ok = await opts.onConfirm();
        if (ok === false) { newConfirm.disabled = false; return; }
      }
      closeModal();
    } catch (e) {
      toast(e.message || 'Error', 'error');
    } finally {
      newConfirm.disabled = false;
    }
  });
  newCancel.addEventListener('click', () => { if (opts.onCancel) opts.onCancel(); closeModal(); });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); }, { once: true });
  backdrop.style.display = 'grid';
  const first = backdrop.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 50);
}
function closeModal() {
  document.getElementById('modalBackdrop').style.display = 'none';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
function loading() { return `<div class="loading"><span class="spinner"></span> Loading…</div>`; }
function empty(title, sub = '') { return `<div class="empty"><h3>${title}</h3><p>${sub}</p></div>`; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function mediaUrl(p) {
  if (!p) return null;
  const idx = p.indexOf('data/');
  const rel = idx >= 0 ? p.slice(idx + 5) : p.replace(/^\/+/, '');
  return '/media/' + rel.split(/\\\\/).join('/');
}
function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return d; }
}
function badge(text, cls = '') { return `<span class="badge ${cls}">${esc(text)}</span>`; }
function statusBadge(s) {
  const map = { idea: '', evaluated: 'info', planned: 'info', researched: 'info', scripted: 'warn', ready_to_shoot: 'warn', shot: 'warn', editing: 'accent', scheduled: 'accent', draft: 'warn', published: 'success', measured: 'success', archived: '', failed: 'danger' };
  return badge(s, map[s] || '');
}

// ---- icons (inline SVG, Tabler-style, consistent stroke) ----
const ICONS = {
  dashboard: '<path d="M4 4h6v8H4zM4 16h6v4H4zM14 4h6v4h-6zM14 12h6v8h-6z"/>',
  content: '<path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2zM9 9h1M9 13h6M9 17h6"/>',
  production: '<path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14v-4zM3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"/>',
  approvals: '<path d="M5 12l5 5L20 7"/>',
  distribution: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 9l5-5 5 5M12 4v12"/>',
  calendar: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zM16 3v4M8 3v4M4 11h16"/>',
  engagement: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4l-4 4v-4H6a2 2 0 0 1-2-2V6z"/>',
  analytics: '<path d="M3 13a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6zM10 9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V9zM17 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5z"/>',
  assets: '<path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>',
  templates: '<path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0M3 6l0 13M12 6l0 13M21 6l0 13"/>',
  settings: '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0"/>',
  system: '<path d="M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5zM3 13a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4zM7 8h.01M7 16h.01"/>',
  refresh: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2m-.5-4v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  edit: '<path d="M7 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1M10.5 13.5l7-7a2.121 2.121 0 0 0-3-3l-7 7L7 14l.5-3.5zM13.5 6.5l3 3"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
};
function icon(name, size = 18) {
  const p = ICONS[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
function initIcons() {
  document.querySelectorAll('.nav-item').forEach((el) => {
    const ico = el.querySelector('.ico');
    if (ico && ICONS[el.dataset.view]) ico.innerHTML = icon(el.dataset.view);
  });
  const mb = document.getElementById('menuBtn');
  if (mb) mb.innerHTML = icon('menu');
  const rb = document.getElementById('refreshBtn');
  if (rb) rb.innerHTML = icon('refresh') + ' Refresh';
}

// ---- navigation ----
const titles = {
  dashboard: 'Dashboard',
  content: 'Content',
  production: 'Production',
  approvals: 'Approvals',
  distribution: 'Distribution',
  calendar: 'Calendar',
  engagement: 'Engagement',
  analytics: 'Analytics',
  assets: 'Assets',
  templates: 'Templates',
  settings: 'Settings',
  system: 'System',
};
document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    el.classList.add('active');
    currentView = el.dataset.view;
    const t = titles[currentView];
    document.getElementById('viewTitle').textContent = t;
    render();
    if (window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('open');
  });
});
document.getElementById('refreshBtn').addEventListener('click', () => render(true));
document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('content').addEventListener('click', () => { if (window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('open'); });
if (window.innerWidth <= 900) document.getElementById('menuBtn').style.display = '';

async function render(force = false) {
  const c = document.getElementById('content');
  c.innerHTML = loading();
  try {
    const view = views[currentView];
    if (typeof view !== 'function') {
      c.innerHTML = empty('View not available', `The "${currentView}" view is not implemented yet.`);
      return;
    }
    await view(c, force);
  } catch (e) {
    c.innerHTML = `<div class="card"><strong>Error:</strong> ${esc(e.message)}</div>`;
  }
}

// ---- views ----
const views = {};

// DASHBOARD
views.dashboard = async (c) => {
  const [items, gates, posts, logs] = await Promise.all([
    api('/api/content-items'), api('/api/gates?status=pending'), api('/api/posts'), api('/api/engine-logs'),
  ]);
  const counts = {};
  for (const it of items.items) counts[it.status] = (counts[it.status] || 0) + 1;
  const funnel = ['idea', 'evaluated', 'planned', 'researched', 'scripted', 'ready_to_shoot', 'shot', 'editing', 'scheduled', 'published'];
  c.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="card"><div class="kpi"><div class="kpi-value">${items.items.length}</div><div class="kpi-label">Content items</div></div></div>
      <div class="card"><div class="kpi"><div class="kpi-value">${gates.gates.length}</div><div class="kpi-label">Pending gates</div></div></div>
      <div class="card"><div class="kpi"><div class="kpi-value">${posts.posts.filter(p=>p.status==='scheduled').length}</div><div class="kpi-label">Scheduled posts</div></div></div>
      <div class="card"><div class="kpi"><div class="kpi-value">${posts.posts.filter(p=>p.status==='published').length}</div><div class="kpi-label">Published</div></div></div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3 style="margin-bottom:10px;">Pipeline funnel</h3>
      <div class="kanban">
        ${funnel.map((s) => `<div class="kanban-col"><h4>${s} <span>${counts[s]||0}</span></h4>${items.items.filter(i=>i.status===s).slice(0,5).map(i=>`<div class="kanban-card" onclick="openItem(${i.id})"><div class="title">${esc(i.title)}</div><div class="meta">${esc(i.pillar||'—')}</div></div>`).join('')}${(counts[s]||0)>5?`<div class="meta">+${counts[s]-5} more</div>`:''}</div>`).join('')}
      </div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <h3 style="margin-bottom:10px;">Pending approvals</h3>
        ${gates.gates.length ? gates.gates.slice(0,8).map(g=>`<div class="row" style="padding:6px 0;border-bottom:1px solid var(--border);"><div style="flex:1;"><strong>${esc(g.gate_type)}</strong> <span class="meta">· ${esc(g.target_type)} #${g.target_id}</span></div>${badge(g.status,'warn')}</div>`).join('') : empty('No pending gates','All caught up.')}
      </div>
      <div class="card">
        <h3 style="margin-bottom:10px;">Recent activity</h3>
        ${logs.logs.slice(0,10).map(l=>`<div style="padding:4px 0;font-size:12px;border-bottom:1px solid var(--border);"><span class="meta">${esc(fmtDate(l.created_at))}</span> · <strong>${esc(l.engine)}</strong> ${esc(l.action)} ${l.target_id?`#${l.target_id}`:''} — ${esc(l.message||l.status)}</div>`).join('') || empty('No logs','Engine activity will appear here.')}
      </div>
    </div>
  `;
};

// CONTENT
views.content = async (c) => {
  const { items } = await api('/api/content-items');
  const statuses = ['idea','evaluated','planned','researched','scripted','ready_to_shoot'];
  const counts = {};
  for (const it of items) counts[it.status] = (counts[it.status]||0)+1;
  const has = (s) => (counts[s]||0) > 0;
  c.innerHTML = `
    <div class="row" style="margin-bottom:12px;gap:6px;flex-wrap:wrap;align-items:center;">
      <button class="btn primary sm" onclick="newIdea()" title="Type a new idea manually">${icon('plus',14)} Add idea</button>
      <button class="btn sm" onclick="runContentAction('discover')" title="Pull ideas from audience comments and DMs">Discover</button>
      ${has('idea') ? `<span style="width:1px;height:20px;background:var(--border);margin:0 4px;"></span>
      <button class="btn sm" onclick="runContentAction('evaluate')" title="Score all unscored ideas 0-100">Evaluate (${counts.idea})</button>` : ''}
      ${has('evaluated') ? `<button class="btn sm" onclick="runContentAction('plan')" title="Fill in pillar, format, hook, length for approved ideas">Plan (${counts.evaluated})</button>` : ''}
      ${has('planned') || has('researched') || has('scripted') ? `<span style="width:1px;height:20px;background:var(--border);margin:0 4px;"></span>` : ''}
      ${has('planned') ? `<button class="btn sm" onclick="runContentAction('research')" title="Finalize agent-written research notes">Research finalize (${counts.planned})</button>` : ''}
      ${has('researched') ? `<button class="btn sm" onclick="runContentAction('script')" title="Finalize agent-written script">Script finalize (${counts.researched})</button>` : ''}
      ${has('scripted') ? `<button class="btn sm" onclick="runContentAction('ready')" title="Move approved scripts to ready-to-shoot">Ready (${counts.scripted})</button>` : ''}
    </div>
    <div class="kanban">
      ${statuses.map((s) => `
        <div class="kanban-col">
          <h4>${s} <span>${items.filter(i=>i.status===s).length}</span></h4>
          ${items.filter(i=>i.status===s).map(i=>`
            <div class="kanban-card" onclick="openItem(${i.id})">
              <div class="title">${esc(i.title)}</div>
              <div class="meta">${esc(i.pillar||'—')} · ${i.evaluation_score!=null?i.evaluation_score+'/100':'unscored'}</div>
            </div>
          `).join('') || '<div class="meta" style="padding:8px;">empty</div>'}
        </div>
      `).join('')}
    </div>
  `;
};

window.newIdea = async () => {
  openModal('New idea', '<div class="stack"><div class="card-flat"><div class="label">Idea title</div><input class="input" id="m-title" placeholder="Idea title" /></div></div>', {
    confirmLabel: 'Add',
    onConfirm: async () => {
      const title = document.getElementById('m-title').value.trim();
      if (!title) { toast('Title required', 'error'); return false; }
      await api('/api/actions/content', { method:'POST', body: { action:'addIdeas', ideas:[{ title, source:'experience' }] } });
      toast('Idea added'); render();
    },
  });
};
window.runContentAction = async (action) => {
  try {
    const r = await api('/api/actions/content', { method:'POST', body: { action } });
    toast(`${action}: ${JSON.stringify(r).slice(0,120)}`); render();
  } catch (e) { toast(e.message, 'error'); }
};
window.openItem = async (id) => {
  const [{ item }, { gates }] = await Promise.all([
    api(`/api/content-items/${id}`),
    api('/api/gates?status=pending'),
  ]);
  const mine = (gates || []).filter((g) => g.target_type === 'content_item' && g.target_id === id);
  openDrawer(itemDetailHtml(item, mine));
  updateScriptWordCount();
};
window.updateScriptWordCount = () => {
  const el = document.getElementById('scriptWordCount');
  const ta = document.getElementById('f-script-text');
  if (!el || !ta || !window._scriptTarget) return;
  const words = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
  const { min, max } = window._scriptTarget;
  const ok = words >= min && words <= max;
  el.textContent = `${words} words · target ${min}–${max}`;
  el.style.color = words === 0 ? 'var(--on-surface-variant)' : (ok ? 'var(--success)' : 'var(--error)');
};

function pointRowHtml(p, idx) {
  return `<div class="card-flat" style="margin-bottom:6px;" data-point-idx="${idx}">
    <div class="row" style="gap:6px;align-items:flex-start;">
      <div style="flex:1;"><div class="label">Title</div><input class="input" data-point-field="title" value="${esc(p.title)}" /></div>
      <button class="btn sm danger" type="button" onclick="removePoint(${idx})" style="margin-top:18px;">${icon('x',12)}</button>
    </div>
    <div style="margin-top:6px;"><div class="label">Detail</div><textarea class="textarea" data-point-field="detail" style="min-height:60px;">${esc(p.detail)}</textarea></div>
  </div>`;
}
function itemDetailHtml(item, pendingGates = []) {
  let scriptObj = null;
  try { scriptObj = typeof item.script === 'string' ? JSON.parse(item.script) : item.script; } catch { scriptObj = null; }
  if (!scriptObj || typeof scriptObj !== 'object') scriptObj = {};
  window._currentPoints = Array.isArray(scriptObj.points) ? scriptObj.points.map((p) => ({ title: p.title || '', detail: p.detail || '' })) : [];
  const pointsHtml = window._currentPoints.map((p, idx) => pointRowHtml(p, idx)).join('');
  const lengthSeconds = Number(item.desired_length_seconds) || 60;
  window._scriptTarget = { min: Math.round(lengthSeconds * 2.0), max: Math.round(lengthSeconds * 3.0) };
  const canApproveIdea = pendingGates.some((g) => g.gate_type === 'idea_approval');
  const canApproveScript = pendingGates.some((g) => g.gate_type === 'script_review');
  const canEvaluate = item.status === 'idea';
  return `
    <h2>${esc(item.title)}</h2>
    <div class="row" style="margin-bottom:8px;">${statusBadge(item.status)} ${badge('id '+item.id)} ${item.evaluation_score!=null?badge(item.evaluation_score+'/100','accent'):''}</div>
    <p class="meta" style="margin-bottom:12px;">Saving here records a manual override in the audit log.</p>
    <div class="stack">
      <div class="card-flat">
        <div class="label">Title</div>
        <input class="input" id="f-title" value="${esc(item.title)}" />
      </div>
      <div class="grid grid-2">
        <div class="card-flat"><div class="label">Pillar</div><input class="input" id="f-pillar" value="${esc(item.pillar||'')}" /></div>
        <div class="card-flat"><div class="label">Format</div><input class="input" id="f-format" value="${esc(item.format||'')}" /></div>
        <div class="card-flat"><div class="label">Hook style</div><input class="input" id="f-hook" value="${esc(item.hook_style||'')}" /></div>
        <div class="card-flat"><div class="label">Length (s)</div><input class="input" id="f-len" type="number" value="${item.desired_length_seconds||''}" /></div>
      </div>
      <div class="card-flat"><div class="label">Angle</div><input class="input" id="f-angle" value="${esc(item.angle||'')}" /></div>
      <div class="card-flat"><div class="label">Target audience</div><input class="input" id="f-aud" value="${esc(item.target_audience||'')}" /></div>
      <div class="card-flat"><div class="label">CTA</div><input class="input" id="f-cta" value="${esc(item.cta||'')}" /></div>
      <div class="card-flat"><div class="label">Shot instructions</div><textarea class="textarea" id="f-shot">${esc(item.shot_instructions||'')}</textarea></div>
      <div class="card-flat"><div class="label">Research notes</div><textarea class="textarea" id="f-research" style="min-height:160px;">${esc(item.research_notes||'')}</textarea></div>
      <div class="card-flat">
        <div class="row" style="justify-content:space-between;margin-bottom:8px;">
          <div class="label" style="margin:0;">Script</div>
          <div class="meta" id="scriptWordCount"></div>
        </div>
        <div class="label">Hook</div>
        <textarea class="textarea" id="f-hook-text" style="min-height:60px;">${esc(scriptObj.hook || '')}</textarea>
        <div style="margin-top:8px;"><div class="label">Spoken words</div><textarea class="textarea" id="f-script-text" style="min-height:160px;" oninput="updateScriptWordCount()">${esc(scriptObj.script || '')}</textarea></div>
        <div style="margin-top:8px;">
          <div class="label">Points</div>
          <div id="f-points">${pointsHtml}</div>
          <button class="btn sm" type="button" onclick="addPoint()" style="margin-top:6px;">${icon('plus',12)} Add point</button>
        </div>
        <div style="margin-top:8px;"><div class="label">CTA</div><input class="input" id="f-cta-text" value="${esc(scriptObj.cta || '')}" /></div>
        <div style="margin-top:8px;"><div class="label">Shot notes</div><textarea class="textarea" id="f-shot-notes" style="min-height:60px;">${esc(scriptObj.shot_notes || '')}</textarea></div>
      </div>
      <div class="row">
        <button class="btn primary sm" onclick="saveItem(${item.id})">Save override</button>
        ${canEvaluate ? `<button class="btn sm" onclick="runContentAction('evaluate');">Evaluate</button>` : ''}
        ${canApproveIdea ? `<button class="btn sm" onclick="decideLatestGate('idea_approval',${item.id})">Approve idea gate</button>` : ''}
        ${canApproveScript ? `<button class="btn sm" onclick="decideLatestGate('script_review',${item.id})">Approve script gate</button>` : ''}
      </div>
      <details style="margin-top:4px;">
        <summary class="meta" style="cursor:pointer;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Advanced: Fast-track</summary>
        <div class="card-flat" style="margin-top:6px;">
          <div class="row">
            <select class="select" id="ft-target" style="width:auto;">
              <option value="planned">planned</option><option value="researched">researched</option><option value="scripted">scripted</option><option value="ready_to_shoot">ready_to_shoot</option>
            </select>
            <input class="input" id="ft-reason" placeholder="reason (required)" style="flex:1;" />
            <button class="btn sm danger" onclick="fastTrackItem(${item.id})">Fast-track</button>
          </div>
        </div>
      </details>
    </div>
  `;
}

window.collectPoints = () => {
  const rows = document.querySelectorAll('#f-points [data-point-idx]');
  const out = [];
  rows.forEach((row) => {
    const title = row.querySelector('[data-point-field="title"]').value.trim();
    const detail = row.querySelector('[data-point-field="detail"]').value.trim();
    if (title || detail) out.push({ title: title || 'Untitled', detail });
  });
  return out;
};
window.addPoint = () => {
  const container = document.getElementById('f-points');
  const idx = container.querySelectorAll('[data-point-idx]').length;
  const div = document.createElement('div');
  div.innerHTML = pointRowHtml({ title: '', detail: '' }, idx);
  container.appendChild(div.firstElementChild);
  // reindex
  container.querySelectorAll('[data-point-idx]').forEach((el, i) => { el.setAttribute('data-point-idx', i); });
};
window.removePoint = (idx) => {
  const container = document.getElementById('f-points');
  const rows = container.querySelectorAll('[data-point-idx]');
  if (rows[idx]) rows[idx].remove();
  container.querySelectorAll('[data-point-idx]').forEach((el, i) => { el.setAttribute('data-point-idx', i); });
};
window.saveItem = async (id) => {
  const hook = document.getElementById('f-hook-text').value.trim();
  const scriptText = document.getElementById('f-script-text').value.trim();
  const ctaText = document.getElementById('f-cta-text').value.trim();
  const shotNotes = document.getElementById('f-shot-notes').value.trim();
  const points = window.collectPoints();
  const scriptObj = (hook || scriptText || ctaText || shotNotes || points.length)
    ? { hook, script: scriptText, points, cta: ctaText, shot_notes: shotNotes }
    : null;
  const fields = {
    title: document.getElementById('f-title').value,
    pillar: document.getElementById('f-pillar').value || null,
    format: document.getElementById('f-format').value || null,
    hook_style: document.getElementById('f-hook').value || null,
    desired_length_seconds: Number(document.getElementById('f-len').value) || null,
    angle: document.getElementById('f-angle').value || null,
    target_audience: document.getElementById('f-aud').value || null,
    cta: document.getElementById('f-cta').value || null,
    shot_instructions: document.getElementById('f-shot').value,
    research_notes: document.getElementById('f-research').value,
    script: scriptObj ? JSON.stringify(scriptObj) : '',
  };
  try {
    await api('/api/overrides/content', { method: 'POST', body: { targetId: id, fields } });
    toast('Override saved'); render();
  } catch (e) { toast(e.message, 'error'); }
};

window.decideLatestGate = async (type, itemId) => {
  const { gates } = await api('/api/gates?status=pending');
  const g = gates.find((x) => x.gate_type === type && x.target_type === 'content_item' && x.target_id === itemId);
  if (!g) { toast('No pending ' + type + ' gate', 'error'); return; }
  openModal('Approve ' + type, '<div class="stack"><div class="card-flat"><div class="label">Notes (optional)</div><textarea class="textarea" id="m-notes" style="min-height:80px;"></textarea></div></div>', {
    confirmLabel: 'Approve',
    onConfirm: async () => {
      const notes = document.getElementById('m-notes').value;
      try {
        await api(`/api/gates/${g.id}/decide`, { method:'POST', body: { decision:'approved', notes, decidedBy:'human' } });
        toast('Approved'); render();
      } catch (e) { toast(e.message,'error'); return false; }
    },
  });
};
window.fastTrackItem = async (itemId) => {
  const toStatus = document.getElementById('ft-target').value;
  const reason = document.getElementById('ft-reason').value.trim();
  if (!reason) { toast('Reason required', 'error'); return; }
  try {
    await api('/api/fast-track', { method:'POST', body: { itemId, toStatus, reason } });
    toast('Fast-tracked'); render();
  } catch (e) { toast(e.message, 'error'); }
};

// PRODUCTION
function renderRendersHtml(ia) {
  if (!ia.length) return '';
  const links = ia.map((a) => {
    const u = mediaUrl(a.file_path);
    if (u) return `<a class="btn sm" href="${esc(u)}" target="_blank">${icon('production', 14)} ${esc(a.platform)} ${a.width || '?'}x${a.height || '?'}</a>`;
    return `<span class="meta">${esc(a.file_path)}</span>`;
  }).join('');
  return `<div style="margin-top:8px;"><div class="label">Renders</div><div class="row" style="gap:8px;flex-wrap:wrap;">${links}</div></div>`;
}
views.production = async (c) => {
  const [{ items }, { assets }, { gates }] = await Promise.all([
    api('/api/content-items'), api('/api/assets'), api('/api/gates'),
  ]);
  const prod = items.filter((i) => ['ready_to_shoot','shot','editing','scheduled'].includes(i.status));
  const assetsByItem = {};
  for (const a of assets) { (assetsByItem[a.content_item_id] = assetsByItem[a.content_item_id] || []).push(a); }
  const stillsByItem = {};
  const planByItem = {};
  await Promise.all(prod.map(async (i) => {
    try { const r = await api(`/api/production/plan-stills?targetId=${i.id}`); stillsByItem[i.id] = r; }
    catch { stillsByItem[i.id] = { files: [], compositionUrl: null }; }
    try { const p = await api(`/api/production/plan?targetId=${i.id}`); planByItem[i.id] = p.plan || null; }
    catch { planByItem[i.id] = null; }
  }));
  const pendingGates = gates.filter((g) => g.status === 'pending');
  const gateFor = (type, id) => pendingGates.find((g) => g.gate_type === type && g.target_type === 'content_item' && g.target_id === id);
  const approvedGate = (type, id) => gates.some((g) => g.gate_type === type && g.target_type === 'content_item' && g.target_id === id && g.status === 'approved');
  const cards = prod.map((i) => {
    const its = stillsByItem[i.id] || { files: [], compositionUrl: null };
    const ia = assetsByItem[i.id] || [];
    const renderStatus = `<span id="renderStatus-${i.id}" class="meta"></span>`;
    const hasFootage = !!i.recording_id;
    const hasPlan = !!planByItem[i.id];
    const planGate = gateFor('snapshot_plan_review', i.id);
    const planApproved = approvedGate('snapshot_plan_review', i.id);
    const assetApproved = approvedGate('asset_review', i.id);
    const hasRender = ia.length > 0;
    let stillsHtml = '';
    if (its.files.length) {
      const imgs = its.files.map((f) => `<a href="${esc(f.url)}" target="_blank"><img src="${esc(f.url)}" alt="${esc(f.name)}" style="width:120px;height:auto;border-radius:8px;border:1px solid var(--border);" /></a>`).join('');
      stillsHtml = `<div style="margin-top:10px;"><div class="label">Plan stills</div><div class="row" style="gap:8px;flex-wrap:wrap;">${imgs}</div></div>`;
    }
    let compHtml = '';
    if (its.compositionUrl) {
      compHtml = `<div style="margin-top:8px;"><a class="btn sm ghost" href="${esc(its.compositionUrl)}" target="_blank">${icon('edit',14)} View composition</a></div>`;
    }
    const actions = [];
    if (!hasFootage) {
      actions.push(`<button class="btn sm primary" onclick="prodAttach(${i.id})">Attach footage</button>`);
    } else {
      actions.push(`<button class="btn sm ${hasPlan ? '' : 'primary'}" onclick="prodPlan(${i.id})">${hasPlan ? 'Re-plan' : 'Plan snapshots'}</button>`);
      if (hasPlan) actions.push(`<button class="btn sm" onclick="openPlanEditor(${i.id})">${icon('edit',14)} Edit plan</button>`);
      if (planGate) actions.push(`<button class="btn sm primary" onclick="prodApprovePlan(${i.id})">Approve plan</button>`);
      if (planApproved) {
        actions.push(`<button class="btn sm" onclick="prodPreview(${i.id})" id="btnPreview-${i.id}">Preview</button>`);
        actions.push(`<button class="btn sm primary" onclick="prodEdit(${i.id})" id="btnEdit-${i.id}">Final render</button>`);
      }
      if (hasRender && !assetApproved) actions.push(`<button class="btn sm" onclick="prodRequestReview(${i.id})">Request review</button>`);
      if (assetApproved && i.status !== 'scheduled') actions.push(`<button class="btn sm primary" onclick="prodSchedule(${i.id})">Schedule</button>`);
      actions.push(`<button class="btn sm ghost" onclick="prodAttach(${i.id})">Replace footage</button>`);
    }
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div><strong>${esc(i.title)}</strong> ${statusBadge(i.status)}</div>
          <div class="row">
            <button class="btn sm" onclick="prodWorkspace(${i.id})">Workspace</button>
            ${actions.join('')}
          </div>
        </div>
        <div class="meta" style="margin-top:6px;">id ${i.id} · ${esc(i.pillar||'—')} · ${i.desired_length_seconds||'—'}s ${renderStatus}</div>
        ${stillsHtml}
        ${compHtml}
        ${renderRendersHtml(ia)}
      </div>
    `;
  }).join('') || empty('No production items','Items reach here after script approval.');
  c.innerHTML = `
    <div class="row" style="margin-bottom:12px;">
      <button class="btn sm" onclick="runProd('list_footage')">List footage</button>
    </div>
    <div class="stack">${cards}</div>
  `;
  prod.forEach((i) => pollRenderStatus(i.id));
};

window.runProd = async (action) => {
  if (action === 'list_footage') {
    const r = await api('/api/footage');
    const files = r.files || [];
    const body = files.length ? `<ul style="max-height:320px;overflow:auto;">${files.map(f=>`<li class="meta" style="padding:4px 0;word-break:break-all;">${esc(f.path)}</li>`).join('')}</ul>` : '<p class="meta">No footage found in data/</p>';
    openModal('Available footage', body, { confirmLabel: 'Close', onConfirm: async () => {} });
  }
};
window.prodAttach = async (id) => {
  openModal('Attach footage', '<div class="stack"><div class="card-flat"><div class="label">Footage path (relative or absolute)</div><input class="input" id="m-path" placeholder="data/item-1/source.mp4" /></div></div>', {
    confirmLabel: 'Attach',
    onConfirm: async () => {
      const fp = document.getElementById('m-path').value.trim();
      if (!fp) { toast('Path required', 'error'); return false; }
      try { const r = await api('/api/actions/production', { method:'POST', body: { action:'process_footage', targetId:id, filePath:fp } }); toast(JSON.stringify(r)); render(); }
      catch (e) { toast(e.message,'error'); return false; }
    },
  });
};
window.prodPlan = async (id) => {
  try {
    const r = await api('/api/actions/production', { method:'POST', body: { action:'plan_snapshots', targetId:id } });
    toast('Plan rendered: ' + (r.summary?JSON.stringify(r.summary):'ok')); render();
  } catch (e) { toast(e.message,'error'); }
};
window.prodApprovePlan = async (id) => {
  try { await api('/api/actions/production', { method:'POST', body: { action:'approve_snapshot_plan', targetId:id } }); toast('Plan approved'); render(); } catch (e) { toast(e.message,'error'); }
};
window.prodPreview = async (id) => {
  try {
    const r = await api('/api/actions/production', { method:'POST', body: { action:'preview', targetId:id } });
    if (r.started) {
      toast('Preview render started'); pollRenderStatus(id, 'preview');
    } else {
      toast('Preview: ' + (r.path||'done')); render();
    }
  } catch (e) { toast(e.message,'error'); }
};
window.prodEdit = async (id) => {
  openModal('Final render', '<p class="meta">Run the full final render? This may take several minutes.</p>', {
    confirmLabel: 'Render',
    onConfirm: async () => {
      try {
        const r = await api('/api/actions/production', { method:'POST', body: { action:'edit', targetId:id } });
        if (r.started) { toast('Final render started'); pollRenderStatus(id, 'edit'); }
        else { toast('Render: ' + (r.assets?r.assets+' asset(s)': (r.path||'done'))); render(); }
      } catch (e) { toast(e.message,'error'); return false; }
    },
  });
};
async function pollRenderStatus(id, action) {
  // only poll if a render is actually running or was just started
  try {
    const r0 = await api(`/api/production/render-status?targetId=${id}`);
    if (!r0.running && !(r0.status && r0.status.state === 'running')) {
      // no active render; do nothing
      return;
    }
  } catch { return; }
  const statusEl = document.getElementById(`renderStatus-${id}`);
  const btnP = document.getElementById(`btnPreview-${id}`);
  const btnE = document.getElementById(`btnEdit-${id}`);
  if (btnP) btnP.disabled = true;
  if (btnE) btnE.disabled = true;
  const tick = async () => {
    try {
      const r = await api(`/api/production/render-status?targetId=${id}`);
      const st = r.status;
      const label = st && st.state === 'running' ? `Rendering (${action})…` : (st && st.state === 'done' ? 'Render done' : (st && st.state === 'error' ? 'Render failed' : 'Rendering…'));
      if (statusEl) statusEl.textContent = label;
      if (st && (st.state === 'done' || st.state === 'error')) {
        if (btnP) btnP.disabled = false;
        if (btnE) btnE.disabled = false;
        if (statusEl) statusEl.textContent = '';
        if (st.state === 'done') { toast(action === 'preview' ? 'Preview rendered' : 'Final render complete'); render(); }
        else { toast(st.error || 'Render failed', 'error'); }
        return;
      }
      setTimeout(tick, 2000);
    } catch (e) {
      if (statusEl) statusEl.textContent = '';
      if (btnP) btnP.disabled = false;
      if (btnE) btnE.disabled = false;
      toast(e.message, 'error');
    }
  };
  tick();
}
window.prodRequestReview = async (id) => {
  try { await api('/api/actions/production', { method:'POST', body: { action:'request_review', targetId:id } }); toast('Review requested'); render(); } catch (e) { toast(e.message,'error'); }
};
window.prodSchedule = async (id) => {
  try { await api('/api/actions/production', { method:'POST', body: { action:'schedule', targetId:id } }); toast('Scheduled'); render(); } catch (e) { toast(e.message,'error'); }
};

window.prodEditScript = async (id) => {
  try {
    const { item } = await api(`/api/content-items/${id}`);
    let s = {};
    try { s = typeof item.script === 'string' ? JSON.parse(item.script) : (item.script || {}); } catch { s = {}; }
    openDrawer(`
      <h2 style="margin-bottom:4px;">Edit script</h2>
      <div class="meta" style="margin-bottom:12px;">${esc(item.title)} · id ${item.id}</div>
      <div class="stack">
        <div><div class="label">Hook</div><textarea id="es-hook" class="textarea" style="min-height:60px;">${esc(s.hook||'')}</textarea></div>
        <div><div class="label">Script (spoken words)</div><textarea id="es-script" class="textarea" style="min-height:340px;">${esc(s.script||'')}</textarea></div>
        <div><div class="label">CTA</div><input id="es-cta" class="input" value="${esc(s.cta||'')}" /></div>
        <div><div class="label">Shot notes</div><textarea id="es-shot" class="textarea" style="min-height:60px;">${esc(s.shot_notes||'')}</textarea></div>
        <div class="row" style="gap:8px;">
          <button class="btn primary" onclick="saveProdScript(${id})">Save script</button>
          <button class="btn ghost" onclick="prodWorkspace(${id})">Cancel</button>
        </div>
        <p class="meta">Saving changes the spoken words the captions align to. Re-plan and re-render after editing so beats stay in sync.</p>
      </div>
    `);
  } catch (e) { toast(e.message, 'error'); }
};
window.saveProdScript = async (id) => {
  try {
    const { item } = await api(`/api/content-items/${id}`);
    let s = {};
    try { s = typeof item.script === 'string' ? JSON.parse(item.script) : (item.script || {}); } catch { s = {}; }
    const script = {
      ...s,
      hook: document.getElementById('es-hook').value.trim(),
      script: document.getElementById('es-script').value.trim(),
      cta: document.getElementById('es-cta').value.trim(),
      shot_notes: document.getElementById('es-shot').value.trim(),
    };
    await api(`/api/content-items/${id}`, { method: 'PATCH', body: { script } });
    toast('Script saved'); prodWorkspace(id);
  } catch (e) { toast(e.message, 'error'); }
};

window.prodWorkspace = async (id) => {
  openDrawer('<div class="loading"><span class="spinner"></span> Loading workspace…</div>');
  try {
    const [{ item }, planRes, stillsRes, { assets }, { gates }] = await Promise.all([
      api(`/api/content-items/${id}`),
      api(`/api/production/plan?targetId=${id}`).catch(() => ({ plan: null })),
      api(`/api/production/plan-stills?targetId=${id}`).catch(() => ({ files: [], compositionUrl: null })),
      api('/api/assets'),
      api('/api/gates'),
    ]);
    const ia = (assets || []).filter((a) => a.content_item_id === id);
    const hasFootage = !!item.recording_id;
    const hasPlan = !!planRes.plan;
    const planPending = (gates || []).some((g) => g.gate_type === 'snapshot_plan_review' && g.target_type === 'content_item' && g.target_id === id && g.status === 'pending');
    const planApproved = (gates || []).some((g) => g.gate_type === 'snapshot_plan_review' && g.target_type === 'content_item' && g.target_id === id && g.status === 'approved');
    const assetApproved = (gates || []).some((g) => g.gate_type === 'asset_review' && g.target_type === 'content_item' && g.target_id === id && g.status === 'approved');
    const hasRender = ia.length > 0;
    // script
    let scriptObj = null;
    try { scriptObj = typeof item.script === 'string' ? JSON.parse(item.script) : item.script; } catch { scriptObj = null; }
    // plan timeline
    const plan = planRes.plan;
    const segments = (plan && Array.isArray(plan.segments)) ? plan.segments : [];
    const segHtml = segments.length ? segments.map((s, i) => {
      const kind = s.kind || 'snapshot';
      const cls = kind === 'footage' ? 'info' : (kind === 'clip' ? 'warn' : 'accent');
      const beats = Array.isArray(s.beats) ? s.beats : [];
      const beatsHtml = beats.length ? `<div style="margin-left:12px;margin-top:4px;">${beats.map((b) => `<div class="meta" style="padding:2px 0;">${esc(b.start)}–${esc(b.end)}s · ${esc(b.action && b.action.op)} · ${esc((b.action && (Array.isArray(b.action.target)?b.action.target.join(','):b.action.target)) || '')} — ${esc((b.spoken||'').slice(0,60))}</div>`).join('')}</div>` : '';
      const extra = kind === 'snapshot' ? `<div class="meta" style="margin-left:12px;">concept: ${esc(s.concept || (s.diagram && s.diagram.name) || (s.sceneGraph ? 'sceneGraph' : '—'))} · slots: ${esc((s.sceneGraph ? '' : (s.concept ? (s.composition ? Object.keys(s.composition).join(',') : '') : '')) || '—')}</div>` : (kind === 'clip' ? `<div class="meta" style="margin-left:12px;">src: ${esc(s.src)} · why: ${esc(s.why)}</div>` : '');
      return `<div class="card-flat" style="margin-bottom:8px;">
        <div class="row" style="justify-content:space-between;">
          <div><strong>${esc(s.id)}</strong> ${badge(kind, cls)} ${badge((s.start||0)+'–'+(s.end||0)+'s')}</div>
        </div>
        ${extra}${beatsHtml}
      </div>`;
    }).join('') : '<p class="meta">No plan saved yet.</p>';
    // validation
    const validateHtml = `<div style="margin-top:12px;"><button class="btn sm" onclick="validatePlan(${id})">Validate plan</button> <span id="validateResult-${id}" class="meta"></span></div>
      <div style="margin-top:12px;"><button class="btn sm primary" onclick="openPlanEditor(${id})">${icon('edit',12)} Edit plan</button></div>`;
    // script
    let scriptHtml = '<p class="meta">No script.</p>';
    if (scriptObj) {
      scriptHtml = `
        ${scriptObj.hook ? `<div class="card-flat" style="margin-bottom:8px;"><div class="label">Hook</div><blockquote style="margin:4px 0;">${esc(scriptObj.hook)}</blockquote></div>` : ''}
        ${scriptObj.script ? `<div class="card-flat" style="margin-bottom:8px;"><div class="label">Script</div><pre class="code" style="max-height:200px;">${esc(scriptObj.script)}</pre></div>` : ''}
        ${Array.isArray(scriptObj.points) && scriptObj.points.length ? `<div class="card-flat" style="margin-bottom:8px;"><div class="label">Points</div>${scriptObj.points.map((p, idx) => `<div style="padding:4px 0;"><strong>${idx+1}. ${esc(p.title)}</strong><div class="meta">${esc(p.detail||'')}</div></div>`).join('')}</div>` : ''}
        ${scriptObj.cta ? `<div class="card-flat" style="margin-bottom:8px;"><div class="label">CTA</div><strong>${esc(scriptObj.cta)}</strong></div>` : ''}
        ${scriptObj.shot_notes ? `<div class="card-flat" style="margin-bottom:8px;"><div class="label">Shot notes</div><div class="meta">${esc(scriptObj.shot_notes)}</div></div>` : ''}
      `;
    }
    // stills
    const stills = stillsRes.files || [];
    const stillsHtml = stills.length ? `<div class="row" style="gap:8px;flex-wrap:wrap;">${stills.map(f=>`<a href="${esc(f.url)}" target="_blank"><img src="${esc(f.url)}" alt="${esc(f.name)}" style="width:110px;height:auto;border-radius:8px;border:1px solid var(--border);" /></a>`).join('')}</div>` : '<p class="meta">No plan stills yet. Run "Plan snapshots".</p>';
    // renders
    const rendersHtml = ia.length ? ia.map(a => { const u = mediaUrl(a.file_path); return u ? `<a class="btn sm" href="${esc(u)}" target="_blank">${icon('production',14)} ${esc(a.platform)} ${a.width||'?'}×${a.height||'?'}</a>` : `<span class="meta">${esc(a.file_path)}</span>`; }).join(' ') : '<p class="meta">No renders yet.</p>';
    // metadata
    const metaHtml = `
      <div class="grid grid-2">
        <div class="card-flat"><div class="label">Status</div>${statusBadge(item.status)}</div>
        <div class="card-flat"><div class="label">Pillar</div>${esc(item.pillar||'—')}</div>
        <div class="card-flat"><div class="label">Format</div>${esc(item.format||'—')}</div>
        <div class="card-flat"><div class="label">Length</div>${item.desired_length_seconds||'—'}s</div>
        <div class="card-flat"><div class="label">Hook style</div>${esc(item.hook_style||'—')}</div>
        <div class="card-flat"><div class="label">Footage</div>${esc(item.recording_id ? 'attached (#'+item.recording_id+')' : 'none')}</div>
      </div>
    `;
    const actions = [];
    actions.push(`<button class="btn sm ghost" onclick="prodEditScript(${id})">${icon('edit',14)} Edit script</button>`);
    if (!hasFootage) {
      actions.push(`<button class="btn sm primary" onclick="prodAttach(${id})">Attach footage</button>`);
    } else {
      actions.push(`<button class="btn sm ${hasPlan ? '' : 'primary'}" onclick="prodPlan(${id})">${hasPlan ? 'Re-plan' : 'Plan snapshots'}</button>`);
      if (hasPlan) actions.push(`<button class="btn sm" onclick="openPlanEditor(${id})">${icon('edit',14)} Edit plan</button>`);
      if (planPending) actions.push(`<button class="btn sm primary" onclick="prodApprovePlan(${id})">Approve plan</button>`);
      if (planApproved) {
        actions.push(`<button class="btn sm" onclick="prodPreview(${id})">Preview</button>`);
        actions.push(`<button class="btn sm primary" onclick="prodEdit(${id})">Final render</button>`);
      }
      if (hasRender && !assetApproved) actions.push(`<button class="btn sm" onclick="prodRequestReview(${id})">Request review</button>`);
      if (assetApproved && item.status !== 'scheduled') actions.push(`<button class="btn sm primary" onclick="prodSchedule(${id})">Schedule</button>`);
      actions.push(`<button class="btn sm ghost" onclick="prodAttach(${id})">Replace footage</button>`);
    }
    const body = `
      <h2 style="margin-bottom:4px;">${esc(item.title)}</h2>
      <div class="meta" style="margin-bottom:12px;">id ${item.id}</div>
      ${metaHtml}
      <div style="margin-top:16px;"><div class="label">Script</div>${scriptHtml}</div>
      <div style="margin-top:16px;"><div class="label">Production plan — sequence</div>
        <div style="margin-top:8px;">${segHtml}</div>
        ${validateHtml}
      </div>
      <div style="margin-top:16px;"><div class="label">Plan stills</div>${stillsHtml}</div>
      <div style="margin-top:16px;"><div class="label">Renders</div><div class="row" style="gap:8px;flex-wrap:wrap;">${rendersHtml}</div></div>
      <div style="margin-top:16px;"><div class="row" style="gap:8px;flex-wrap:wrap;">${actions.join('')}</div></div>
    `;
    openDrawer(body);
  } catch (e) {
    openDrawer(`<div class="card"><strong>Error:</strong> ${esc(e.message)}</div>`);
  }
};

// ---- plan editor (structured override; no raw JSON) ----
window._planSegments = [];
window._planMenu = {};
window._planFootage = [];

const PLAN_CONCEPT_NAMES = ['title-steps', 'equation', 'keypoint', 'worksheet', 'decision', 'bars', 'quote', 'cta'];
const PLAN_LIST_TYPES = { steps: 'text', chips: 'text', columns: 'text', terms: 'triple', branches: 'branch', bars: 'bar' };

function planVal(card, key) {
  const el = card.querySelector(`[data-cf="${key}"]`);
  return el ? el.value.trim() : '';
}
function planNumVal(card, key, fallback = 0) {
  const el = card.querySelector(`[data-cf="${key}"]`);
  if (!el || el.value.trim() === '') return fallback;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : fallback;
}
function planRows(card, key) {
  return [...card.querySelectorAll(`[data-cf-list="${key}"] [data-row]`)];
}
function planListTextValues(card, key) {
  return planRows(card, key).map((r) => r.querySelector('[data-li]').value.trim()).filter(Boolean);
}
function planTripleValues(card, key) {
  return planRows(card, key).map((r) => ({
    value: r.querySelector('[data-tri="value"]').value.trim(),
    unit: r.querySelector('[data-tri="unit"]').value.trim(),
    label: r.querySelector('[data-tri="label"]').value.trim(),
  })).filter((o) => o.value || o.unit || o.label);
}
function planTripleValue(card, key) {
  const row = card.querySelector(`[data-cf-triple="${key}"]`);
  if (!row) return null;
  const value = row.querySelector('[data-tri="value"]').value.trim();
  const unit = row.querySelector('[data-tri="unit"]').value.trim();
  const label = row.querySelector('[data-tri="label"]').value.trim();
  return (value || unit || label) ? { value, unit, label } : null;
}

function planTextField(key, label, value, { textarea = false, placeholder = '' } = {}) {
  const v = value ?? '';
  return `<div class="label">${esc(label)}</div>${textarea
    ? `<textarea class="textarea" data-cf="${key}" style="min-height:56px;" placeholder="${esc(placeholder)}">${esc(v)}</textarea>`
    : `<input class="input" data-cf="${key}" value="${esc(v)}" placeholder="${esc(placeholder)}" />`}`;
}
function planNumberField(key, label, value) {
  return `<div class="label">${esc(label)}</div><input class="input" data-cf="${key}" type="number" step="any" value="${value ?? ''}" />`;
}
function planListTextField(key, label, arr, idx) {
  const rows = (arr || []).map((v, i) => `
    <div class="row" data-row style="margin-bottom:4px;">
      <input class="input" data-li value="${esc(typeof v === 'string' ? v : (v?.label || v?.text || ''))}" style="flex:1;" />
      <button class="btn sm danger" type="button" onclick="planRemoveRow(${idx},'${key}',${i})">${icon('x',12)}</button>
    </div>`).join('');
  return `<div class="label">${esc(label)}</div><div data-cf-list="${key}">${rows}</div>
    <button class="btn sm" type="button" onclick="planAddRow(${idx},'${key}')" style="margin-top:4px;">${icon('plus',12)} Add</button>`;
}
function planTripleListField(key, label, arr, idx) {
  const rows = (arr || []).map((o, i) => `
    <div class="row" data-row style="margin-bottom:4px;">
      <input class="input" data-tri="value" placeholder="value" value="${esc(o?.value ?? '')}" style="flex:1;" />
      <input class="input" data-tri="unit" placeholder="unit" value="${esc(o?.unit ?? '')}" style="width:84px;" />
      <input class="input" data-tri="label" placeholder="label" value="${esc(o?.label ?? '')}" style="flex:1.4;" />
      <button class="btn sm danger" type="button" onclick="planRemoveRow(${idx},'${key}',${i})">${icon('x',12)}</button>
    </div>`).join('');
  return `<div class="label">${esc(label)}</div><div data-cf-list="${key}">${rows}</div>
    <button class="btn sm" type="button" onclick="planAddRow(${idx},'${key}')" style="margin-top:4px;">${icon('plus',12)} Add</button>`;
}
function planTripleField(key, label, obj) {
  const o = obj || {};
  return `<div class="label">${esc(label)}</div>
    <div class="row" data-cf-triple="${key}">
      <input class="input" data-tri="value" placeholder="value" value="${esc(o.value ?? '')}" style="flex:1;" />
      <input class="input" data-tri="unit" placeholder="unit" value="${esc(o.unit ?? '')}" style="width:84px;" />
      <input class="input" data-tri="label" placeholder="label" value="${esc(o.label ?? '')}" style="flex:1.4;" />
    </div>`;
}
function planBarListField(key, label, arr, idx) {
  const rows = (arr || []).map((b, i) => `
    <div class="row" data-row style="margin-bottom:4px;">
      <input class="input" data-bar="label" placeholder="label" value="${esc(b?.label ?? '')}" style="flex:1.3;" />
      <input class="input" data-bar="value" type="number" step="any" placeholder="value" value="${b?.value ?? ''}" style="width:88px;" />
      <input class="input" data-bar="max" type="number" step="any" placeholder="max" value="${b?.max ?? ''}" style="width:88px;" />
      <input class="input" data-bar="display" placeholder="display" value="${esc(b?.display ?? '')}" style="width:104px;" />
      <select class="select" data-bar="tone" style="width:96px;">
        ${['ghost','blue','amber'].map((t) => `<option value="${t}" ${b?.tone===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <button class="btn sm danger" type="button" onclick="planRemoveRow(${idx},'${key}',${i})">${icon('x',12)}</button>
    </div>`).join('');
  return `<div class="label">${esc(label)}</div><div data-cf-list="${key}">${rows}</div>
    <button class="btn sm" type="button" onclick="planAddRow(${idx},'${key}')" style="margin-top:4px;">${icon('plus',12)} Add</button>`;
}
function planBarsValues(card, key) {
  return planRows(card, key).map((r) => {
    const value = Number(r.querySelector('[data-bar="value"]').value);
    const max = Number(r.querySelector('[data-bar="max"]').value);
    const display = r.querySelector('[data-bar="display"]').value.trim();
    return {
      label: r.querySelector('[data-bar="label"]').value.trim(),
      value: Number.isFinite(value) ? value : 0,
      max: Number.isFinite(max) && max > 0 ? max : 1,
      ...(display ? { display } : {}),
      tone: r.querySelector('[data-bar="tone"]').value,
    };
  }).filter((b) => b.label);
}
function planBranchListField(key, label, arr, idx) {
  const rows = (arr || []).map((b, i) => `
    <div class="row" data-row style="margin-bottom:4px;">
      <input class="input" data-branch="text" placeholder="branch" value="${esc(b?.text ?? '')}" style="flex:1;" />
      <select class="select" data-branch="tone" style="width:110px;">
        ${['ghost','blue','amber'].map((t) => `<option value="${t}" ${b?.tone===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <button class="btn sm danger" type="button" onclick="planRemoveRow(${idx},'${key}',${i})">${icon('x',12)}</button>
    </div>`).join('');
  return `<div class="label">${esc(label)}</div><div data-cf-list="${key}">${rows}</div>
    <button class="btn sm" type="button" onclick="planAddRow(${idx},'${key}')" style="margin-top:4px;">${icon('plus',12)} Add</button>`;
}
function planBranchValues(card, key) {
  return planRows(card, key).map((r) => ({
    text: r.querySelector('[data-branch="text"]').value.trim(),
    tone: r.querySelector('[data-branch="tone"]').value,
  })).filter((b) => b.text);
}

const PLAN_CONCEPTS = {
  'title-steps': {
    slots: (c) => [...(c.headline ? ['headline'] : []), ...((c.steps || []).map((_, i) => `step-${i}`))],
    html: (c, idx) => `${planTextField('headline', 'Headline', c.headline)}${planListTextField('steps', 'Steps', c.steps, idx)}`,
    collect: (card) => ({ headline: planVal(card, 'headline') || null, steps: planListTextValues(card, 'steps') }),
  },
  equation: {
    slots: (c) => [...(c.terms || []).map((_, i) => `term-${i}`), ...(c.result ? ['result'] : []), ...(c.note ? ['note'] : [])],
    html: (c, idx) => `${planTripleListField('terms', 'Terms', c.terms, idx)}${planTripleField('result', 'Result', c.result)}${planTripleField('note', 'Note (optional)', c.note)}`,
    collect: (card) => ({
      terms: planTripleValues(card, 'terms'),
      result: planTripleValue(card, 'result'),
      note: planTripleValue(card, 'note'),
    }),
  },
  keypoint: {
    slots: (c) => ['text', ...(c.chips || []).map((_, i) => `chip-${i}`)],
    html: (c, idx) => `${planTextField('text', 'Statement', c.text, { textarea: true })}${planListTextField('chips', 'Chips', c.chips, idx)}`,
    collect: (card) => ({ text: planVal(card, 'text'), chips: planListTextValues(card, 'chips') }),
  },
  worksheet: {
    slots: (c) => [...(c.headline ? ['headline'] : []), 'header', ...Array.from({ length: Number(c.rows) || 0 }, (_, i) => `row-${i}`)],
    html: (c, idx) => `${planTextField('headline', 'Headline', c.headline)}${planListTextField('columns', 'Columns', c.columns, idx)}${planNumberField('rows', 'Rows', c.rows ?? 2)}`,
    collect: (card) => ({ headline: planVal(card, 'headline') || null, columns: planListTextValues(card, 'columns'), rows: planNumVal(card, 'rows', 2) }),
  },
  decision: {
    slots: (c) => ['question', ...(c.branches || []).map((_, i) => `branch-${i}`)],
    html: (c, idx) => `${planTextField('question', 'Question', c.question, { textarea: true })}${planBranchListField('branches', 'Branches', c.branches, idx)}`,
    collect: (card) => ({ question: planVal(card, 'question'), branches: planBranchValues(card, 'branches') }),
  },
  bars: {
    slots: (c) => [...(c.headline ? ['headline'] : []), ...(c.bars || []).map((_, i) => `bar-${i}`)],
    html: (c, idx) => `${planTextField('headline', 'Headline', c.headline)}${planBarListField('bars', 'Bars', c.bars, idx)}`,
    collect: (card) => ({ headline: planVal(card, 'headline') || null, bars: planBarsValues(card, 'bars') }),
  },
  quote: {
    slots: (c) => [...(c.struck ? ['struck'] : []), 'text'],
    html: (c) => `${planTextField('struck', 'Struck line (optional)', c.struck)}${planTextField('text', 'Quote', c.text, { textarea: true })}`,
    collect: (card) => ({ struck: planVal(card, 'struck') || null, text: planVal(card, 'text') }),
  },
  cta: {
    slots: (c) => ['text', ...(c.handle ? ['handle'] : []), ...(c.sub ? ['sub'] : [])],
    html: (c) => `${planTextField('text', 'Close', c.text, { textarea: true })}${planTextField('handle', 'Handle', c.handle)}${planTextField('sub', 'Sub line', c.sub)}`,
    collect: (card) => ({ text: planVal(card, 'text'), handle: planVal(card, 'handle') || null, sub: planVal(card, 'sub') || null }),
  },
};

function defaultComposition(concept) {
  switch (concept) {
    case 'title-steps': return { headline: '', steps: [''] };
    case 'equation': return { terms: [{ value: '', unit: '', label: '' }], result: { value: '', unit: '', label: '' } };
    case 'keypoint': return { text: '', chips: [] };
    case 'worksheet': return { headline: '', columns: [''], rows: 2 };
    case 'decision': return { question: '', branches: [{ text: '', tone: 'ghost' }] };
    case 'bars': return { headline: '', bars: [{ label: '', value: 0, max: 1, display: '', tone: 'ghost' }] };
    case 'quote': return { struck: '', text: '' };
    case 'cta': return { text: '', handle: '', sub: '' };
    default: return {};
  }
}

function specFormHtml(value, path, idx) {
  if (Array.isArray(value)) {
    const rows = value.map((v, i) => `<div class="card-flat" data-spec-row style="margin-bottom:6px;">
      <div class="row" style="justify-content:space-between;"><span class="meta">Item ${i + 1}</span><button class="btn sm danger" type="button" onclick="specRemoveItem(${idx},'${esc(path)}',${i})">${icon('x',12)}</button></div>
      ${specFormHtml(v, path ? `${path}.${i}` : String(i), idx)}
    </div>`).join('');
    return `<div data-spec-array="${esc(path)}">${rows}</div><button class="btn sm" type="button" onclick="specAddItem(${idx},'${esc(path)}')" style="margin-top:4px;">${icon('plus',12)} Add item</button>`;
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => `<div style="margin-top:6px;"><div class="label">${esc(k)}</div>${specFormHtml(v, path ? `${path}.${k}` : k, idx)}</div>`).join('') || '<p class="meta">No fields.</p>';
  }
  if (typeof value === 'boolean') return `<label class="chipcheck"><input type="checkbox" data-spec="${esc(path)}" ${value ? 'checked' : ''} /> ${esc(path.split('.').pop())}</label>`;
  if (typeof value === 'number') return `<input class="input" type="number" step="any" data-spec="${esc(path)}" value="${value}" />`;
  return `<input class="input" data-spec="${esc(path)}" value="${esc(value ?? '')}" />`;
}
function setSpecPath(root, path, val) {
  const parts = path.split('.');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (Array.isArray(cur)) {
      const n = Number(k);
      while (cur.length <= n) cur.push({});
      cur = cur[n];
    } else {
      if (cur[k] === undefined || cur[k] === null) cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      cur = cur[k];
    }
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) cur[Number(last)] = val; else cur[last] = val;
}
function getSpecPath(root, path) {
  if (!path) return root;
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), root);
}
function collectSpec(card) {
  const out = {};
  card.querySelectorAll('[data-spec]').forEach((el) => {
    const path = el.getAttribute('data-spec');
    if (!path) return;
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.type === 'number') val = el.value.trim() === '' ? 0 : Number(el.value);
    else val = el.value;
    setSpecPath(out, path, val);
  });
  return out;
}

function planBeatsHtml(seg, idx, slots) {
  const beats = Array.isArray(seg.beats) ? seg.beats : [];
  const ops = window._planMenu?.plan?.beatActions || ['introduce', 'reveal', 'hold'];
  const rows = beats.map((b, i) => {
    const target = Array.isArray(b.action?.target) ? b.action.target : (b.action?.target ? [b.action.target] : []);
    const choices = slots ? [...new Set([...slots, ...target])] : null;
    const targetsHtml = choices ? `
      <div class="row" style="gap:4px;flex-wrap:wrap;margin-top:4px;">
        ${choices.map((s) => `<label class="chipcheck"><input type="checkbox" data-bf="target" value="${esc(s)}" ${target.includes(s) ? 'checked' : ''} /> ${esc(s)}</label>`).join('')}
      </div>` : `<input class="input" data-bf="targetText" placeholder="slot names, comma separated" value="${esc(target.join(', '))}" />`;
    const opList = ops.includes(b.action?.op) ? ops : [b.action?.op, ...ops].filter(Boolean);
    const cue = typeof b.action?.cue === 'string' ? b.action.cue : '';
    return `<div class="beat-row" data-beat>
      <div class="row" style="justify-content:space-between;margin-bottom:6px;">
        <strong class="meta">Beat ${i + 1}</strong>
        <button class="btn sm danger" type="button" onclick="removeBeat(${idx},${i})">${icon('x',12)}</button>
      </div>
      <div class="grid grid-2">
        <div><div class="label">ID</div><input class="input" data-bf="id" value="${esc(b.id ?? '')}" /></div>
        <div><div class="label">Action</div><select class="select" data-bf="op">${opList.map((o) => `<option value="${o}" ${b.action?.op === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
        <div><div class="label">Start (s)</div><input class="input" data-bf="start" type="number" step="0.1" value="${b.start ?? ''}" /></div>
        <div><div class="label">End (s)</div><input class="input" data-bf="end" type="number" step="0.1" value="${b.end ?? ''}" /></div>
      </div>
      <div style="margin-top:6px;"><div class="label">Spoken narration on this beat</div><textarea class="textarea" data-bf="spoken" style="min-height:48px;">${esc(b.spoken ?? '')}</textarea></div>
      <div style="margin-top:6px;"><div class="label">Targets</div>${targetsHtml}</div>
      <div style="margin-top:6px;"><div class="label">Cue (optional phrase)</div>
        <div class="row"><input class="input" data-bf="cue" value="${esc(cue)}" style="flex:1;" />
          ${b.action?.cue !== undefined ? '<label class="chipcheck"><input type="checkbox" data-bf="clearCue" /> clear</label>' : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  return `<div class="label">Beats</div><div data-beats>${rows || '<p class="meta">No beats yet.</p>'}</div>
    <button class="btn sm" type="button" onclick="addBeat(${idx})" style="margin-top:6px;">${icon('plus',12)} Add beat</button>`;
}

function planKindFields(seg, idx) {
  const kind = seg.kind || 'snapshot';
  if (kind === 'footage') {
    return '<p class="meta">Footage is the face. The engine derives its position from the narration; adjust start/end only to override.</p>';
  }
  if (kind === 'clip') {
    const files = window._planFootage || [];
    return `
      <div><div class="label">Video file</div>
        <input class="input" data-field="src" list="planFootageList" value="${esc(seg.src ?? '')}" placeholder="data/item-4/screen/rec.mp4" />
        <datalist id="planFootageList">${files.map((f) => `<option value="${esc(f.path)}">${esc(f.name)}</option>`).join('')}</datalist>
      </div>
      <div style="margin-top:6px;"><div class="label">Why this clip</div><textarea class="textarea" data-field="why" style="min-height:56px;">${esc(seg.why ?? '')}</textarea></div>
      <div class="grid grid-2" style="margin-top:6px;">
        <div><div class="label">Source in (s)</div><input class="input" data-field="sourceIn" type="number" step="0.1" value="${seg.sourceIn ?? 0}" /></div>
        <div><div class="label">Source out (s)</div><input class="input" data-field="sourceOut" type="number" step="0.1" value="${seg.sourceOut ?? 0}" /></div>
      </div>
      <p class="meta" style="margin-top:4px;">A clip plays 1×, so its on-screen length must equal source out − source in.</p>`;
  }
  const visual = seg.diagram ? 'diagram' : 'concept';
  const head = `
    <div class="row" style="gap:14px;margin-bottom:8px;">
      <label class="chipcheck"><input type="radio" name="visual-${idx}" value="concept" ${visual === 'concept' ? 'checked' : ''} onchange="onVisualChange(${idx})" /> Concept</label>
      <label class="chipcheck"><input type="radio" name="visual-${idx}" value="diagram" ${visual === 'diagram' ? 'checked' : ''} onchange="onVisualChange(${idx})" /> Diagram</label>
    </div>`;
  if (visual === 'diagram') {
    const layouts = window._planMenu?.plan?.diagrams || [];
    const name = seg.diagram?.name || (layouts[0] && layouts[0].name) || 'flow';
    const info = layouts.find((l) => l.name === name);
    const slots = null;
    return `${head}
      <div><div class="label">Layout</div><select class="select" data-field="diagramName" onchange="onDiagramChange(${idx})">
        ${layouts.map((l) => `<option value="${esc(l.name)}" ${l.name === name ? 'selected' : ''}>${esc(l.name)} — ${esc(l.what || '')}</option>`).join('')}
      </select></div>
      ${info && info.fields ? `<p class="meta" style="margin-top:4px;">Fields: ${esc(info.fields.join(', '))}</p>` : ''}
      <div style="margin-top:8px;">${specFormHtml(seg.diagram?.spec || {}, '', idx)}</div>
      <div style="margin-top:10px;">${planBeatsHtml(seg, idx, slots)}</div>`;
  }
  const concept = PLAN_CONCEPT_NAMES.includes(seg.concept) ? seg.concept : 'keypoint';
  const def = PLAN_CONCEPTS[concept];
  const comp = seg.composition || {};
  const slots = def.slots(comp);
  return `${head}
    <div><div class="label">Concept</div><select class="select" data-field="concept" onchange="onConceptChange(${idx})">
      ${PLAN_CONCEPT_NAMES.map((c) => `<option value="${c}" ${c === concept ? 'selected' : ''}>${c}</option>`).join('')}
    </select></div>
    <div style="margin-top:8px;">${def.html(comp, idx)}</div>
    <div style="margin-top:10px;">${planBeatsHtml(seg, idx, slots)}</div>`;
}

function planSegmentCard(seg, idx) {
  const kind = seg.kind || 'snapshot';
  const transition = (seg.transitionOut && seg.transitionOut.technique) || 'crossfade';
  const transitions = window._planMenu?.plan?.transitions || ['crossfade', 'cut-the-curve', 'zoom-through', 'blur-crossfade', 'push-slide', 'none'];
  return `<div class="card-flat seg-card" style="margin-bottom:12px;" data-seg-idx="${idx}">
    <div class="row" style="justify-content:space-between;margin-bottom:8px;">
      <div class="row" style="gap:6px;"><strong>Segment ${idx + 1}</strong>${badge(kind, kind === 'footage' ? 'info' : kind === 'clip' ? 'warn' : 'accent')}</div>
      <div class="row" style="gap:4px;">
        <button class="btn sm ghost" type="button" title="Move up" onclick="moveSegment(${idx},-1)" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn sm ghost" type="button" title="Move down" onclick="moveSegment(${idx},1)" ${idx === window._planSegments.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn sm danger" type="button" onclick="removeSegment(${idx})">${icon('x',12)}</button>
      </div>
    </div>
    <div class="grid grid-2">
      <div><div class="label">ID</div><input class="input" data-field="id" value="${esc(seg.id ?? '')}" /></div>
      <div><div class="label">Kind</div><select class="select" data-field="kind" onchange="onKindChange(this,${idx})">
        <option value="footage" ${kind === 'footage' ? 'selected' : ''}>Footage (face)</option>
        <option value="snapshot" ${kind === 'snapshot' ? 'selected' : ''}>Snapshot (b-roll)</option>
        <option value="clip" ${kind === 'clip' ? 'selected' : ''}>Clip (real video)</option>
      </select></div>
      <div><div class="label">Start (s)</div><input class="input" data-field="start" type="number" step="0.1" value="${seg.start ?? ''}" /></div>
      <div><div class="label">End (s)</div><input class="input" data-field="end" type="number" step="0.1" value="${seg.end ?? ''}" /></div>
    </div>
    <div style="margin-top:10px;">${planKindFields(seg, idx)}</div>
    <div style="margin-top:8px;"><div class="label">Transition out</div>
      <select class="select" data-field="transition">${transitions.map((t) => `<option value="${esc(t)}" ${transition === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    </div>
  </div>`;
}

function collectBeats(card) {
  return [...card.querySelectorAll('[data-beat]')].map((row) => {
    const f = (k) => row.querySelector(`[data-bf="${k}"]`);
    const action = { op: f('op')?.value || 'introduce' };
    const boxes = [...row.querySelectorAll('[data-bf="target"]:checked')].map((x) => x.value);
    const targetText = f('targetText')?.value || '';
    const targets = boxes.length ? boxes : targetText.split(',').map((s) => s.trim()).filter(Boolean);
    if (targets.length) action.target = targets;
    const cue = (f('cue')?.value || '').trim();
    if (f('clearCue')?.checked) action.cue = undefined;
    else if (cue) action.cue = cue;
    return {
      id: (f('id')?.value || '').trim(),
      start: Number(f('start')?.value),
      end: Number(f('end')?.value),
      spoken: (f('spoken')?.value || '').trim(),
      action,
    };
  });
}

function collectPlanDom() {
  const container = document.getElementById('planEditorSegments');
  if (!container) return window._planSegments;
  const prev = window._planSegments || [];
  const segs = [];
  container.querySelectorAll('[data-seg-idx]').forEach((card, i) => {
    const g = (f) => card.querySelector(`[data-field="${f}"]`);
    const kind = g('kind')?.value || 'snapshot';
    const old = prev[i] || {};
    const seg = {
      ...old,
      id: (g('id')?.value || '').trim(),
      kind,
      start: Number(g('start')?.value),
      end: Number(g('end')?.value),
    };
    const technique = g('transition')?.value;
    if (technique) seg.transitionOut = { ...(old.transitionOut || {}), technique };
    if (kind === 'snapshot') {
      const visual = card.querySelector('input[type="radio"]:checked')?.value === 'diagram' ? 'diagram' : 'concept';
      delete seg.concept; delete seg.composition; delete seg.diagram;
      if (visual === 'diagram') {
        seg.diagram = { ...(old.diagram || {}), name: g('diagramName')?.value || 'flow', spec: collectSpec(card) };
      } else {
        const concept = g('concept')?.value || 'keypoint';
        seg.concept = concept;
        seg.composition = { ...(old.composition || {}), ...PLAN_CONCEPTS[concept].collect(card) };
      }
      const oldBeats = Array.isArray(old.beats) ? old.beats : [];
      seg.beats = collectBeats(card).map((b, bi) => ({
        ...(oldBeats[bi] || {}),
        ...b,
        action: { ...(oldBeats[bi]?.action || {}), ...b.action },
      }));
    } else if (kind === 'clip') {
      delete seg.concept; delete seg.composition; delete seg.diagram; delete seg.beats;
      seg.src = (g('src')?.value || '').trim();
      seg.why = (g('why')?.value || '').trim();
      const si = (g('sourceIn')?.value || '').trim();
      const so = (g('sourceOut')?.value || '').trim();
      seg.sourceIn = si === '' ? 0 : Number(si);
      seg.sourceOut = so === '' ? seg.sourceIn : Number(so);
    } else {
      delete seg.concept; delete seg.composition; delete seg.diagram;
    }
    segs.push(seg);
  });
  window._planSegments = segs;
  return segs;
}

window.renderPlanSegments = () => {
  const container = document.getElementById('planEditorSegments');
  if (!container) return;
  container.innerHTML = window._planSegments.map((s, i) => planSegmentCard(s, i)).join('') || '<p class="meta">No segments. Click "Add segment".</p>';
};
window.addSegment = () => {
  window.collectPlanDom();
  const n = window._planSegments.length + 1;
  const prev = window._planSegments[window._planSegments.length - 1];
  const start = prev && Number.isFinite(prev.end) ? prev.end : 0;
  window._planSegments.push({ id: `seg-${n}`, kind: 'snapshot', concept: 'keypoint', composition: { text: '', chips: [] }, start, end: start + 5, beats: [] });
  renderPlanSegments();
};
window.removeSegment = (idx) => {
  window.collectPlanDom();
  window._planSegments.splice(idx, 1);
  renderPlanSegments();
};
window.moveSegment = (idx, dir) => {
  window.collectPlanDom();
  const j = idx + dir;
  if (j < 0 || j >= window._planSegments.length) return;
  const [moved] = window._planSegments.splice(idx, 1);
  window._planSegments.splice(j, 0, moved);
  renderPlanSegments();
};
window.addBeat = (idx) => {
  window.collectPlanDom();
  const seg = window._planSegments[idx];
  if (!seg) return;
  seg.beats = Array.isArray(seg.beats) ? seg.beats : [];
  const slots = seg.concept && !seg.diagram ? PLAN_CONCEPTS[seg.concept].slots(seg.composition || {}) : [];
  seg.beats.push({
    id: `b${seg.beats.length + 1}`,
    start: Number.isFinite(seg.start) ? seg.start : 0,
    end: Number.isFinite(seg.end) ? seg.end : 0,
    spoken: '',
    action: { op: 'introduce', ...(slots.length ? { target: [slots[0]] } : {}) },
  });
  renderPlanSegments();
};
window.removeBeat = (idx, i) => {
  window.collectPlanDom();
  const seg = window._planSegments[idx];
  if (!seg || !Array.isArray(seg.beats)) return;
  seg.beats.splice(i, 1);
  renderPlanSegments();
};
window.planAddRow = (idx, key) => {
  window.collectPlanDom();
  const seg = window._planSegments[idx];
  if (!seg) return;
  const comp = seg.composition || (seg.composition = {});
  const arr = Array.isArray(comp[key]) ? comp[key] : (comp[key] = []);
  const type = PLAN_LIST_TYPES[key] || 'text';
  arr.push(type === 'triple' ? { value: '', unit: '', label: '' }
    : type === 'bar' ? { label: '', value: 0, max: 1, display: '', tone: 'ghost' }
      : type === 'branch' ? { text: '', tone: 'ghost' }
        : '');
  renderPlanSegments();
};
window.planRemoveRow = (idx, key, i) => {
  window.collectPlanDom();
  const seg = window._planSegments[idx];
  if (!seg || !Array.isArray(seg.composition?.[key])) return;
  seg.composition[key].splice(i, 1);
  renderPlanSegments();
};
window.onKindChange = (sel, idx) => {
  window.collectPlanDom();
  const seg = window._planSegments[idx];
  if (!seg) return;
  const kind = sel.value;
  seg.kind = kind;
  if (kind === 'clip') {
    const span = (Number(seg.end) || 0) - (Number(seg.start) || 0);
    seg.src = seg.src || '';
    seg.why = seg.why || '';
    seg.sourceIn = seg.sourceIn ?? 0;
    seg.sourceOut = seg.sourceOut ?? (seg.sourceIn + span);
  }
  if (kind === 'snapshot' && !seg.concept && !seg.diagram) {
    seg.concept = 'keypoint';
    seg.composition = defaultComposition('keypoint');
    seg.beats = [];
  }
  if (kind === 'footage') {
    delete seg.concept;
    delete seg.composition;
    delete seg.diagram;
    delete seg.beats;
  }
  renderPlanSegments();
};
window.onConceptChange = (idx) => {
  const card = document.querySelector(`[data-seg-idx="${idx}"]`);
  const next = card?.querySelector('[data-field="concept"]')?.value;
  window.collectPlanDom();
  const seg = window._planSegments[idx];
  if (!seg || !next) return;
  if (seg.concept !== next || !seg.composition) {
    seg.concept = next;
    seg.diagram = undefined;
    seg.composition = defaultComposition(next);
    seg.beats = [];
  }
  renderPlanSegments();
};
window.onVisualChange = (idx) => {
  const card = document.querySelector(`[data-seg-idx="${idx}"]`);
  const visual = card?.querySelector('input[type="radio"]:checked')?.value || 'concept';
  const wasDiagram = !!window._planSegments[idx]?.diagram;
  window.collectPlanDom();
  const seg = window._planSegments[idx];
  if (!seg) return;
  if (visual === 'diagram') {
    if (!seg.diagram) {
      const layouts = window._planMenu?.plan?.diagrams || [];
      seg.diagram = { name: (layouts[0] && layouts[0].name) || 'flow', spec: {} };
      delete seg.concept;
      delete seg.composition;
    }
    if (!wasDiagram) seg.beats = [];
  } else if (seg.diagram || wasDiagram) {
    delete seg.diagram;
    seg.concept = 'keypoint';
    seg.composition = defaultComposition('keypoint');
    seg.beats = [];
  }
  renderPlanSegments();
};
window.onDiagramChange = (idx) => {
  const card = document.querySelector(`[data-seg-idx="${idx}"]`);
  const name = card?.querySelector('[data-field="diagramName"]')?.value;
  window.collectPlanDom();
  const seg = window._planSegments[idx];
  if (!seg || !seg.diagram) return;
  if (seg.diagram.name !== name) {
    seg.diagram = { name, spec: {} };
    seg.beats = [];
  }
  renderPlanSegments();
};
window.specAddItem = (idx, path) => {
  window.collectPlanDom();
  const seg = window._planSegments[idx];
  if (!seg?.diagram) return;
  const arr = path ? getSpecPath(seg.diagram.spec, path) : seg.diagram.spec;
  if (!Array.isArray(arr)) return;
  const last = arr[arr.length - 1];
  arr.push(typeof last === 'number' ? 0 : typeof last === 'object' && last ? JSON.parse(JSON.stringify(last)) : '');
  renderPlanSegments();
};
window.specRemoveItem = (idx, path, i) => {
  window.collectPlanDom();
  const seg = window._planSegments[idx];
  if (!seg?.diagram) return;
  const arr = path ? getSpecPath(seg.diagram.spec, path) : seg.diagram.spec;
  if (!Array.isArray(arr)) return;
  arr.splice(i, 1);
  renderPlanSegments();
};
window.collectPlan = () => {
  const segs = window.collectPlanDom();
  const videoId = (document.getElementById('planVideoId')?.value || '').trim() || 'vid';
  const duration = Number(document.getElementById('planDuration')?.value) || 60;
  return { ...(window._planBase || {}), video: { ...(window._planVideo || {}), id: videoId, duration }, segments: segs };
};
window.openPlanEditor = async (id) => {
  const [planRes, menuRes, footageRes] = await Promise.all([
    api(`/api/production/plan?targetId=${id}`).catch(() => ({ plan: null })),
    api('/api/actions/production', { method: 'POST', body: { action: 'menu', targetId: id } }).catch(() => ({})),
    api('/api/footage').catch(() => ({ files: [] })),
  ]);
  const plan = planRes.plan || { video: { id: 'vid', duration: 60 }, segments: [] };
  window._planBase = planRes.plan || {};
  window._planVideo = (planRes.plan && planRes.plan.video) || {};
  window._planMenu = menuRes || {};
  window._planFootage = (footageRes && footageRes.files) || [];
  window._planSegments = Array.isArray(plan.segments) ? plan.segments.map((s) => JSON.parse(JSON.stringify(s))) : [];
  const videoId = (plan.video && plan.video.id) || 'vid';
  const duration = (plan.video && plan.video.duration) || 60;
  openModal('Edit production plan', `
    <div class="stack">
      <div class="grid grid-2">
        <div><div class="label">Video ID</div><input class="input" id="planVideoId" value="${esc(videoId)}" /></div>
        <div><div class="label">Duration (s)</div><input class="input" id="planDuration" type="number" step="0.1" value="${duration}" /></div>
      </div>
      <p class="meta">Saving records a manual override. The engine still validates the plan.</p>
      <div id="planEditorSegments"></div>
      <button class="btn sm" type="button" onclick="addSegment()" style="margin-top:8px;">${icon('plus',12)} Add segment</button>
    </div>
  `, {
    wide: true,
    confirmLabel: 'Save & validate',
    onConfirm: async () => {
      const plan = window.collectPlan();
      try {
        await api('/api/overrides/plan', { method: 'POST', body: { targetId: id, plan } });
        const v = await api('/api/production/validate-plan', { method: 'POST', body: { targetId: id, plan } });
        if (v.ok) { toast('Plan saved & valid'); render(); return true; }
        toast(`${v.problems.length} issue(s) — review them`, 'error');
        openModal('Plan validation', `<ul style="padding-left:18px;">${v.problems.map((p) => `<li class="meta" style="padding:3px 0;word-break:break-word;">${esc(p)}</li>`).join('')}</ul>`, { confirmLabel: 'Close', onConfirm: async () => {} });
        return false;
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
  renderPlanSegments();
};

window.validatePlan = async (id) => {
  const el = document.getElementById(`validateResult-${id}`);
  if (el) el.textContent = 'Validating…';
  try {
    const r = await api('/api/production/validate-plan', { method: 'POST', body: { targetId: id } });
    if (el) {
      el.textContent = r.ok ? '✓ Valid' : `✗ ${r.problems.length} issue(s)`;
    }
    if (!r.ok) {
      openModal('Plan validation', `<ul style="padding-left:18px;">${r.problems.map(p=>`<li class="meta" style="padding:3px 0;word-break:break-word;">${esc(p)}</li>`).join('')}</ul>`, { confirmLabel: 'Close', onConfirm: async () => {} });
    } else {
      toast('Plan is valid');
    }
  } catch (e) {
    if (el) el.textContent = 'Error';
    toast(e.message, 'error');
  }
};

const GATE_PRIORITY = ['escalation', 'asset_review', 'snapshot_plan_review', 'script_review', 'idea_approval', 'plan_review'];
const GATE_LABELS = {
  escalation: 'Escalations',
  asset_review: 'Asset review',
  snapshot_plan_review: 'Snapshot plan review',
  script_review: 'Script review',
  idea_approval: 'Idea approval',
  plan_review: 'Plan review',
};
const GATE_DESC = {
  escalation: 'Money, reputation, or angry-customer items needing a human.',
  asset_review: 'Finished videos waiting to ship.',
  snapshot_plan_review: 'B-roll plans with still previews waiting on approval.',
  script_review: 'Scripts waiting on a verdict.',
  idea_approval: 'Scored ideas waiting on "spend my face-time?".',
  plan_review: 'Production plans waiting on approval.',
};

views.approvals = async (c) => {
  const [gatesRes, itemsRes, assetsRes, engRes] = await Promise.all([
    api('/api/gates?status=pending'),
    api('/api/content-items'),
    api('/api/assets'),
    api('/api/engagement'),
  ]);
  const gates = gatesRes.gates || [];
  const items = itemsRes.items || [];
  const assets = assetsRes.assets || [];
  const engagement = engRes.items || [];
  const itemById = {}; for (const it of items) itemById[it.id] = it;
  const assetById = {}; for (const a of assets) assetById[a.id] = a;
  const engById = {}; for (const e of engagement) engById[e.id] = e;

  const grouped = {};
  for (const gt of GATE_PRIORITY) grouped[gt] = [];
  for (const g of gates) {
    if (!grouped[g.gate_type]) grouped[g.gate_type] = [];
    grouped[g.gate_type].push(g);
  }
  const orderedTypes = GATE_PRIORITY.filter((t) => (grouped[t] || []).length > 0)
    .concat(Object.keys(grouped).filter((t) => !GATE_PRIORITY.includes(t) && (grouped[t] || []).length > 0));

  const stillsByItem = {};
  const snapGates = (grouped.snapshot_plan_review || []);
  await Promise.all(snapGates.map(async (g) => {
    if (g.target_type === 'content_item') {
      try { stillsByItem[g.target_id] = await api(`/api/production/plan-stills?targetId=${g.target_id}`); }
      catch { stillsByItem[g.target_id] = { files: [] }; }
    }
  }));

  if (!gates.length) {
    c.innerHTML = empty('No pending approvals', 'All gates are decided. Check back later.');
    return;
  }

  const sections = orderedTypes.map((gt) => {
    const gs = grouped[gt] || [];
    const isEsc = gt === 'escalation';
    const borderStyle = isEsc ? 'border-left:4px solid var(--error);' : '';
    const rows = gs.map((g) => {
      let title = '';
      let meta = '';
      let preview = '';
      if (g.target_type === 'content_item') {
        const it = itemById[g.target_id];
        if (it) {
          title = it.title;
          meta = `${it.pillar || '—'} · ${it.evaluation_score != null ? it.evaluation_score + '/100' : 'unscored'} · ${it.status}`;
          if (gt === 'script_review' && it.script) {
            try {
              const s = typeof it.script === 'string' ? JSON.parse(it.script) : it.script;
              preview = `<div class="card-flat" style="margin-top:8px;"><div class="label">Hook</div><blockquote style="margin:4px 0;font-size:13px;">${esc(s.hook || '')}</blockquote><div class="meta" style="margin-top:4px;">${(s.script||'').split(/\\s+/).length} words · CTA: ${esc(s.cta||'')}</div></div>`;
            } catch { preview = ''; }
          }
          if (gt === 'snapshot_plan_review') {
            const st = stillsByItem[g.target_id];
            const imgs = st && st.files && st.files.length ? st.files.map(f => `<img src="${esc(f.url)}" alt="${esc(f.name)}" style="width:90px;height:auto;border-radius:6px;border:1px solid var(--outline-variant);margin:2px;" />`).join('') : '<span class="meta">No stills yet.</span>';
            preview = `<div class="card-flat" style="margin-top:8px;"><div class="label">Plan stills</div><div class="row" style="gap:4px;flex-wrap:wrap;margin-top:4px;">${imgs}</div></div>`;
          }
          if (gt === 'asset_review') {
            const a = assets.find((x) => x.content_item_id === g.target_id && x.status === 'review');
            if (a) {
              const u = mediaUrl(a.file_path);
              preview = `<div class="card-flat" style="margin-top:8px;"><div class="label">Render</div>${u ? `<video src="${esc(u)}" controls style="width:100%;max-height:240px;border-radius:8px;margin-top:4px;"></video>` : `<span class="meta">${esc(a.file_path)}</span>`}<div class="meta" style="margin-top:4px;">${a.width}×${a.height} · ${esc(a.orientation||'')}</div></div>`;
            }
          }
        } else {
          title = `Content item #${g.target_id}`;
          meta = 'not found';
        }
      } else if (g.target_type === 'engagement_item') {
        const e = engById[g.target_id];
        if (e) {
          title = `${e.author} on ${e.platform}`;
          meta = `${esc(e.kind)} · ${esc(e.classification||'unclassified')} · ${Math.round((e.classification_confidence||0)*100)}%`;
          preview = `<div class="card-flat" style="margin-top:8px;"><div class="label">Message</div><p style="margin:4px 0;font-size:13px;">${esc(e.text)}</p></div>`;
        } else {
          title = `Engagement item #${g.target_id}`;
          meta = 'not found';
        }
      } else if (g.target_type === 'asset') {
        const a = assetById[g.target_id];
        if (a) {
          title = `Asset #${a.id} · ${esc(a.platform)}`;
          meta = `${a.width}×${a.height} · ${esc(a.orientation||'')}`;
          const u = mediaUrl(a.file_path);
          preview = u ? `<div class="card-flat" style="margin-top:8px;"><video src="${esc(u)}" controls style="width:100%;max-height:240px;border-radius:8px;"></video></div>` : '';
        } else {
          title = `Asset #${g.target_id}`;
          meta = 'not found';
        }
      } else {
        title = `${esc(g.target_type)} #${g.target_id}`;
        meta = '';
      }

      return `
        <div class="card-flat" style="margin-bottom:8px;${borderStyle}" data-gate="${g.id}">
          <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
            <div style="flex:1;min-width:200px;">
              <div class="row" style="gap:6px;margin-bottom:4px;">
                ${badge('#' + g.id)}
                ${isEsc ? badge('Needs attention','danger') : ''}
                <span class="meta">${esc(fmtDate(g.created_at))}</span>
              </div>
              <div style="font-weight:600;font-size:14px;margin-bottom:2px;">${esc(title)}</div>
              <div class="meta">${esc(meta)}</div>
              ${g.requested_note ? `<div class="meta" style="margin-top:4px;font-style:italic;">${esc(g.requested_note)}</div>` : ''}
            </div>
            <div class="row" style="gap:6px;">
              <button class="btn sm primary" onclick="decideGate(${g.id},'approved')">${icon('check',14)} Approve</button>
              <button class="btn sm danger" onclick="decideGate(${g.id},'rejected')">${icon('x',14)} Reject</button>
            </div>
          </div>
          ${preview}
          <div class="meta" style="margin-top:8px;font-size:11px;">Decide: ${esc(title)}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="card" style="margin-bottom:16px;${borderStyle}">
        <div class="row" style="justify-content:space-between;margin-bottom:8px;">
          <div>
            <h3 style="margin:0;">${esc(GATE_LABELS[gt] || gt)} <span class="badge ${isEsc ? 'danger' : 'warn'}">${gs.length}</span></h3>
            <div class="meta" style="margin-top:2px;">${esc(GATE_DESC[gt] || '')}</div>
          </div>
        </div>
        ${rows}
      </div>
    `;
  }).join('');

  const allGates = await api('/api/gates');
  const decided = (allGates.gates || []).filter((g) => g.status !== 'pending').slice(0, 10);
  const historyHtml = decided.length ? `
    <div class="card">
      <h3 style="margin-bottom:10px;">Recent decisions</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>ID</th><th>Type</th><th>Target</th><th>Verdict</th><th>By</th><th>When</th></tr></thead>
        <tbody>
          ${decided.map((g) => `<tr>
            <td>${g.id}</td><td>${esc(g.gate_type)}</td><td>${esc(g.target_type)} #${g.target_id}</td>
            <td>${badge(g.status, g.status === 'approved' ? 'success' : 'danger')}</td>
            <td class="meta">${esc(g.decided_by||'—')}</td>
            <td class="meta">${esc(fmtDate(g.decided_at))}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
  ` : '';

  c.innerHTML = sections + historyHtml;
};

// DISTRIBUTION
function parseDistributionState(post) {
  try { return post.publish_state ? JSON.parse(post.publish_state) : null; } catch { return null; }
}

views.distribution = async (c) => {
  const [{ items }, { posts }, { assets }, { settings }] = await Promise.all([
    api('/api/content-items'), api('/api/posts'), api('/api/assets'), api('/api/settings'),
  ]);
  const postsById = {};
  for (const post of posts) postsById[post.id] = post;
  const itemsById = {};
  for (const item of items) itemsById[item.id] = item;
  window._distribution = { postsById, itemsById };

  const distributionSetting = settings.find((setting) => setting.key === 'distribution');
  let distribution = {};
  try { distribution = distributionSetting ? JSON.parse(distributionSetting.value) : {}; } catch { distribution = {}; }
  const accounts = Array.isArray(distribution.accounts) ? distribution.accounts : [];

  const counts = { scheduled: 0, draft: 0, failed: 0, published: 0 };
  for (const post of posts) if (counts[post.status] !== undefined) counts[post.status]++;

  const withPosts = new Set(posts.map((post) => post.content_item_id));
  const active = items.filter((item) =>
    item.status === 'scheduled' || item.status === 'published' || withPosts.has(item.id)
  );
  const assetsByItem = {};
  for (const asset of assets) {
    (assetsByItem[asset.content_item_id] = assetsByItem[asset.content_item_id] || []).push(asset);
  }

  const postCard = (post) => {
    const state = parseDistributionState(post);
    const hashtags = Array.isArray(post.hashtags) ? post.hashtags : [];
    const when = post.published_at || post.scheduled_at;
    const canEdit = (post.status === 'scheduled' || post.status === 'failed') && !state;
    const canPublish = !post.external_id && (post.status === 'scheduled' || post.status === 'failed');
    const canReset = post.status === 'failed' && state;
    const actions = [
      canEdit ? `<button class="btn sm" onclick="distEditCopy(${post.id})">${icon('edit',12)} Edit copy</button>` : '',
      canPublish ? `<button class="btn sm primary" onclick="distPublishPost(${post.id})">Publish</button>` : '',
      canReset ? `<button class="btn sm danger" onclick="distResetState(${post.id})">Reset state</button>` : '',
      post.url ? `<a class="btn sm" href="${esc(post.url)}" target="_blank" rel="noopener">Open post</a>` : '',
    ].filter(Boolean).join(' ');
    const stateBits = [];
    if (state?.stage) stateBits.push(`stage ${state.stage}`);
    if (state?.publishId) stateBits.push(`publish ${state.publishId}`);
    if (state?.uploadedBytes != null && state?.videoSize != null) stateBits.push(`${state.uploadedBytes}/${state.videoSize} bytes`);
    return `
      <div class="card-flat" style="margin-bottom:10px;">
        <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
          <div>
            <div class="row" style="gap:6px;flex-wrap:wrap;">
              <strong>${esc(post.platform)}:${esc(post.account)}</strong>
              ${statusBadge(post.status)}
              ${post.status === 'draft' ? badge('manual completion', 'warn') : ''}
            </div>
            <div class="meta" style="margin-top:3px;">post #${post.id} · ${esc(when ? fmtDate(when) : 'not scheduled')}${post.external_id ? ` · external ${esc(post.external_id)}` : ''}</div>
          </div>
          <div class="row" style="gap:6px;flex-wrap:wrap;">${actions || '<span class="meta">—</span>'}</div>
        </div>
        ${post.title ? `<div style="margin-top:10px;"><div class="label">Title</div><div>${esc(post.title)}</div></div>` : ''}
        ${post.caption ? `<div style="margin-top:8px;"><div class="label">Caption</div><div style="white-space:pre-wrap;">${esc(post.caption)}</div></div>` : '<div class="meta" style="margin-top:8px;">No caption</div>'}
        ${post.description ? `<div style="margin-top:8px;"><div class="label">Description</div><div style="white-space:pre-wrap;">${esc(post.description)}</div></div>` : ''}
        <div style="margin-top:8px;"><div class="label">Hashtags</div><div class="row" style="gap:4px;flex-wrap:wrap;">${hashtags.length ? hashtags.map((tag) => badge(tag)).join('') : '<span class="meta">none</span>'}</div></div>
        ${post.thumbnail_path ? `<div class="meta" style="margin-top:6px;">thumbnail: ${esc(post.thumbnail_path)}</div>` : ''}
        ${stateBits.length ? `<div class="meta" style="margin-top:6px;">${esc(stateBits.join(' · '))}</div>` : ''}
        ${post.publish_error ? `<div style="margin-top:8px;padding:8px;border-left:3px solid var(--error);background:var(--surface-inset);"><div class="label">Last error</div><div class="meta" style="word-break:break-word;">${esc(post.publish_error)}</div></div>` : ''}
      </div>
    `;
  };

  const cards = active.map((item) => {
    const itemPosts = posts.filter((post) => post.content_item_id === item.id);
    const itemAssets = assetsByItem[item.id] || [];
    const asset = itemAssets.slice().sort((a, b) => b.id - a.id)[0];
    const assetUrl = asset ? mediaUrl(asset.file_path) : null;
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
          <div>
            <div class="row" style="gap:6px;flex-wrap:wrap;"><strong>${esc(item.title)}</strong>${statusBadge(item.status)}</div>
            <div class="meta" style="margin-top:3px;">item ${item.id} · ${esc(item.pillar || '—')} · ${esc(item.format || '—')} · ${item.desired_length_seconds ? item.desired_length_seconds + 's' : '—'}</div>
          </div>
          <div class="row" style="gap:6px;flex-wrap:wrap;">
            <button class="btn sm" onclick="openItem(${item.id})">Open item</button>
            <button class="btn sm" onclick="adaptCopy(${item.id})">${icon('plus',12)} Add copy</button>
          </div>
        </div>
        <div class="row" style="align-items:flex-start;gap:14px;margin-top:12px;flex-wrap:wrap;">
          <div style="flex:0 0 190px;max-width:100%;">
            ${assetUrl ? `<video src="${esc(assetUrl)}" controls preload="metadata" style="width:190px;max-width:100%;border-radius:8px;border:1px solid var(--border);background:#000;"></video>` : '<div class="card-flat"><div class="meta">No approved asset</div></div>'}
            ${asset ? `<div class="meta" style="margin-top:4px;">asset ${asset.id} · ${esc(asset.status)} · ${asset.width || '?'}×${asset.height || '?'}</div>` : ''}
          </div>
          <div style="flex:1;min-width:260px;">
            ${itemPosts.length ? itemPosts.map(postCard).join('') : `
              <div class="card-flat">
                <div class="meta">No platform posts yet. Add copy for an account to create the post record.</div>
                <button class="btn sm primary" style="margin-top:8px;" onclick="adaptCopy(${item.id})">Add platform copy</button>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('') || empty('No distribution items', 'Items appear here after production schedules them.');

  c.innerHTML = `
    <div class="row" style="margin-bottom:12px;gap:6px;flex-wrap:wrap;">
      <button class="btn sm" onclick="distSchedule()">Schedule due</button>
      <button class="btn sm primary" onclick="distPublishDue()">Publish due</button>
    </div>
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="card"><div class="kpi"><div class="kpi-value">${counts.scheduled}</div><div class="kpi-label">Scheduled</div></div></div>
      <div class="card"><div class="kpi"><div class="kpi-value">${counts.draft}</div><div class="kpi-label">Drafts</div></div></div>
      <div class="card"><div class="kpi"><div class="kpi-value">${counts.failed}</div><div class="kpi-label">Failed</div></div></div>
      <div class="card"><div class="kpi"><div class="kpi-value">${counts.published}</div><div class="kpi-label">Published</div></div></div>
    </div>
    ${accounts.length ? `<div class="card" style="margin-bottom:16px;"><div class="label">Accounts</div><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px;">${accounts.map((account) => `${badge(`${account.platform}:${account.account}`, account.authorized ? 'success' : 'danger')}`).join('')}</div></div>` : ''}
    <div class="stack">${cards}</div>
  `;
};

window.runDist = async (action) => {
  try {
    const r = await api('/api/actions/distribution', { method:'POST', body: { action } });
    toast(`Distribution ${action}: ${r.processed ?? 0} processed, ${r.skipped ?? 0} skipped`);
    render();
    return r;
  } catch (e) { toast(e.message,'error'); return null; }
};

window.distSchedule = () => openModal(
  'Schedule due posts',
  '<p>This assigns the next eligible slots to scheduled content and creates calendar entries.</p>',
  {
    confirmLabel: 'Schedule',
    onConfirm: async () => Boolean(await window.runDist('schedule')),
  }
);

window.distPublishDue = () => openModal(
  'Publish due posts',
  '<p>This publishes every due post through its configured publisher. Published posts are not retried.</p>',
  {
    confirmLabel: 'Publish due',
    onConfirm: async () => Boolean(await window.runDist('publish')),
  }
);

window.distPublishPost = (postId) => {
  const post = window._distribution?.postsById?.[postId];
  openModal(
    'Publish post',
    `<p>Publish post #${postId}${post ? ` (${esc(post.platform)}:${esc(post.account)})` : ''} now?</p><p class="meta">The engine will claim it and use saved provider state if a prior attempt was interrupted.</p>`,
    {
      confirmLabel: 'Publish',
      onConfirm: async () => {
        try {
          const r = await api('/api/actions/distribution', { method:'POST', body: { action:'publish', postId } });
          toast(`Published ${r.published ?? 0}, drafts ${r.drafts ?? 0}, failed ${r.failed ?? 0}`);
          render();
          return true;
        } catch (e) { toast(e.message,'error'); return false; }
      },
    }
  );
};

window.distResetState = (postId) => openModal(
  'Reset publish state',
  `<p>Reset the saved provider state for post #${postId}?</p><p class="meta">Check the platform first. Resetting an upload that reached the platform can create a duplicate.</p>`,
  {
    confirmLabel: 'Reset state',
    onConfirm: async () => {
      try {
        await api('/api/actions/distribution', { method:'POST', body: { action:'reset_publish_state', postId, confirm:true } });
        toast('Publish state reset');
        render();
        return true;
      } catch (e) { toast(e.message,'error'); return false; }
    },
  }
);

window.distEditCopy = (postId) => {
  const post = window._distribution?.postsById?.[postId];
  if (!post) return;
  window.adaptCopy(post.content_item_id, post.platform, post.account, post);
};

window.adaptCopy = async (itemId, platform = '', account = '', post = null) => {
  const key = platform && account ? `${platform}:${account}` : '';
  const hashtags = Array.isArray(post?.hashtags) ? post.hashtags.join(', ') : '';
  let approvedImages = [];
  try {
    const { assets } = await api('/api/assets');
    approvedImages = (assets || []).filter((a) => a.content_item_id === itemId && /\.(png|jpe?g|webp)$/i.test(a.file_path || ''));
  } catch (e) { approvedImages = []; }
  openModal('Platform copy', `<div class="stack">
    <div class="card-flat"><div class="label">Platform:account</div><input class="input" id="m-key" placeholder="tiktok:main" value="${esc(key)}" ${post ? 'readonly' : ''} /></div>
    <div class="card-flat"><div class="label">Title <span class="meta" id="m-title-count">${(post?.title||'').length}/100</span></div><input class="input" id="m-title" value="${esc(post?.title || '')}" oninput="document.getElementById('m-title-count').textContent=this.value.length+'/100';const p=document.getElementById('m-yt-preview');if(p)p.textContent=this.value+'\n\n'+(document.getElementById('m-desc')?.value||'')" /></div>
    <div class="card-flat"><div class="label">Caption</div><textarea class="textarea" id="m-caption" style="min-height:110px;">${esc(post?.caption || '')}</textarea></div>
    <div class="card-flat"><div class="label">Description <span class="meta" id="m-desc-count">${(post?.description||'').length}/5000</span></div><textarea class="textarea" id="m-desc" style="min-height:70px;" oninput="document.getElementById('m-desc-count').textContent=this.value.length+'/5000';const p=document.getElementById('m-yt-preview');if(p)p.textContent=(document.getElementById('m-title')?.value||'')+'\n\n'+this.value">${esc(post?.description || '')}</textarea></div>
    <div class="card-flat"><div class="label">Hashtags (comma separated)</div><input class="input" id="m-tags" placeholder="#ai, #automation" value="${esc(hashtags)}" /></div>
    ${key.startsWith('youtube') ? `
    <div class="card-flat"><div class="label">Thumbnail (approved image asset)</div>
      <select class="input" id="m-thumb-asset" onchange="const v=this.value; document.getElementById('m-thumb').value=v; const img=document.getElementById('m-thumb-preview'); if(v){img.src=(window.mediaUrl?mediaUrl(v):v); img.style.display='block';}else{img.style.display='none';}">
        <option value="">None</option>
        ${approvedImages.map((a) => `<option value="${esc(a.file_path)}" ${post?.thumbnail_path === a.file_path ? 'selected' : ''}>#${a.id} ${esc(a.file_path.split('/').pop())} ${a.width||''}x${a.height||''}</option>`).join('')}
      </select>
      <input class="input" id="m-thumb" value="${esc(post?.thumbnail_path || '')}" placeholder="or manual path" style="margin-top:6px;" />
      <img id="m-thumb-preview" src="" style="max-width:100%;margin-top:6px;display:none;" />
    </div>
    ` : `<div class="card-flat"><div class="label">Thumbnail path (optional)</div><input class="input" id="m-thumb" value="${esc(post?.thumbnail_path || '')}" /></div>`}
    ${key.startsWith('youtube') ? `
    <div class="card-flat"><div class="label">YouTube category</div><select class="input" id="m-yt-category">
      <option value="22" ${(post?.platform_metadata?.categoryId||post?.categoryId||'22')==='22'?'selected':''}>People & Blogs (22)</option>
      <option value="27" ${(post?.platform_metadata?.categoryId||post?.categoryId)==='27'?'selected':''}>Education (27)</option>
      <option value="28" ${(post?.platform_metadata?.categoryId||post?.categoryId)==='28'?'selected':''}>Science & Technology (28)</option>
      <option value="24" ${(post?.platform_metadata?.categoryId||post?.categoryId)==='24'?'selected':''}>Entertainment (24)</option>
    </select></div>
    <div class="card-flat"><div class="label">Language (optional)</div><input class="input" id="m-yt-lang" placeholder="en" value="${esc(post?.platform_metadata?.defaultLanguage || post?.defaultLanguage || '')}" /></div>
    <div class="card-flat"><div class="label">Scheduled publish time (optional, ISO)</div><input class="input" id="m-yt-sched" placeholder="2026-..." value="${esc(post?.scheduled_at || '')}" /></div>
    <div class="meta">YouTube uploads default to private. Scheduling requires a future time and keeps the video private until publishAt.</div>
    <div class="card-flat"><div class="label">Live preview</div><div id="m-yt-preview" style="white-space:pre-wrap;"></div></div>
    ` : ''}
  </div>`, {
    confirmLabel: post ? 'Save copy' : 'Create post',
    onConfirm: async () => {
      const copyKey = document.getElementById('m-key').value.trim();
      if (!copyKey) { toast('Platform:account required', 'error'); return false; }
      const tags = document.getElementById('m-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
      const copy = {};
      const entry = {
        title: document.getElementById('m-title').value.trim(),
        caption: document.getElementById('m-caption').value.trim(),
        description: document.getElementById('m-desc').value.trim(),
        hashtags: tags,
        thumbnail_path: document.getElementById('m-thumb').value.trim() || null,
      };
      if (copyKey.startsWith('youtube')) {
        const sched = document.getElementById('m-yt-sched')?.value.trim() || '';
        entry.platform_metadata = {
          categoryId: document.getElementById('m-yt-category')?.value || '22',
          defaultLanguage: document.getElementById('m-yt-lang')?.value.trim() || null,
          schedule: Boolean(sched),
        };
        if (sched) entry.scheduled_at = sched;
      }
      copy[copyKey] = entry;
      try {
        const r = await api('/api/actions/distribution', { method:'POST', body: { action:'adapt', targetId:itemId, copy, dryRun:false } });
        toast(`Copy saved: ${r.processed ?? 0} processed, ${r.skipped ?? 0} skipped`);
        render();
        return true;
      } catch (e) { toast(e.message,'error'); return false; }
    },
  });
};

// CALENDAR
views.calendar = async (c) => {
  const { entries } = await api('/api/calendar');
  c.innerHTML = `
    <div class="card">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Kind</th><th>Platform</th><th>Item</th><th>Post</th><th>Status</th></tr></thead>
        <tbody>
          ${entries.map((e) => `<tr><td>${esc(fmtDate(e.date))}</td><td>${esc(e.kind)}</td><td>${esc(e.platform||'—')}</td><td>${e.content_item_id?'#'+e.content_item_id:'—'}</td><td>${e.post_id?'#'+e.post_id:'—'}</td><td>${statusBadge(e.status)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">No calendar entries</td></tr>`}
        </tbody>
      </table></div>
    </div>
  `;
};

// ENGAGEMENT
views.engagement = async (c) => {
  const [eng, conv] = await Promise.all([api('/api/engagement'), api('/api/conversations')]);
  c.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <h3 style="margin-bottom:10px;">Engagement items (manual triage — automation engine is stubbed)</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>ID</th><th>Platform</th><th>Kind</th><th>Author</th><th>Text</th><th>Classification</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${eng.items.map((e) => `
            <tr>
              <td>${e.id}</td><td>${esc(e.platform)}</td><td>${esc(e.kind)}</td><td>${esc(e.author)}</td>
              <td style="max-width:260px;">${esc(e.text)}</td>
              <td>${badge(e.classification||'unclassified')}</td>
              <td>${statusBadge(e.status)}</td>
              <td class="row">
                <button class="btn sm" onclick="triageEng(${e.id},'lead')">Lead</button>
                <button class="btn sm" onclick="triageEng(${e.id},'idea',true)">Idea</button>
                <button class="btn sm" onclick="triageEng(${e.id},'simple')">Simple</button>
                <button class="btn sm danger" onclick="triageEng(${e.id},'negative')">Escalate</button>
              </td>
            </tr>
          `).join('') || `<tr><td colspan="8" class="empty">No engagement items</td></tr>`}
        </tbody>
      </table></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:10px;">Conversations (leads)</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>ID</th><th>Platform</th><th>Lead</th><th>Status</th><th>Last msg</th></tr></thead>
        <tbody>
          ${conv.conversations.map((cv) => `<tr><td>${cv.id}</td><td>${esc(cv.platform)}</td><td>${esc(cv.lead_name||'—')}</td><td>${statusBadge(cv.lead_status)}</td><td class="meta">${esc(fmtDate(cv.last_message_at))}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">No conversations</td></tr>`}
        </tbody>
      </table></div>
    </div>
  `;
};
window.triageEng = async (id, classification, saveAsIdea = false) => {
  try {
    await api('/api/actions/engagement', { method:'POST', body: { action:'triage', id, patch: { classification, status: classification === 'negative' ? 'escalated' : 'resolved', saveAsIdea } } });
    toast('Triaged'); render();
  } catch (e) { toast(e.message,'error'); }
};

// ANALYTICS
views.analytics = async (c) => {
  const [ins, pb, metrics] = await Promise.all([api('/api/insights'), api('/api/playbook'), api('/api/metrics')]);
  c.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <h3 style="margin-bottom:10px;">Insights (automation engine is stubbed — manual promotion available)</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>ID</th><th>Claim</th><th>Dimension</th><th>Effect</th><th>Confidence</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${ins.insights.map((i) => `
            <tr>
              <td>${i.id}</td><td style="max-width:320px;">${esc(i.claim)}</td><td>${esc(i.dimension||'—')}</td><td>${esc(i.effect||'—')}</td>
              <td>${i.confidence!=null?i.confidence.toFixed(2):'—'}</td><td>${statusBadge(i.status)}</td>
              <td class="row">
                <button class="btn sm primary" onclick="promoteInsight(${i.id})">Promote</button>
                <button class="btn sm" onclick="setInsightStatus(${i.id},'rejected')">Reject</button>
              </td>
            </tr>
          `).join('') || `<tr><td colspan="7" class="empty">No insights</td></tr>`}
        </tbody>
      </table></div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <h3 style="margin-bottom:10px;">Playbook rules</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>ID</th><th>Rule</th><th>Dimension</th><th>Status</th></tr></thead>
        <tbody>
          ${pb.rules.map((r) => `<tr><td>${r.id}</td><td style="max-width:420px;">${esc(r.rule)}</td><td>${esc(r.dimension||'—')}</td><td>${statusBadge(r.status)}</td></tr>`).join('') || `<tr><td colspan="4" class="empty">No playbook rules</td></tr>`}
        </tbody>
      </table></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:10px;">Metrics (recent)</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>ID</th><th>Post</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th><th>Collected</th></tr></thead>
        <tbody>
          ${metrics.metrics.slice(0,30).map((m) => `<tr><td>${m.id}</td><td>#${m.post_id}</td><td>${m.views??0}</td><td>${m.likes??0}</td><td>${m.comments??0}</td><td>${m.shares??0}</td><td>${m.saves??0}</td><td class="meta">${esc(fmtDate(m.collected_at))}</td></tr>`).join('') || `<tr><td colspan="8" class="empty">No metrics</td></tr>`}
        </tbody>
      </table></div>
    </div>
  `;
};
window.promoteInsight = async (id) => {
  try { await api('/api/actions/analytics', { method:'POST', body: { action:'promote_insight', id } }); toast('Promoted to playbook'); render(); } catch (e) { toast(e.message,'error'); }
};
window.setInsightStatus = async (id, status) => {
  try { await api('/api/actions/analytics', { method:'POST', body: { action:'set_insight_status', id, patch: { status } } }); toast('Updated'); render(); } catch (e) { toast(e.message,'error'); }
};

// ASSETS
views.assets = async (c) => {
  const { assets } = await api('/api/assets');
  c.innerHTML = `
    <div class="card">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>ID</th><th>Item</th><th>Platform</th><th>Status</th><th>Dims</th><th>Orientation</th><th>File</th></tr></thead>
        <tbody>
          ${assets.map((a) => `
            <tr>
              <td>${a.id}</td><td>#${a.content_item_id}</td><td>${esc(a.platform)}</td><td>${statusBadge(a.status)}</td>
              <td>${a.width||'—'}×${a.height||'—'}</td><td>${esc(a.orientation||'—')}</td>
              <td class="meta" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;">${esc(a.file_path||'—')}</td>
            </tr>
          `).join('') || `<tr><td colspan="7" class="empty">No assets</td></tr>`}
        </tbody>
      </table></div>
    </div>
  `;
};

// TEMPLATES / REFERENCE
// TEMPLATES / REFERENCE
views.templates = async (c) => {
  const [settingsRes, styleRes, menuRes] = await Promise.all([
    api('/api/settings'),
    api('/api/style-config').catch(() => ({ config: null })),
    api('/api/actions/production', { method: 'POST', body: { action: 'menu' } }).catch(() => ({ plan: null })),
  ]);
  const settings = settingsRes.settings || [];
  const getSetting = (k) => { const r = settings.find((s) => s.key === k); return r ? r.value : null; };
  const scriptFw = getSetting('script_framework');
  const ideaFw = getSetting('idea_framework');
  const cfg = styleRes.config || {};
  const menu = menuRes || {};
  const plan = menu.plan || {};
  const concepts = plan.snapshotConcepts || null;
  const slotsMap = plan.slots || null;
  const diagrams = plan.diagrams || null;

  const section = (title, body) => `<div class="card" style="margin-bottom:16px;"><h3 style="margin-bottom:10px;">${esc(title)}</h3>${body}</div>`;

  const fwBody = (label, raw) => {
    if (!raw) return '<p class="meta">Not seeded. Run npm run seed.</p>';
    let obj = null;
    try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = null; }
    if (obj) {
      return `<details><summary class="meta" style="cursor:pointer;margin-bottom:8px;">View ${esc(label)} (JSON)</summary><pre class="code">${esc(JSON.stringify(obj, null, 2))}</pre></details>`;
    }
    return `<pre class="code">${esc(String(raw))}</pre>`;
  };

  let styleBody = '<p class="meta">Style config not found.</p>';
  if (cfg && Object.keys(cfg).length) {
    const colors = cfg.brand && cfg.brand.colors ? cfg.brand.colors : (cfg.colors || {});
    const fonts = cfg.brand && cfg.brand.fonts ? cfg.brand.fonts : (cfg.fonts || {});
    const voice = cfg.voice || (cfg.doctrine && cfg.doctrine.voice) || null;
    const render = cfg.render || {};
    styleBody = `
      <div class="grid grid-2" style="margin-bottom:10px;">
        <div class="card-flat"><div class="label">Background</div><div class="row" style="gap:6px;margin-top:4px;"><span style="width:24px;height:24px;border-radius:6px;background:${esc(colors.bg||'#000')};border:1px solid var(--border);"></span><span class="meta">${esc(colors.bg||'—')}</span></div></div>
        <div class="card-flat"><div class="label">Accent</div><div class="row" style="gap:6px;margin-top:4px;"><span style="width:24px;height:24px;border-radius:6px;background:${esc(colors.accent||'#000')};border:1px solid var(--border);"></span><span class="meta">${esc(colors.accent||'—')}</span></div></div>
        <div class="card-flat"><div class="label">Display font</div><div class="meta" style="margin-top:4px;">${esc(fonts.display||'—')}</div></div>
        <div class="card-flat"><div class="label">Body font</div><div class="meta" style="margin-top:4px;">${esc(fonts.body||'—')}</div></div>
      </div>
      ${voice ? `<div class="card-flat" style="margin-bottom:10px;"><div class="label">Voice</div><div class="meta" style="margin-top:4px;">${esc(typeof voice === 'string' ? voice : JSON.stringify(voice))}</div></div>` : ''}
      <div class="card-flat" style="margin-bottom:10px;"><div class="label">Render canvases</div><pre class="code" style="max-height:160px;">${esc(JSON.stringify(render, null, 2))}</pre></div>
      <details><summary class="meta" style="cursor:pointer;">Full style.json</summary><pre class="code" style="max-height:320px;">${esc(JSON.stringify(cfg, null, 2))}</pre></details>
    `;
  }

  let conceptsHtml = '<p class="meta">No concepts in menu.</p>';
  if (Array.isArray(concepts) && concepts.length) {
    conceptsHtml = `<div class="table-wrap"><table class="table"><thead><tr><th>Concept</th><th>Slots</th></tr></thead><tbody>
      ${concepts.map((name) => {
        const slots = slotsMap && Array.isArray(slotsMap[name]) ? slotsMap[name] : [];
        return `<tr><td><strong>${esc(name)}</strong></td><td class="meta">${esc(slots.join(', ') || '—')}</td></tr>`;
      }).join('') || '<tr><td colspan="2" class="empty">none</td></tr>'}
    </tbody></table></div>`;
  }

  let diagramsHtml = '<p class="meta">No diagrams in menu.</p>';
  if (diagrams) {
    const list = Array.isArray(diagrams) ? diagrams : Object.keys(diagrams);
    diagramsHtml = `<p class="meta">${list.length} native layouts available.</p>
      <details><summary class="meta" style="cursor:pointer;margin-top:6px;">List layouts</summary><div class="row" style="gap:4px;flex-wrap:wrap;margin-top:6px;">${list.map((d) => `<span class="badge">${esc(typeof d === 'string' ? d : (d.name || d))}</span>`).join('')}</div></details>`;
  }
  const galleryLink = '<p class="meta" style="margin-top:8px;">Full rendered catalog: <a href="/media/gallery/index.html" target="_blank">Open diagram gallery (all 58 layouts, portrait + landscape)</a></p>';
  const docsLinks = '<p class="meta" style="margin-top:8px;">Diagram catalogs: <a href="/docs/content-os-landscape.html" target="_blank">Landscape</a> · <a href="/docs/content-os-portrait.html" target="_blank">Portrait</a></p>';
  const galleryEmbed = '<div style="margin-top:10px;"><iframe src="/media/gallery/index.html" style="width:100%;height:600px;border:1px solid var(--border);border-radius:8px;background:var(--surface-inset);"></iframe></div>';

  c.innerHTML = `
    ${section('Script framework (writing guide)', fwBody('script_framework', scriptFw))}
    ${section('Idea framework (generation guide)', fwBody('idea_framework', ideaFw))}
    ${section('Production style (locked)', styleBody)}
    ${section('Snapshot concepts (recipes)', conceptsHtml)}
    ${section('Diagrams (native layouts)', diagramsHtml + galleryLink + docsLinks + galleryEmbed)}
    ${section('Full menu (engine.menu())', `<details><summary class="meta" style="cursor:pointer;">View full menu JSON</summary><pre class="code" style="max-height:400px;">${esc(JSON.stringify(menu, null, 2))}</pre></details>`)}
  `;
};

// SETTINGS
function settingSummary(key, value) {
  let obj = null;
  try { obj = typeof value === 'string' ? JSON.parse(value) : value; } catch { obj = null; }
  if (key === 'brand' && obj) return `${obj.name || '—'} — ${obj.tagline || ''}`;
  if (key === 'pillars' && Array.isArray(obj)) return obj.join(', ');
  if (key === 'platforms' && obj) return Object.keys(obj).join(', ');
  if (key === 'hooks_preferred' && Array.isArray(obj)) return obj.join(', ');
  if (key === 'target_audience' && obj) return typeof obj === 'string' ? obj : (obj.primary || JSON.stringify(obj));
  if (key === 'content_weights' && obj) return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(' · ');
  if (key === 'pillar_details' && obj) return Object.keys(obj).length + ' pillars detailed';
  if (key === 'distribution' && obj) return Object.keys(obj).join(', ');
  if (key === 'script_framework' || key === 'idea_framework') return obj ? 'Seeded (click to view/edit)' : 'Not seeded';
  return obj ? (Array.isArray(obj) ? obj.length + ' items' : (typeof obj === 'object' ? Object.keys(obj).length + ' fields' : String(obj).slice(0, 80))) : '—';
}
views.settings = async (c) => {
  const { settings } = await api('/api/settings');
  c.innerHTML = `
    <div class="stack">
      ${settings.map((s) => `
        <div class="card">
          <div class="row" style="justify-content:space-between;margin-bottom:4px;">
            <strong>${esc(s.key)}</strong>
            <div class="row" style="gap:6px;">
              <button class="btn sm" onclick="toggleRaw('${esc(s.key)}')">Edit raw JSON</button>
              <button class="btn sm primary" onclick="saveSetting('${esc(s.key)}')">Save</button>
            </div>
          </div>
          <div class="meta" style="margin-bottom:8px;">${esc(settingSummary(s.key, s.value))}</div>
          <textarea class="textarea" id="set-${esc(s.key)}" style="min-height:120px;display:none;">${esc(s.value)}</textarea>
        </div>
      `).join('')}
    </div>
  `;
};
window.toggleRaw = (key) => {
  const ta = document.getElementById('set-' + key);
  if (ta) ta.style.display = ta.style.display === 'none' ? '' : 'none';
};
window.saveSetting = async (key) => {
  const val = document.getElementById('set-' + key).value;
  let parsed;
  try { parsed = JSON.parse(val); } catch (e) { toast('Invalid JSON','error'); return; }
  try {
    await api(`/api/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value: parsed } });
    toast('Saved'); render();
  } catch (e) { toast(e.message,'error'); }
};

// SYSTEM
views.system = async (c) => {
  const [health, logs] = await Promise.all([api('/api/health'), api('/api/engine-logs')]);
  c.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <h3 style="margin-bottom:10px;">Health</h3>
      <pre class="code">${esc(JSON.stringify(health,null,2))}</pre>
    </div>
    <div class="card">
      <h3 style="margin-bottom:10px;">Engine logs (latest 200)</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Time</th><th>Engine</th><th>Action</th><th>Target</th><th>Status</th><th>Message</th></tr></thead>
        <tbody>
          ${logs.logs.map((l) => `<tr><td class="meta">${esc(fmtDate(l.created_at))}</td><td>${esc(l.engine)}</td><td>${esc(l.action)}</td><td>${l.target_id?'#'+l.target_id:'—'}</td><td>${statusBadge(l.status)}</td><td style="max-width:400px;">${esc(l.message||'')}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">No logs</td></tr>`}
        </tbody>
      </table></div>
    </div>
  `;
};

// drawer
function openDrawer(html) {
  let d = document.getElementById('drawer');
  if (!d) {
    d = document.createElement('div');
    d.id = 'drawer';
    d.className = 'drawer';
    d.innerHTML = `<div style="position:sticky;top:0;z-index:2;background:var(--surface);padding-bottom:8px;margin:-24px -24px 0;padding:12px 24px 8px;display:flex;justify-content:flex-end;"><button class="btn sm ghost" onclick="closeDrawer()" aria-label="Close">${icon('x',16)}</button></div><div id="drawerBody" style="flex:1;overflow:visible;"></div>`;
    document.body.appendChild(d);
  }
  document.getElementById('drawerBody').innerHTML = html;
  requestAnimationFrame(() => d.classList.add('open'));
}
window.closeDrawer = () => {
  const d = document.getElementById('drawer');
  if (d) d.classList.remove('open');
};

window.toggleAdvancedContent = () => { const el = document.getElementById('adv-content'); if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none'; };
initIcons();
render();
