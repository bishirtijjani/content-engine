// one-off: final render for content_items.id = 2 (item-2)
import { connect, initDb, getDbPath } from '@content-os/core';
import { ProductionEngine } from '@content-os/engine-production';

const t0 = Date.now();
const dbPath = getDbPath();
initDb(dbPath);
const db = connect(dbPath);
const engine = new ProductionEngine(db);

console.log('START', new Date().toISOString());
try {
  const r = engine.edit({ targetId: 2 });
  console.log('EDIT_RESULT', JSON.stringify(r));
  const item = db.prepare('SELECT id,status FROM content_items WHERE id=2').get();
  console.log('ITEM', JSON.stringify(item));
  const assets = db.prepare(
    'SELECT id,platform,file_path,status,duration_seconds,width,height,orientation FROM assets WHERE content_item_id=2 ORDER BY id DESC LIMIT 3'
  ).all();
  console.log('ASSETS', JSON.stringify(assets, null, 1));
  const logs = db.prepare(
    "SELECT id,action,status,message,created_at FROM engine_logs WHERE target_id=2 ORDER BY id DESC LIMIT 6"
  ).all();
  console.log('LOG', JSON.stringify(logs, null, 1));
  console.log('DONE in ' + Math.round((Date.now() - t0) / 1000) + 's');
} catch (e) {
  console.log('THREW', e && e.stack ? e.stack : String(e));
} finally {
  db.close();
}
