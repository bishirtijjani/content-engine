// Distribution worker: schedule eligible items, publish due posts, clean up
// expired media. The systemd timer runs this once per interval; state lives in
// SQLite, so a restart resumes naturally.
import {
  closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import { DistributionEngine } from './index.js';

/** Acquire an exclusive PID lock. Stale or unparsable locks are replaced. */
export function acquireLock(lockPath, {
  pid = process.pid,
  isAlive = defaultIsAlive,
  retries = 3,
  staleAfterMs = 2 * 60 * 60 * 1000,
  now = Date.now,
} = {}) {
  mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });

  let existing = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      writeSync(fd, JSON.stringify({
        pid,
        startedAt: new Date(now()).toISOString(),
      }));
      closeSync(fd);
      return { acquired: true, pid };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }

    try {
      existing = JSON.parse(readFileSync(lockPath, 'utf8'));
    } catch {
      existing = null;
    }

    const startedAt = existing?.startedAt ? Date.parse(existing.startedAt) : NaN;
    const alive = Boolean(existing?.pid && isAlive(existing.pid));
    const tooOld = Number.isFinite(startedAt) && now() - startedAt > staleAfterMs;

    if (alive && !tooOld) {
      return { acquired: false, existing };
    }

    try {
      unlinkSync(lockPath);
    } catch {
      // Another process may have replaced it; the bounded loop retries.
    }
  }

  return {
    acquired: false,
    existing,
    error: 'lock remains busy after bounded retries',
  };
}

export function releaseLock(lockPath, pid = process.pid) {
  try {
    const existing = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (existing?.pid === pid) unlinkSync(lockPath);
  } catch {
    // Missing or malformed lock: nothing safe to remove.
  }
}

/**
 * One worker pass.
 *
 * `adaptCopy` is optional and is only used when the caller explicitly supplies
 * agent-written platform copy. The worker never generates copy or approves
 * gates.
 */
export async function runWorker({
  db,
  publisher,
  schedule = true,
  publish = true,
  cleanup = true,
  dryRun = false,
  targetId = null,
  postId = null,
  adaptCopy = null,
  platforms = null,
} = {}) {
  if (!db) throw new Error('runWorker requires { db }');
  if (!publisher) throw new Error('runWorker requires { publisher }');

  const engine = new DistributionEngine(db, { publisher });
  const result = {
    adapted: null,
    scheduled: null,
    published: null,
    cleanupRemoved: 0,
    health: typeof publisher.health === 'function' ? publisher.health() : null,
    errors: [],
  };

  try {
    if (adaptCopy) {
      result.adapted = engine.adapt({ targetId, copy: adaptCopy, platforms, dryRun });
    }

    if (schedule) {
      result.scheduled = engine.schedule({ targetId, dryRun });
    }

    if (publish) {
      try {
        result.published = await engine.publish({ targetId, postId, dryRun });
      } catch (err) {
        result.errors.push(`publish: ${err.message}`);
      }
    }

    if (cleanup && !dryRun && typeof publisher.cleanup === 'function') {
      try {
        result.cleanupRemoved = await publisher.cleanup();
      } catch (err) {
        result.errors.push(`cleanup: ${err.message}`);
      }
    }
  } catch (err) {
    result.errors.push(err.message);
  }

  if (!dryRun) {
    engine.log('worker', {
      status: result.errors.length ? 'error' : 'success',
      message: JSON.stringify({
        adapted: result.adapted?.processed ?? null,
        scheduled: result.scheduled?.scheduled ?? null,
        published: result.published?.published ?? null,
        failed: result.published?.failed ?? null,
        cleanupRemoved: result.cleanupRemoved,
        errors: result.errors.length,
      }),
    });
  }

  return result;
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}
