// Distribution Engine — "Where, when and how should this be published?"
//
//   adapt    — validate agent-written platform copy and write one post per
//              eligible platform/account. Idempotent. Published rows are never
//              touched.
//   schedule — assign one UTC slot to every account of an item from the
//              configured timezone, days and windows; respect platform cadence,
//              minimum spacing and existing calendar entries. Idempotent, and
//              it never moves a published post or a valid future schedule.
//   publish  — hand due posts to an injected publisher, retry, record the
//              result, and never send a post that already has an external id.
//   crossPost — the same fan-out as adapt, kept as an alias so there is one
//              code path that creates posts.
//
// The engine never writes copy, never encodes video, and never calls a
// platform API directly. A real adapter implements the publisher contract:
//
//   { async publish({ platform, account, post, asset, item })
//       -> { externalId: string, url?: string } }
//
// Owned states: scheduled
import { randomUUID } from 'node:crypto';
import { BaseEngine, parseJson, transition } from '@content-os/core';
import { validateCopy } from './platforms.mjs';
import { loadSettings, resolveAccounts } from './accounts.mjs';
import {
  buildCandidateSlots,
  resolveScheduleConfig,
  weekRangeUtc,
} from './scheduling.mjs';

const ACTION_METHODS = {
  adapt: 'adapt',
  schedule: 'schedule',
  publish: 'publish',
  cross_post: 'crossPost',
};

export class DistributionEngine extends BaseEngine {
  static NAME = 'distribution';
  static OWNED_STATES = ['scheduled'];
  static ACTIONS = Object.keys(ACTION_METHODS);

  /**
   * @param {object} db
   * @param {object} [opts]
   * @param {object} [opts.publisher] - injected platform publisher (no network
   *   calls live in this engine)
   * @param {() => Date} [opts.clock] - frozen clock for tests
   * @param {number} [opts.maxAttempts] - attempts per post before marking failed
   */
  constructor(db, {
    publisher = null,
    clock = () => new Date(),
    maxAttempts = 3,
    claimTtlMs = 45 * 60 * 1000,
  } = {}) {
    super(db);
    this.publisher = publisher;
    this.clock = clock;
    this.maxAttempts = Math.max(1, Number(maxAttempts) || 1);
    this.claimTtlMs = Math.max(1000, Number(claimTtlMs) || 45 * 60 * 1000);
  }

  // =========================================================================
  // ADAPT — validate the agent's copy and write one post per eligible account
  // =========================================================================

  /**
   * @param {object} opts
   * @param {number} [opts.targetId] - one item; otherwise every scheduled item
   * @param {object} [opts.copy] - agent-written copy. Keys are
   *   "<platform>:<account>", then "<platform>", then "default".
   * @param {string[]} [opts.platforms] - explicit platform override
   * @param {boolean} [opts.dryRun]
   * @returns {{ processed: number, skipped: number, preserved: number,
   *             posts: Array<object> }}
   */
  adapt({ targetId = null, copy = null, platforms = null, dryRun = false } = {}) {
    const items = this._scheduledItems(targetId);
    const settings = loadSettings(this.db);
    const result = { processed: 0, skipped: 0, preserved: 0, posts: [] };

    for (const item of items) {
      // A published item may still need a newly configured platform/account.
      // Existing posts are preserved; only missing posts are created.
      if (item.status !== 'scheduled' && item.status !== 'published') {
        this._logSkip('adapt', item.id, `item is '${item.status}', expected 'scheduled' or 'published'`, dryRun);
        result.skipped++;
        continue;
      }

      const accounts = resolveAccounts(settings, { item, platforms });
      if (!accounts.length) {
        this._logSkip('adapt', item.id, 'no enabled and authorized account is eligible', dryRun);
        result.skipped++;
        continue;
      }

      const asset = this._approvedAsset(item.id);
      const hasNonLinkedin = accounts.some((account) => account.platform !== 'linkedin');
      if (!asset && hasNonLinkedin) {
        this._logSkip('adapt', item.id, 'no approved asset to publish', dryRun);
        result.skipped++;
        continue;
      }

      for (const account of accounts) {
        if (account.platform !== 'linkedin' && !asset) {
          this._logSkip('adapt', item.id, `${account.platform}:${account.account} needs an approved asset`, dryRun);
          result.skipped++;
          continue;
        }
        const raw = this._copyFor(copy, account.platform, account.account);
        if (!raw) {
          this._logSkip('adapt', item.id, `${account.platform}:${account.account} has no copy`, dryRun);
          result.skipped++;
          continue;
        }

        const checked = validateCopy(account.platform, raw);
        if (!checked.ok) {
          this._logSkip(
            'adapt', item.id,
            `${account.platform}:${account.account} copy rejected — ${checked.reason}`,
            dryRun
          );
          result.skipped++;
          continue;
        }

        if (dryRun) {
          result.processed++;
          result.posts.push({
            platform: account.platform,
            account: account.account,
            status: 'would_schedule',
          });
          continue;
        }

        const written = this._writePost(item, account, checked.value, asset);
        if (written.blocked) {
          result.skipped++;
          this.log('adapt', {
            status: 'skipped', targetType: 'post', targetId: written.row.id,
            message: `${account.platform}:${account.account} not updated — ${written.reason}`,
          });
          continue;
        }
        if (written.preserved) {
          result.preserved++;
          this.log('adapt', {
            targetType: 'post', targetId: written.row.id,
            message: `preserved published ${account.platform}:${account.account} post`,
          });
        } else {
          result.processed++;
          this.log('adapt', {
            targetType: 'post', targetId: written.row.id,
            message: `${written.created ? 'created' : 'updated'} ${account.platform}:${account.account} post`,
          });
        }
        result.posts.push({
          id: written.row.id,
          platform: account.platform,
          account: account.account,
          status: written.row.status,
        });
      }
    }

    if (!dryRun) {
      this.log('adapt', {
        message: `${result.processed} post(s) written, ${result.skipped} skipped, ` +
          `${result.preserved} published preserved`,
      });
    }
    return result;
  }

