// plan-snapshots.mjs — emit "the plan" for a video from a snapshot plan file.
//
//   node tools/plan-snapshots.mjs <plan.json>
//
// The mandatory plan step: derive the narration beats from the video's script +
// transcript, validate the snapshot plan, and write the artifacts — the plan
// JSON, the beats table, one still per snapshot, and the snapshot grid. It
// HARD-FAILS if the video has no narration or the plan is invalid. On success the
// caller STOPS for approval.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(PKG_ROOT, '..', '..');

const { loadStyle } = await import(path.join(PKG_ROOT, 'src', 'style.mjs'));
const { planVideo } = await import(path.join(PKG_ROOT, 'src', 'composition', 'snapshot-plan.mjs'));

const planPath = process.argv[2];
if (!planPath) {
  console.error('usage: node tools/plan-snapshots.mjs <plan.json>');
  process.exit(2);
}
const absPlan = path.isAbsolute(planPath) ? planPath : path.join(REPO, planPath);
if (!fs.existsSync(absPlan)) {
  console.error(`no such plan file: ${absPlan}`);
  process.exit(2);
}
const plan = JSON.parse(fs.readFileSync(absPlan, 'utf8'));
const style = loadStyle();
const v = plan.video ?? {};
const read = (rel) => (rel ? fs.readFileSync(path.join(REPO, rel), 'utf8') : null);

const outDir = path.join(REPO, v.planDir ?? `data/compositions/${v.id ?? 'video'}/plan`);
const htmlDir = path.join(outDir, 'html');

let result;
try {
  result = await planVideo({
    plan, style, outDir, htmlDir,
    scriptText: read(v.script),
    transcriptJson: v.transcript ? JSON.parse(read(v.transcript)) : null,
  });
} catch (err) {
  console.error(`PLAN FAILED — ${err.message}`);
  process.exit(1);
}

const overflow = result.stills.filter((s) => !s.fit.fits);
console.log(`plan OK — ${result.summary.segments} segments (${result.summary.snapshots} snapshots), ${result.summary.beats} beats`);
console.log(`artifacts → ${result.dir}`);
console.log(`stills    → ${path.join(result.dir, 'stills')}`);
console.log(`grid      → ${result.grid}`);
if (overflow.length) {
  console.log(`\nWARNING: ${overflow.length} still(s) overflow the safe box:`);
  for (const s of overflow) {
    const bad = (s.fit.offenders ?? []).map((o) => `${o.tag}${o.slot ? `[${o.slot}]` : ''}`).join(', ');
    console.log(`  - ${s.id}: content v ${s.fit.vTop}-${s.fit.vBottom} x ${s.fit.xLeft}-${s.fit.xRight} (box v ${s.fit.boxTop}-${s.fit.boxBottom} x ${s.fit.boxLeft}-${s.fit.boxRight})${bad ? ` — ${bad}` : ''}`);
  }
}
console.log('\n' + result.table);
