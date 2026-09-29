import { connect, decideGate, latestPending } from '@content-os/core';

const db = connect();
const gate = latestPending(db, 'plan_review', 'content_item', 46);
if (!gate) throw new Error('no pending plan_review gate for item 46');
decideGate(db, gate.id, 'approved', { decidedBy: 'human', notes: 'doctrine board approved' });
const after = db.prepare('SELECT id, status, decided_by FROM gates WHERE id = ?').get(gate.id);
console.log('gate decided:', JSON.stringify(after));
db.close();