  // =========================================================================
  // SCHEDULE — one UTC slot per item, shared by every account
  // =========================================================================

  /**
   * Rules:
   * - one slot per content item, shared by every active account;
   * - a future slot already on the item is kept when it does not collide;
   * - published and skipped posts are never scheduled;
   * - a missing approved asset skips the item;
   * - items are processed in id order and the earliest valid slot wins;
   * - no slot within the horizon leaves the item deferred, not failed.
   *
   * @param {object} opts
   * @param {number} [opts.targetId]
   * @param {boolean} [opts.dryRun]
   * @returns {{ processed: number, scheduled: number, preserved: number,
   *             skipped: number, deferred: number, missed: number,
   *             items: Array<object> }}
   */
  schedule({ targetId = null, dryRun = false } = {}) {
    const now = this._clockDate();
    const settings = loadSettings(this.db);
    const config = resolveScheduleConfig(settings);
    const items = this._scheduledItems(targetId);
    const slots = buildCandidateSlots(config, now);

    return this._atomic(() => {
      const result = {
        processed: 0, scheduled: 0, preserved: 0,
        skipped: 0, deferred: 0, missed: 0, items: [],
      };

      for (const item of items) {
        if (item.status !== 'scheduled') {
          this._logSkip('schedule', item.id, `item is '${item.status}', expected 'scheduled'`);
          result.skipped++;
          continue;
        }

        const outcome = this._scheduleItem({ item, config, slots, now });
        result.processed += outcome.processed;
        result.scheduled += outcome.scheduled;
        result.preserved += outcome.preserved;
        result.skipped += outcome.skipped;
        result.deferred += outcome.deferred;
        result.missed += outcome.missed;
        if (outcome.entry) result.items.push(outcome.entry);
      }

      this.log('schedule', {
        message: `${result.processed} item(s) settled, ${result.scheduled} post(s) placed, ` +
          `${result.preserved} kept, ${result.deferred} deferred, ${result.skipped} skipped` +
          `${dryRun ? ' (dry run)' : ''}`,
      });
      return result;
    }, { dryRun });
  }

  // =========================================================================
  // PUBLISH — send due posts through the injected publisher
  // =========================================================================

