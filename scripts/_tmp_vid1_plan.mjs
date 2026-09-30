import { initDb } from '@content-os/core';
import { ProductionEngine } from '@content-os/engine-production';

const db = initDb();
const engine = new ProductionEngine(db);
const TARGET = 46;

const plan = engine.newPlan()
  .caption({ emphasis: [
    'automate', 'human time', 'seven', 'marketing', 'sales', 'revenue',
    'operations', 'support', 'finance', 'invoices', 'product', 'leadership',
    'audit', 'AUTOMATE',
  ] })
  .graphic({ at: [0.5, 5.5], name: 'title-card', why: 'open the promise: seven places to automate',
    fields: { title: '7 Places to Automate', subtitle: 'Where your business loses human time' } })
  .graphic({ at: [7.0, 12.8], name: 'step-list', why: 'show the whole map before the walk-through',
    fields: { title: 'The 7 areas', steps: '1  Marketing\n2  Sales\n3  Operations\n4  Customer support\n5  Finance\n6  Product\n7  Leadership' } })
  .graphic({ at: [13.2, 16.4], name: 'callout', why: 'mark area one without hiding the face',
    fields: { text: '01 · Marketing' } })
  .graphic({ at: [26.6, 29.8], name: 'callout', why: 'mark area two',
    fields: { text: '02 · Sales' } })
  .diagram({ at: [32.5, 37.5], name: 'flow', why: 'make the sales automation loop concrete',
    spec: { steps: [{ label: 'Lead in', icon: 'user' }, { label: 'Qualify', icon: 'check' }, { label: 'Follow up', icon: 'send' }] } })
  .graphic({ at: [44.8, 48.0], name: 'callout', why: 'mark area three',
    fields: { text: '03 · Operations' } })
  .graphic({ at: [51.0, 54.2], name: 'callout', why: 'mark area four',
    fields: { text: '04 · Customer support' } })
  .graphic({ at: [70.2, 73.4], name: 'callout', why: 'mark area five',
    fields: { text: '05 · Finance' } })
  .diagram({ at: [76.3, 81.5], name: 'flow', why: 'show the recurring invoice job',
    spec: { steps: [{ label: 'Invoice created', icon: 'doc' }, { label: 'Generated', icon: 'gear' }, { label: 'Sent weekly', icon: 'send' }] } })
  .graphic({ at: [82.5, 85.7], name: 'callout', why: 'mark area six',
    fields: { text: '06 · Product' } })
  .graphic({ at: [95.7, 98.9], name: 'callout', why: 'mark area seven',
    fields: { text: '07 · Leadership' } })
  .graphic({ at: [102.5, 107.5], name: 'key-point', why: 'land the thesis of the whole list',
    fields: { line: 'Automate the work, not the judgment' } })
  .graphic({ at: [127.0, 133.5], name: 'comment-prompt', why: 'make the ask the speaker is saying out loud',
    fields: { text: 'Comment AUTOMATE and I\'ll send the 7-part audit' } })
  .graphic({ at: [134.0, 140.0], name: 'cta-card', why: 'close on the action and the handle',
    fields: { line: 'Comment AUTOMATE', handle: '@iambishir' } })
  .zoom({ at: 13.2, scale: 1.12 })
  .zoom({ at: 27.0, scale: 1.12 })
  .zoom({ at: 44.8, scale: 1.12 })
  .zoom({ at: 51.0, scale: 1.12 })
  .zoom({ at: 70.2, scale: 1.12 })
  .zoom({ at: 82.5, scale: 1.12 })
  .zoom({ at: 95.7, scale: 1.12 });

const result = engine.savePlan({ targetId: TARGET, plan });
console.log('savePlan:', JSON.stringify(result.saved ? { saved: true, overlays: result.plan.overlays.length } : result, null, 1));
db.close();
