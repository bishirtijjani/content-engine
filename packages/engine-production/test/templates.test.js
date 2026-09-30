// Templates — the on-brand graphics book.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listTemplates, loadTemplate, fillTemplate, renderTemplate } from '../src/templates.mjs';

test('listTemplates finds the templates', () => {
  const names = listTemplates().map((t) => t.name);
  for (const n of ['stat-callout', 'lower-third', 'quote-card', 'cta-card', 'step-list',
    'text-box', 'key-point', 'checklist', 'callout', 'subscribe-button', 'follow-button',
    'comment-prompt', 'link-prompt', 'title-card']) {
    assert.ok(names.includes(n), `missing template: ${n}`);
  }
});

test('every template declares a frame', () => {
  const frames = ['full', 'center', 'left', 'right'];
  for (const t of listTemplates()) {
    assert.ok(frames.includes(t.frame), `${t.name} has frame "${t.frame}"`);
  }
});

test('listTemplates reports fields', () => {
  const t = listTemplates().find((x) => x.name === 'stat-callout');
  assert.deepEqual(t.fields, ['value', 'label']);
});

test('loadTemplate throws on a missing template', () => {
  assert.throws(() => loadTemplate('does-not-exist'), /not found/);
});

test('fillTemplate substitutes known fields', () => {
  const out = fillTemplate('<b>{{name}}</b> — {{role}}', { name: 'Bishir', role: 'Engineer' });
  assert.equal(out, '<b>Bishir</b> — Engineer');
});

test('fillTemplate escapes values and blanks unknown fields', () => {
  const out = fillTemplate('{{a}}{{b}}', { a: '<script>' });
  assert.equal(out, '&lt;script&gt;');
});

test('renderTemplate returns filled html and css', () => {
  const t = renderTemplate('stat-callout', { value: '8 hrs', label: 'saved per week' });
  assert.ok(t.html.includes('8 hrs'));
  assert.ok(t.html.includes('saved per week'));
  assert.ok(t.css.includes('.tpl-stat'));
});