  /**
   * @param {object} opts
   * @param {number} [opts.targetId] - only this item's posts
   * @param {number} [opts.postId] - only this post, even before its slot
   * @param {boolean} [opts.dryRun]
   * @param {number} [opts.maxAttempts] - overrides the engine default
   * @returns {Promise<{ processed: number, published: number, failed: number,
   *                     skipped: number, posts: Array<object> }>}
   */
  async publish({ targetId = null, postId = null, dryRun = false, maxAttempts = null } = {}) {
    if (!this.publisher) {
      throw new Error(
        'distribution.publish needs a publisher — inject one with ' +
        'new DistributionEngine(db, { publisher })'
      );
    }

    const now = this._nowIso();
    const touched = new Set();
    if (!dryRun) {
      for (const itemId of this._reconcileExternal(now)) touched.add(itemId);
    }

    const posts = this._duePosts({ targetId, postId, now });
    const attempts = Math.max(1, Number(maxAttempts) || this.maxAttempts);
    const result = { processed: 0, published: 0, failed: 0, skipped: 0, drafts: 0, posts: [] };

    for (const post of posts) {
      if (dryRun) {
        const asset = post.asset_id
          ? this._asset(post.asset_id)
          : (post.platform === 'linkedin' ? null : this._approvedAsset(post.content_item_id));
        const publishable = post.platform === 'linkedin'
          ? true
          : Boolean(asset && asset.status === 'approved');
        result.processed++;
        if (!publishable) result.failed++;
        result.posts.push({
          id: post.id,
          platform: post.platform,
          account: post.account,
          status: publishable ? 'would_publish' : 'would_fail',
          reason: publishable ? null : (asset ? 'asset is not approved' : 'asset not found'),
        });
        continue;
      }

      const claim = this._claimPost(post.id, this._nowIso());
      if (!claim) {
        result.skipped++;
        result.posts.push({
          id: post.id, platform: post.platform, account: post.account,
          status: 'skipped',
          reason: 'not claimable (already published or claimed by another publisher)',
        });
        this.log('publish', {
          status: 'skipped', targetType: 'post', targetId: post.id,
          message: `${post.platform}:${post.account} is already published or claimed by another publisher`,
        });
        continue;
      }

      // The due list was read before the claim. Publish only from the row the
      // claim returned, so status, asset and publish_state are current.
      const claimed = claim.row;

      if (claimed.platform === 'linkedin') {
        claimed.assets = this.db.prepare(
          "SELECT * FROM assets WHERE content_item_id = ? AND status = 'approved' ORDER BY id"
        ).all(claimed.content_item_id);
      }

      try {
        const item = this._item(claimed.content_item_id);
        let asset = null;
        if (claimed.asset_id) {
          asset = this._asset(claimed.asset_id);
        } else if (claimed.platform !== 'linkedin') {
          asset = this._approvedAsset(claimed.content_item_id);
        }

        const assetRequired = claimed.platform !== 'linkedin' || claimed.asset_id !== null;
        if (assetRequired && (!asset || asset.status !== 'approved')) {
          const reason = asset ? 'asset is not approved' : 'asset not found';
          this._markFailed(claimed.id, reason);
          result.processed++;
          result.failed++;
          result.posts.push({
            id: claimed.id, platform: claimed.platform, account: claimed.account,
            status: 'failed', reason,
          });
          this.log('publish', {
            status: 'error', targetType: 'post', targetId: claimed.id,
            message: `${claimed.platform}:${claimed.account} — ${reason}`,
          });
          continue;
        }

        // Provider state survives retries and process restarts. A publisher
        // writes its container id before doing anything that cannot be undone.
        let publishState = parseJson(claimed.publish_state) ?? null;
        const updateState = (patch) => {
          publishState = patch === null
            ? null
            : { ...(publishState ?? {}), ...patch };
          this.db.prepare(
            "UPDATE posts SET publish_state = ?, updated_at = datetime('now') WHERE id = ?"
          ).run(publishState ? JSON.stringify(publishState) : null, claimed.id);
        };

        let delivered = null;
        let lastError = null;
        let claimLost = false;

        for (let attempt = 1; attempt <= attempts; attempt++) {
          if (!this._renewClaim(claimed.id, claim.id)) {
            claimLost = true;
            break;
          }
          try {
            const out = await this.publisher.publish({
              platform: claimed.platform,
              account: claimed.account,
              post: { ...claimed, hashtags: parseJson(claimed.hashtags) ?? [] },
              asset,
              assets: claimed.assets ?? null,
              item,
              state: publishState ? { ...publishState } : null,
              updateState,
            });
            if (!out || typeof out.externalId !== 'string' || !out.externalId) {
              throw new Error('publisher returned no externalId');
            }
            delivered = out;
            break;
          } catch (err) {
            lastError = err;
            if (err?.retryable === false) break;
          }
        }

        if (claimLost) {
          result.skipped++;
          result.posts.push({
            id: claimed.id, platform: claimed.platform, account: claimed.account,
            status: 'skipped', reason: 'publish claim expired',
          });
          this.log('publish', {
            status: 'skipped', targetType: 'post', targetId: claimed.id,
            message: `${claimed.platform}:${claimed.account} publish claim expired; another publisher owns it`,
          });
          continue;
        }

        result.processed++;
        if (delivered?.draft) {
          this._markDraft(claimed.id, delivered.externalId, delivered.url ?? null);
          result.drafts++;
          const warnings = Array.isArray(delivered.warnings) ? delivered.warnings : [];
          result.posts.push({
            id: claimed.id, platform: claimed.platform, account: claimed.account,
            status: 'draft',
            draft: true,
            manualCompletionRequired: delivered.manualCompletionRequired !== false,
            draftId: delivered.externalId,
            warnings,
          });
          this.log('publish', {
            targetType: 'post', targetId: claimed.id,
            message: `uploaded ${claimed.platform}:${claimed.account} to TikTok inbox as ${delivered.externalId}; manual completion required`,
          });
          if (warnings.length) {
            this.log('publish', {
              targetType: 'post', targetId: claimed.id,
              message: `uploaded ${claimed.platform}:${claimed.account} as ${delivered.externalId} ` +
                `with warnings: ${warnings.join('; ')}`,
            });
          }
        } else if (delivered) {
          this._markPublished(claimed.id, now, delivered.externalId, delivered.url ?? null);
          result.published++;
          const warnings = Array.isArray(delivered.warnings) ? delivered.warnings : [];
          result.posts.push({
            id: claimed.id, platform: claimed.platform, account: claimed.account,
            status: 'published', warnings,
          });
          this.log('publish', {
            targetType: 'post', targetId: claimed.id,
            message: `published ${claimed.platform}:${claimed.account} as ${delivered.externalId}`,
          });
          if (warnings.length) {
            this.log('publish', {
              targetType: 'post', targetId: claimed.id,
              message: `published ${claimed.platform}:${claimed.account} as ${delivered.externalId} ` +
                `with warnings: ${warnings.join('; ')}`,
            });
          }
        } else {
          const message = errorMessage(lastError);
          this._markFailed(claimed.id, message);
          result.failed++;
          result.posts.push({
            id: claimed.id, platform: claimed.platform, account: claimed.account,
            status: 'failed',
          });
          this.log('publish', {
            status: 'error', targetType: 'post', targetId: claimed.id,
            message: `${claimed.platform}:${claimed.account} failed — ${message}`,
          });
        }
        touched.add(claimed.content_item_id);
      } finally {
        this._releaseClaim(claimed.id, claim.id);
      }
    }

    if (!dryRun) {
      this._settleItems([...touched]);
      this._reconcileSettledItems();
      this.log('publish', {
        message: `${result.published} published, ${result.drafts} draft(s), ` +
          `${result.failed} failed, ${result.skipped} skipped`,
      });
    }
    return result;
  }

