import { connect } from '@content-os/core';
import { ProductionEngine } from '@content-os/engine-production';

const engine = new ProductionEngine(connect());
const t0 = Date.now();
console.log('preview start', new Date().toISOString());
const res = engine.preview({ targetId: 46 });
console.log('preview result', JSON.stringify(res));
console.log('elapsed_s', Math.round((Date.now() - t0) / 1000));
