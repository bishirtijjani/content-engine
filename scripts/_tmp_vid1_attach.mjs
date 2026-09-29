import { initDb } from '@content-os/core';
import { ProductionEngine } from '@content-os/engine-production';

const db = initDb();
const engine = new ProductionEngine(db);
const TARGET = 46;

console.log('--- listFootage ---');
console.log(JSON.stringify(engine.listFootage(), null, 1));

console.log('\n--- processFootage ---');
const attached = engine.processFootage({ targetId: TARGET, filePath: 'data/vid1/vid1.cleaned.mp4' });
console.log(JSON.stringify(attached, null, 1));

console.log('\n--- menu ---');
console.log(JSON.stringify(engine.menu({ targetId: TARGET }), null, 1));

console.log('\n--- status ---');
console.log(JSON.stringify(db.prepare('SELECT id,status,desired_length_seconds FROM content_items WHERE id=?').get(TARGET)));
db.close();
