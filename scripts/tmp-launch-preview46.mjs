import fs from 'node:fs';
import { spawn } from 'node:child_process';

const job = 'item46-doctrine';
const out = `data/renders/_${job}.out`;
const err = `data/renders/_${job}.err`;
const pid = `data/renders/_${job}.pid`;

fs.mkdirSync('data/renders', { recursive: true });
const o = fs.openSync(out, 'w');
const e = fs.openSync(err, 'w');

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/tmp-run-preview46.mjs'], {
  detached: true,
  stdio: ['ignore', o, e],
  cwd: process.cwd(),
});
child.unref();
fs.writeFileSync(pid, String(child.pid), 'utf8');
console.log('launched pid', child.pid, '->', out);
