import { readFileSync } from 'node:fs';
import path from 'node:path';
import { initDb, PROJECT_ROOT } from '@content-os/core';

const db = initDb();

console.log('schema_version:', db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value);
console.log('has video_plan:', db.prepare('PRAGMA table_info(content_items)').all().some((c) => c.name === 'video_plan'));

const existing = db.prepare("SELECT id,status FROM content_items WHERE title LIKE '%7 places%' OR title LIKE '%seven%'").get();
if (existing) {
  console.log('already exists:', JSON.stringify(existing));
  db.close();
  process.exit(0);
}

const raw = readFileSync(path.join(PROJECT_ROOT, 'data', 'vid1', 'script.txt'), 'utf8');
const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const hook = lines[0];
const cta = lines[lines.length - 1];
const script = lines.join('\n');

const areas = ['Marketing', 'Sales', 'Operations', 'Customer support', 'Finance', 'Product', 'Leadership'];
const points = areas.map((a, i) => ({ title: `${i + 1}. ${a}`, detail: '' }));

const structured = JSON.stringify({ hook, script, points, cta, shot_notes: 'Talking head + captions, 7-part automation audit. 142s.' });

const res = db.prepare(
  "INSERT INTO content_items (title, status, source, pillar, format, hook_style, cta, desired_length_seconds, script, tags, notes, angle) " +
  "VALUES (?, 'ready_to_shoot', 'experience', 'business-operations', 'talking_head', 'question', ?, 142, ?, ?, ?, ?)"
).run(
  'The 7 places you should look for automation in your business',
  cta,
  structured,
  JSON.stringify(['automation', 'audit', '7 areas']),
  'Adopted from data/vid1 artifacts (script.txt + cleaned recording).',
  'The 7 places you should look for automation in your business',
);

const id = Number(res.lastInsertRowid);
console.log('created item id:', id);
console.log(JSON.stringify(db.prepare('SELECT id,status,title,desired_length_seconds FROM content_items WHERE id=?').get(id)));
db.close();
