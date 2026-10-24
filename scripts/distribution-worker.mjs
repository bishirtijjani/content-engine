#!/usr/bin/env node
// content-os distribution worker.
//
// One pass: schedule eligible items, publish due posts, clean expired nginx
// media. Run it from systemd on a timer; state lives in SQLite and survives
// restarts. The PID lock prevents concurrent passes.
//
// It never generates copy, approves gates, or creates posts unless an explicit
// --copy-file is supplied. Publishing is refused for assets that are not
// approved by the engine.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SCHEMA_VERSION,
  connect,
  getDbPath,
  makePaths,
  schemaVersion,
} from '@content-os/core';
import {
  DistributionEngine,
  createPublisherFromSettings,
} from '@content-os/engine-distribution';
import {
  acquireLock,
  releaseLock,
  runWorker,
} from '@content-os/engine-distribution/worker';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const number = (raw) => (raw === null || raw === undefined || raw === '' ? null : Number(raw));

export async function main() {
  if (has('--help') || has('-h')) {
    console.log(`
Usage:
  node scripts/distribution-worker.mjs [--schedule] [--publish] [--cleanup]
                                       [--dry-run] [--target ID] [--post-id ID]
                                       [--json]

  node scripts/distribution-worker.mjs --adapt --copy-file copy.json [--target ID]
  node scripts/distribution-worker.mjs --reset-post POST_ID --confirm

Defaults: schedule + publish + cleanup. --no-schedule/--no-publish/--no-cleanup
disable a phase. --adapt requires --copy-file; the worker never invents copy.
`);
    return 0;
  }

  const lockPath = value('--lock-file')
    || path.join(makePaths().tmpDir(), 'distribution-worker.lock');
  const json = has('--json');
  const dryRun = has('--dry-run');
  const targetId = number(value('--target'));
  const postId = number(value('--post-id'));
  const resetPost = number(value('--reset-post'));
  const adapt = has('--adapt');
  const copyFile = value('--copy-file');
  const platforms = value('--platforms')
    ? value('--platforms').split(',').map((item) => item.trim()).filter(Boolean)
    : null;

  if (adapt && !copyFile) {
    console.error('--adapt requires --copy-file; the worker never generates platform copy');
    return 1;
  }
  if (resetPost !== null && !has('--confirm')) {
    console.error('--reset-post requires --confirm after checking the platform');
    return 1;
  }
  if (dryRun && resetPost !== null) {
    console.error('--reset-post writes state and cannot be combined with --dry-run');
    return 1;
  }
  if (dryRun && !existsSync(getDbPath())) {
    console.error(`--dry-run requires an existing database: ${getDbPath()}`);
    return 1;
  }

  let copy = null;
  if (copyFile) {
    try {
      copy = JSON.parse(readFileSync(copyFile, 'utf8'));
    } catch (err) {
      console.error(`Cannot read copy file ${copyFile}: ${err.message}`);
      return 1;
    }
    if (!copy || typeof copy !== 'object' || Array.isArray(copy)) {
      console.error('copy file must contain a JSON object keyed by platform or platform:account');
      return 1;
    }
  }

  // A dry run never publishes and must not create even a lock file.
  const lock = dryRun ? { acquired: true, pid: null } : acquireLock(lockPath);
  if (!lock.acquired) {
    emit({ status: 'locked', lock: lock.existing, lockPath }, json);
    return 0;
  }

  let db = null;
  let closed = false;
  const cleanup = () => {
    if (!dryRun) releaseLock(lockPath);
    if (!closed && db) {
      try { db.close(); } catch { /* already closed */ }
      closed = true;
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  let exitCode = 0;

  try {
    // Dry run never migrates. A real run may apply pending migrations once.
    db = connect(undefined, { ensure: !dryRun });

    if (dryRun && schemaVersion(db) < SCHEMA_VERSION) {
      emit({
        status: 'error',
        error: `schema v${SCHEMA_VERSION} required for --dry-run; run once without --dry-run to migrate`,
      }, json);
      return 1;
    }

    if (resetPost !== null) {
      const engine = new DistributionEngine(db, {});
      const reset = engine.resetPublishState({ postId: resetPost, confirm: true });
      emit({ status: 'ok', reset }, json);
      return 0;
    }

    const publisher = createPublisherFromSettings({ db });
    const result = await runWorker({
      db,
      publisher,
      schedule: !has('--no-schedule'),
      publish: !has('--no-publish'),
      cleanup: !has('--no-cleanup'),
      dryRun,
      targetId,
      postId,
      adaptCopy: adapt ? copy : null,
      platforms,
    });

    const partial = result.errors.length > 0 || (result.published?.failed ?? 0) > 0;
    emit({
      status: partial ? 'partial' : 'ok',
      ...result,
    }, json);
    exitCode = result.errors.length ? 1 : 0;
  } catch (err) {
    emit({ status: 'error', error: err.message }, json);
    exitCode = 1;
  } finally {
    cleanup();
  }

  return exitCode;
}

function emit(payload, json) {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`content-os distribution: ${payload.status}`);
  if (payload.health) {
    console.log(`publishers: ${payload.health.publishers.join(', ') || 'none'}`);
    for (const [account, reason] of Object.entries(payload.health.missing ?? {})) {
      console.log(`missing ${account}: ${reason}`);
    }
  }
  if (payload.adapted) {
    console.log(`adapted: ${payload.adapted.processed ?? 0} written, ${payload.adapted.skipped ?? 0} skipped`);
  }
  if (payload.scheduled) {
    console.log(`scheduled: ${payload.scheduled.scheduled ?? 0} posts, ${payload.scheduled.preserved ?? 0} kept, ${payload.scheduled.deferred ?? 0} deferred`);
  }
  if (payload.published) {
    console.log(`published: ${payload.published.published ?? 0}, failed: ${payload.published.failed ?? 0}`);
  }
  if (payload.cleanupRemoved) {
    console.log(`media cleanup: ${payload.cleanupRemoved} expired file(s)`);
  }
  for (const error of payload.errors ?? []) {
    console.log(`error: ${error}`);
  }
  if (payload.error) console.log(`error: ${payload.error}`);
  if (payload.lock) {
    console.log(`already running: pid ${payload.lock.pid} since ${payload.lock.startedAt}`);
  }
  if (payload.reset) {
    console.log(`reset publish state for post ${payload.reset.postId}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`content-os distribution failed: ${err.message}`);
      process.exitCode = 1;
    });
}
