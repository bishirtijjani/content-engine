import { initDb } from '@content-os/core';
import { ProductionEngine } from '@content-os/engine-production';

const db = initDb();
const engine = new ProductionEngine(db);
const TARGET = 46;

console.log('--- edit (build + render) ---');
const t0 = Date.now();
const result = engine.edit({ targetId: TARGET });
console.log('elapsed_s:', ((Date.now() - t0) / 1000).toFixed(1));
console.log(JSON.stringify(result, null, 1));

console.log('status:', JSON.stringify(db.prepare('SELECT id,status FROM content_items WHERE id=?').get(TARGET)));
console.log('assets:', JSON.stringify(db.prepare('SELECT id,platform,file_path,status FROM assets WHERE content_item_id=? ORDER BY id').all(TARGET)));
console.log('\nrecent logs:');
console.log(JSON.stringify(db.prepare("SELECT action,status,message FROM engine_logs WHERE engine='production' AND target_id=? ORDER BY id DESC LIMIT 6").all(TARGET), null, 1));
db.close();