  // =========================================================================
  // RECOVERY — explicit operator action only
  // =========================================================================

  /**
   * Clear provider state after a human has verified that no duplicate exists.
   * This is the ONLY automatic-state exception, and it requires confirmation.
   */
  resetPublishState({ postId = null, confirm = false } = {}) {
    if (!postId) throw new Error('resetPublishState requires { postId }');
    if (!confirm) {
      throw new Error(
        'resetPublishState requires { confirm: true } after checking the platform for an existing post'
      );
    }

    const post = this.db.prepare(
      'SELECT id, status, external_id, publish_state FROM posts WHERE id = ?'
    ).get(postId);
    if (!post) throw new Error(`post ${postId} not found`);
    if (post.status === 'published' || post.external_id) {
      throw new Error(`post ${postId} is published; refusing to reset its state`);
    }

    this.db.prepare(
      "UPDATE posts SET publish_state = NULL, publish_claim_id = NULL, " +
      "publish_claim_expires_at = NULL, publish_error = NULL, " +
      "status = 'scheduled', updated_at = datetime('now') WHERE id = ?"
    ).run(postId);
    this.log('reset_publish_state', {
      targetType: 'post', targetId: postId,
      message: 'operator cleared provider state after verification',
    });
    return { postId, reset: true };
  }

  // =========================================================================
  // CROSS-POST — the same fan-out as adapt
  // =========================================================================

  crossPost(options = {}) {
    return this.adapt(options);
  }

  // =========================================================================
  // RUN — dispatch to one action, or adapt the waiting queue
  // =========================================================================

  run({ targetId = null, action = null, dryRun = false, copy = null, platforms = null } = {}) {
    if (action) {
      const method = ACTION_METHODS[action];
      if (!method) {
        throw new Error(
          `unknown distribution action '${action}' — available: ${this.constructor.ACTIONS.join(', ')}`
        );
      }
      return this[method]({ targetId, dryRun, copy, platforms });
    }
    return this.pipeline({ targetId, dryRun, copy, platforms });
  }

  /**
   * Adapt the waiting queue. Publishing is never part of the pipeline: the
   * agent calls publish at the slot, after the weekly plan is reviewed.
   */
  pipeline({ targetId = null, copy = null, platforms = null, dryRun = false } = {}) {
    return this.adapt({ targetId, copy, platforms, dryRun });
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  _scheduledItems(targetId) {
    if (targetId) {
      // An explicitly requested item may already be published on another
      // platform; late platform posts still need to be adapted without moving
      // the item or its existing posts.
      return [this._item(targetId)];
    }
    return this.db.prepare(
      "SELECT * FROM content_items WHERE status = 'scheduled' ORDER BY id"
    ).all();
  }

  _item(id) {
    const row = this.db.prepare('SELECT * FROM content_items WHERE id = ?').get(id);
    if (!row) throw new Error(`content item ${id} not found`);
    return row;
  }

  _asset(id) {
    return this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) ?? null;
  }

  _approvedAsset(itemId) {
    return this.db.prepare(
      "SELECT * FROM assets WHERE content_item_id = ? AND status = 'approved' " +
      'ORDER BY id DESC LIMIT 1'
    ).get(itemId) ?? null;
  }

  _copyFor(copy, platform, account) {
    if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return null;
    for (const key of [`${platform}:${account}`, platform, 'default']) {
      const value = copy[key];
      if (value !== undefined && value !== null) return value;
    }
    return null;
  }

  /** Find the one row for this item/platform/account, including legacy NULL rows. */
  _findPost(itemId, platform, account) {
    return this.db.prepare(
      'SELECT * FROM posts WHERE content_item_id = ? AND platform = ? ' +
      'AND (account = ? OR (account IS NULL AND ? = ?)) ' +
      'ORDER BY id LIMIT 1'
    ).get(itemId, platform, account, account, 'default') ?? null;
  }

