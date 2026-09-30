// _tmp_diagram_sample.mjs — build a 16:9 and a 9:16 Flow sample composition.
// Temporary: used once to verify the diagram renders in both frame boxes.
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildComposition } from '../packages/engine-production/src/assemble.mjs';
import { loadStyle } from '../packages/engine-production/src/style.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'compositions');
const SRC = path.join(ROOT, 'data', 'renders', 'sample-src.mp4');

const style = loadStyle();
const duration = 6;

const plan = {
  captions: { emphasis: [] },
  overlays: [{
    kind: 'diagram',
    name: 'flow',
    why: 'show the whole loop end to end',
    start: 0,
    end: duration,
    spec: {
      title: 'How the loop works',
      steps: [
        { label: 'Lead fills form', icon: 'user' },
        { label: 'CRM captures', icon: 'database' },
        { label: 'Email goes out', icon: 'send' },
        { label: 'Follow-up logged', icon: 'check' },
      ],
    },
  }],
  zooms: [],
  sfx: [],
};

const builds = [
  { dir: 'diagram-sample-16x9', width: 1280, height: 720 },
  { dir: 'diagram-sample-9x16', width: 720, height: 1280 },
];

for (const b of builds) {
  const dir = path.join(OUT, b.dir);
  mkdirSync(dir, { recursive: true });
  const { html, overlayCount } = buildComposition({
    words: [],
    videoSrc: 'source.mp4',
    width: b.width,
    height: b.height,
    duration,
    style,
    plan,
  });
  writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  if (existsSync(SRC)) copyFileSync(SRC, path.join(dir, 'source.mp4'));
  console.log(`${b.dir}: ${b.width}x${b.height}, ${overlayCount} overlay(s) -> ${dir}`);
}
