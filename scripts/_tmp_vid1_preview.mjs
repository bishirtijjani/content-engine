import { initDb } from '@content-os/core';
import { ProductionEngine } from '@content-os/engine-production';

const db = initDb();
const engine = new ProductionEngine(db);
const TARGET = 46;

const t0 = Date.now();
const result = engine.preview({ targetId: TARGET });
console.log('elapsed_s:', ((Date.now() - t0) / 1000).toFixed(1));
console.log(JSON.stringify(result, null, 1));
db.close();