  _writePost(item, account, copy, asset) {
    const assetId = asset ? asset.id : null;
    const existing = this._findPost(item.id, account.platform, account.account);
    const published = existing && (existing.status === 'published' || existing.external_id);
    if (published) {
      return { preserved: true, created: false, row: existing };
    }

    // Never erase provider state while a container, upload or publish may
    // exist. The old copy must stay attached to the in-flight operation.
    if (existing) {
      const liveClaim = Boolean(
        existing.publish_claim_id
        && existing.publish_claim_expires_at
        && existing.publish_claim_expires_at > this._nowIso()
      );
      if (hasPublishInFlight(parseJson(existing.publish_state)) || liveClaim) {
        return {
          preserved: false,
          created: false,
          blocked: true,
          reason: 'a publish is in progress or unresolved; resolve it before changing copy',
          row: existing,
        };
      }
    }

    if (existing) {
      this.db.prepare(
        "UPDATE posts SET account = ?, asset_id = ?, title = ?, caption = ?, " +
        "description = ?, hashtags = ?, thumbnail_path = ?, status = 'scheduled', " +
        "publish_error = NULL, publish_state = NULL, " +
        "updated_at = datetime('now') WHERE id = ?"
      ).run(
         account.account, assetId, copy.title, copy.caption, copy.description,
        JSON.stringify(copy.hashtags), copy.thumbnail_path, existing.id
      );
      return {
        preserved: false,
        created: false,
        row: this.db.prepare('SELECT * FROM posts WHERE id = ?').get(existing.id),
      };
    }

    const res = this.db.prepare(
      "INSERT INTO posts (content_item_id, asset_id, platform, account, status, " +
      "title, caption, description, hashtags, thumbnail_path) " +
      "VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)"
    ).run(
       item.id, assetId, account.platform, account.account,
      copy.title, copy.caption, copy.description,
      JSON.stringify(copy.hashtags), copy.thumbnail_path
    );
    return {
      preserved: false,
      created: true,
      row: this.db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(res.lastInsertRowid)),
    };
  }

  _duePosts({ targetId = null, postId = null, now }) {
    const clauses = [
      "p.status IN ('scheduled', 'failed')",
      'p.external_id IS NULL',
      "i.status IN ('scheduled', 'published')",
    ];
    const params = [];
    if (postId) {
      clauses.push('p.id = ?');
      params.push(postId);
    } else {
      clauses.push('(p.scheduled_at IS NULL OR p.scheduled_at <= ?)');
      params.push(now);
      if (targetId) {
        clauses.push('p.content_item_id = ?');
        params.push(targetId);
      }
    }
    return this.db.prepare(
      `SELECT p.* FROM posts p JOIN content_items i ON i.id = p.content_item_id ` +
      `WHERE ${clauses.join(' AND ')} ORDER BY p.id`
    ).all(...params);
  }

  /**
   * A post with an external id already exists on the platform, even if a crash
   * stopped the database write. Mark it published instead of sending it again.
   */
  _reconcileExternal(now) {
    const items = this.db.prepare(
      "SELECT DISTINCT content_item_id AS id FROM posts " +
      "WHERE external_id IS NOT NULL AND status != 'published'"
    ).all().map((row) => row.id);
    this.db.prepare(
      "UPDATE posts SET status = 'published', published_at = COALESCE(published_at, ?), " +
      "publish_error = NULL, publish_state = NULL, updated_at = datetime('now') " +
      "WHERE external_id IS NOT NULL AND status != 'published'"
    ).run(now);
    return items;
  }

  _markPublished(postId, now, externalId, url) {
    this.db.prepare(
      "UPDATE posts SET status = 'published', published_at = ?, external_id = ?, " +
      "url = ?, publish_error = NULL, publish_state = NULL, " +
      "updated_at = datetime('now') WHERE id = ?"
    ).run(now, externalId, url, postId);
  }

  _markFailed(postId, message) {
    this.db.prepare(
      "UPDATE posts SET status = 'failed', publish_error = ?, " +
      "updated_at = datetime('now') WHERE id = ?"
    ).run(message, postId);
  }

  _markDraft(postId, draftId, url = null) {
    const state = {
      stage: 'inbox_uploaded',
      publishId: draftId,
      url: url ?? null,
      uploadedAt: this._nowIso(),
    };
    this.db.prepare(
      "UPDATE posts SET status = 'draft', publish_state = ?, publish_error = NULL, " +
      "updated_at = datetime('now') WHERE id = ?"
    ).run(JSON.stringify(state), postId);
  }

  /**
   * Atomically claim a post for one publisher. The UPDATE is the lock: only
   * one process can change the row from unclaimed/expired to its own claim.
   * A published post, or a post with an external id, is never claimable. A
   * crashed process leaves an expired lease that the next run can reclaim.
   * RETURNING gives the caller the post-claim row, never the stale due-list row.
   */
  _claimPost(postId, nowIso) {
    const claimId = randomUUID();
    const expiresAt = new Date(Date.parse(nowIso) + this.claimTtlMs).toISOString();

    const row = this.db.prepare(
      "UPDATE posts SET publish_claim_id = ?, publish_claim_expires_at = ?, " +
      "updated_at = datetime('now') WHERE id = ? " +
      "AND status IN ('scheduled', 'failed') AND external_id IS NULL " +
      "AND (publish_claim_id IS NULL OR publish_claim_expires_at IS NULL " +
      'OR publish_claim_expires_at <= ?) RETURNING *'
    ).get(claimId, expiresAt, postId, nowIso);

    return row ? { id: claimId, expiresAt, row } : null;
  }

  _renewClaim(postId, claimId) {
    const expiresAt = new Date(
      this._clockDate().getTime() + this.claimTtlMs
    ).toISOString();

    const result = this.db.prepare(
      "UPDATE posts SET publish_claim_expires_at = ?, updated_at = datetime('now') " +
      'WHERE id = ? AND publish_claim_id = ?'
    ).run(expiresAt, postId, claimId);

    return result.changes === 1;
  }

  _releaseClaim(postId, claimId) {
    this.db.prepare(
      'UPDATE posts SET publish_claim_id = NULL, publish_claim_expires_at = NULL, ' +
      "updated_at = datetime('now') WHERE id = ? AND publish_claim_id = ?"
    ).run(postId, claimId);
  }

  /**
   * Move an item to published only when every post is settled (published or
   * skipped) and at least one was published. A failed post keeps the item in
   * scheduled so publish can retry it.
   */
  _settleItems(itemIds) {
    for (const itemId of itemIds) {
      const item = this.db.prepare(
        'SELECT id, status FROM content_items WHERE id = ?'
      ).get(itemId);
      if (!item || item.status !== 'scheduled') continue;

      const counts = {};
      for (const row of this.db.prepare(
        'SELECT status, COUNT(*) AS n FROM posts WHERE content_item_id = ? GROUP BY status'
      ).all(itemId)) {
        counts[row.status] = row.n;
      }

      const pending = (counts.scheduled ?? 0) + (counts.failed ?? 0) + (counts.draft ?? 0);
      if ((counts.published ?? 0) > 0 && pending === 0) {
        transition(this.db, itemId, 'published', {
          actor: `engine:${this.name}`,
          reason: 'every platform post settled',
        });
      }
    }
  }

  /**
   * Crash recovery: an item can be left scheduled when the process dies after
   * the final post is marked published but before _settleItems runs. Settle
   * every scheduled item that already has a published post and no pending one.
   */
  _reconcileSettledItems() {
    const rows = this.db.prepare(
      'SELECT ci.id FROM content_items ci ' +
      "WHERE ci.status = 'scheduled' " +
      'AND EXISTS (SELECT 1 FROM posts p ' +
      "WHERE p.content_item_id = ci.id AND p.status = 'published') " +
      'AND NOT EXISTS (SELECT 1 FROM posts p ' +
      "WHERE p.content_item_id = ci.id AND p.status IN ('scheduled', 'failed', 'draft')) " +
      'ORDER BY ci.id'
    ).all();

    if (rows.length) this._settleItems(rows.map((row) => row.id));
    return rows.length;
  }

  // =========================================================================
  // SCHEDULING HELPERS
  // =========================================================================

  _scheduleItem({ item, config, slots, now }) {
    const out = {
      processed: 0, scheduled: 0, preserved: 0,
      skipped: 0, deferred: 0, missed: 0, entry: null,
    };

    const posts = this.db.prepare(
      'SELECT * FROM posts WHERE content_item_id = ? ORDER BY platform, account, id'
    ).all(item.id);

    const active = posts.filter((post) =>
      post.status !== 'published' && !post.external_id && post.status !== 'skipped'
    );
    const skipped = posts.filter((post) => post.status === 'skipped');

    for (const post of skipped) {
      out.missed += this._retireSkipped(post, now);
    }

    if (!active.length) {
      this._logSkip(
        'schedule', item.id,
        posts.length ? 'every post is already published or skipped' : 'item has no posts'
      );
      out.skipped++;
      return out;
    }

    // One approved master. Repair a missing or stale asset reference instead of
    // scheduling a post that cannot publish.
    const master = this._approvedAsset(item.id);
    if (!master) {
      this._logSkip('schedule', item.id, 'no approved asset to publish');
      out.skipped++;
      return out;
    }
    for (const post of active) {
      const current = post.asset_id ? this._asset(post.asset_id) : null;
      if (!current || current.status !== 'approved') {
        this.db.prepare(
          "UPDATE posts SET asset_id = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(master.id, post.id);
        post.asset_id = master.id;
      }
    }

    // Keep the earliest future slot that the item already owns and that does
    // not collide with another item. Published posts never reach this branch.
    const future = active
      .map((post) => parseScheduled(post.scheduled_at))
      .filter((at) => at && at.getTime() > now.getTime())
      .sort((a, b) => a.getTime() - b.getTime());
    const kept = future.find((at) =>
      !this._slotBlocked(item.id, at, config.minSpacingMinutes)
    ) ?? null;

    const preserved = Boolean(kept);
    const slot = kept ?? this._findSlot(item.id, active, config, slots);

    if (!slot) {
      // A future time that lost its slot to another item must not stay on the
      // books: that is exactly the collision this method prevents.
      if (future.length) out.missed += this._clearFutureSchedule(active, now);
      this._logSkip(
        'schedule', item.id,
        `no available slot within ${config.horizonDays} day(s)`
      );
      out.deferred++;
      return out;
    }

    const iso = slot.toISOString();
    for (const post of active) {
      if (post.scheduled_at !== iso) {
        this.db.prepare(
          "UPDATE posts SET scheduled_at = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(iso, post.id);
        post.scheduled_at = iso;
      }
      this._writeCalendarEntry({ item, post, slotIso: iso, now });
    }

    out.processed = 1;
    if (preserved) out.preserved = active.length;
    else out.scheduled = active.length;
    out.entry = {
      id: item.id,
      scheduled_at: iso,
      preserved,
      posts: active.map((post) => ({
        id: post.id, platform: post.platform, account: post.account,
      })),
    };

    this.log('schedule', {
      targetType: 'content_item', targetId: item.id,
      message: `${preserved ? 'kept' : 'scheduled'} ${active.length} post(s) at ${iso}`,
    });
    return out;
  }

  /**
   * One calendar row per post, even when accounts share a slot. A future plan
   * is updated in place; a past plan is marked missed and a new row is added.
   */
  _writeCalendarEntry({ item, post, slotIso, now }) {
    const entries = this.db.prepare(
      "SELECT * FROM calendar_entries WHERE post_id = ? AND kind = 'publish' " +
      "AND status IN ('planned', 'filled') ORDER BY id DESC"
    ).all(post.id);

    const keep = entries[0] ?? null;
    for (const older of entries.slice(1)) {
      this.db.prepare(
        "UPDATE calendar_entries SET status = 'missed', updated_at = datetime('now') WHERE id = ?"
      ).run(older.id);
    }

    if (keep) {
      if (keep.date === slotIso) {
        if (keep.platform !== post.platform || keep.content_item_id !== item.id) {
          this.db.prepare(
            "UPDATE calendar_entries SET platform = ?, content_item_id = ?, " +
            "updated_at = datetime('now') WHERE id = ?"
          ).run(post.platform, item.id, keep.id);
        }
        return keep.id;
      }

      const at = parseScheduled(keep.date);
      if (at && at.getTime() > now.getTime()) {
        this.db.prepare(
          "UPDATE calendar_entries SET date = ?, platform = ?, content_item_id = ?, " +
          "status = 'planned', updated_at = datetime('now') WHERE id = ?"
        ).run(slotIso, post.platform, item.id, keep.id);
        return keep.id;
      }

      this.db.prepare(
        "UPDATE calendar_entries SET status = 'missed', updated_at = datetime('now') WHERE id = ?"
      ).run(keep.id);
    }

    const result = this.db.prepare(
      "INSERT INTO calendar_entries (date, kind, platform, content_item_id, post_id, status) " +
      "VALUES (?, 'publish', ?, ?, ?, 'planned')"
    ).run(slotIso, post.platform, item.id, post.id);
    return Number(result.lastInsertRowid);
  }

  /** A skipped post must not hold a future slot. Past entries stay as history. */
  _retireSkipped(post, now) {
    const missed = this._retireFutureEntries(post.id, now);
    if (post.scheduled_at) {
      this.db.prepare(
        "UPDATE posts SET scheduled_at = NULL, updated_at = datetime('now') WHERE id = ?"
      ).run(post.id);
    }
    return missed;
  }

  /** Clear a future slot that cannot be kept and retire its calendar rows. */
  _clearFutureSchedule(posts, now) {
    let missed = 0;
    for (const post of posts) {
      const at = parseScheduled(post.scheduled_at);
      if (!at || at.getTime() <= now.getTime()) continue;
      this.db.prepare(
        "UPDATE posts SET scheduled_at = NULL, updated_at = datetime('now') WHERE id = ?"
      ).run(post.id);
      missed += this._retireFutureEntries(post.id, now);
    }
    return missed;
  }

  _retireFutureEntries(postId, now) {
    let missed = 0;
    const entries = this.db.prepare(
      "SELECT * FROM calendar_entries WHERE post_id = ? AND kind = 'publish' " +
      "AND status IN ('planned', 'filled')"
    ).all(postId);

    for (const entry of entries) {
      const at = parseScheduled(entry.date);
      if (at && at.getTime() > now.getTime()) {
        this.db.prepare(
          "UPDATE calendar_entries SET status = 'missed', updated_at = datetime('now') WHERE id = ?"
        ).run(entry.id);
        missed++;
      }
    }
    return missed;
  }

  _findSlot(itemId, posts, config, slots) {
    const platforms = [...new Set(posts.map((post) => post.platform))];
    for (const slot of slots) {
      if (this._slotBlocked(itemId, slot, config.minSpacingMinutes)) continue;
      if (!this._capacityAllows(itemId, platforms, slot, config)) continue;
      return slot;
    }
    return null;
  }

  /**
   * Exact clashes with any calendar row from another item, and the minimum
   * spacing between publish slots of different items. The item's own rows are
   * allowed: its accounts share one slot.
   */
  _slotBlocked(itemId, slot, minSpacingMinutes) {
    const iso = slot.toISOString();

    const exact = this.db.prepare(
      "SELECT 1 FROM calendar_entries WHERE date = ? AND status != 'missed' " +
      'AND (content_item_id IS NULL OR content_item_id != ?) LIMIT 1'
    ).get(iso, itemId);
    if (exact) return true;

    if (!minSpacingMinutes) return false;

    const start = new Date(slot.getTime() - minSpacingMinutes * 60000).toISOString();
    const end = new Date(slot.getTime() + minSpacingMinutes * 60000).toISOString();
    const near = this.db.prepare(
      "SELECT 1 FROM calendar_entries WHERE kind = 'publish' AND status != 'missed' " +
      'AND date > ? AND date < ? ' +
      'AND (content_item_id IS NULL OR content_item_id != ?) LIMIT 1'
    ).get(start, end, itemId);

    return Boolean(near);
  }

  /**
   * Cadence is per content item per platform per local week. Two accounts on
   * the same platform consume one slot. The item being scheduled is excluded
   * because its own rows are about to move.
   */
  _capacityAllows(itemId, platforms, slot, config) {
    for (const platform of platforms) {
      const cap = config.cadence[platform];
      if (cap === undefined || cap === null) continue;

      const week = weekRangeUtc(slot, config.timezone);
      const used = this.db.prepare(
        "SELECT COUNT(DISTINCT content_item_id) AS n FROM calendar_entries " +
        "WHERE kind = 'publish' AND status != 'missed' AND platform = ? " +
        'AND content_item_id IS NOT NULL AND content_item_id != ? ' +
        'AND date >= ? AND date < ?'
      ).get(platform, itemId, week.start, week.end).n;

      if (used >= cap) return false;
    }
    return true;
  }

  /** Run writes atomically. A dry run uses a savepoint that is always rolled back. */
  _atomic(fn, { dryRun = false } = {}) {
    const savepoint = 'distribution_schedule';

    if (dryRun) {
      this.db.exec(`SAVEPOINT ${savepoint}`);
      try {
        return fn();
      } finally {
        try {
          this.db.exec(`ROLLBACK TO ${savepoint}`);
          this.db.exec(`RELEASE ${savepoint}`);
        } catch {
          // The connection already unwound the savepoint.
        }
      }
    }

    if (this.db.isTransaction) return fn();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* already unwound */ }
      throw err;
    }
  }

  _clockDate() {
    const value = this.clock();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error('distribution clock returned an invalid date');
    }
    return date;
  }

  _nowIso() {
    return this._clockDate().toISOString();
  }

  _logSkip(action, itemId, message, dryRun = false) {
    if (dryRun) return;
    this.log(action, {
      status: 'skipped', targetType: 'content_item', targetId: itemId, message,
    });
  }
}

function errorMessage(err) {
  if (!err) return 'unknown error';
  return err.message || String(err);
}

/**
 * Parse a stored slot. Our own writes are full ISO UTC. SQLite's
 * `datetime('now')` form (space, no zone) is treated as UTC too.
 */
function parseScheduled(value) {
  if (!value) return null;
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

const IN_FLIGHT_STAGES = new Set([
  'created', 'processing', 'publishing', 'published',
  'initiating', 'uploading', 'inbox_delivered',
]);

/**
 * True when a publisher may already own a remote object, upload or post.
 * Copy changes must not erase this state.
 */
export function hasPublishInFlight(state) {
  if (!state || typeof state !== 'object') return false;
  if (IN_FLIGHT_STAGES.has(state.stage)) return true;
  return Boolean(state.containerId || state.mediaId || state.publishId);
}

export default DistributionEngine;

// Publishing integrations and their configuration.
export { createPublisherFromSettings } from './publishers/index.mjs';
export { InstagramPublisher, composeCaption } from './publishers/instagram.mjs';
export { TikTokPublisher, composeTikTokTitle, planChunks } from './publishers/tiktok.mjs';
export { LinkedInPublisher } from './publishers/linkedin.mjs';
export { YouTubePublisher } from './publishers/youtube.mjs';
export {
  InstagramAuthError,
  InstagramConfigError,
  InstagramError,
  InstagramMediaError,
  InstagramRateLimitError,
} from './publishers/errors.mjs';
export {
  TikTokAmbiguousInitError,
  TikTokAuditError,
  TikTokAuthError,
  TikTokConfigError,
  TikTokError,
  TikTokMediaError,
  TikTokRateLimitError,
} from './publishers/tiktok-errors.mjs';
export {
  LinkedInAuthError,
  LinkedInConfigError,
  LinkedInError,
  LinkedInMediaError,
  LinkedInRateLimitError,
} from './publishers/linkedin-errors.mjs';
export {
  YouTubeAuthError,
  YouTubeConfigError,
  YouTubeError,
  YouTubeMediaError,
  YouTubeRateLimitError,
} from './publishers/youtube-errors.mjs';
export {
  MediaHostError, NginxMediaHost, S3MediaHost, sigV4Presign,
} from './media-host.mjs';
export {
  DEFAULT_CREDENTIALS_PATH,
  credentialsPath,
  defaultEnvFile,
  instagramAccounts,
  instagramApp,
  linkedInAccounts,
  linkedInApp,
  youTubeAccounts,
  youTubeApp,
  loadCredentials,
  loadStoredCredentials,
  mediaHostConfig,
  readEnvFile,
  saveCredentials,
  saveInstagramToken,
  saveLinkedInToken,
  saveYouTubeToken,
  saveTikTokToken,
  tikTokAccounts,
  tikTokConfig,
  writeEnvValues,
} from './credentials.mjs';
