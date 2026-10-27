// Instagram Reels publishing through Meta's official Graph API.
//
// Flow:
//   1. refresh the long-lived token when it is close to expiry
//   2. verify the account is a Creator/Business account
//   3. upload the video to S3-compatible storage and presign a GET URL
//   4. POST /{ig-user-id}/media            (create a REELS container)
//   5. poll the container until FINISHED
//   6. POST /{ig-user-id}/media_publish    (publish once)
//   7. GET  /{media-id}?fields=permalink   (record the URL)
//
// Every irreversible step is written to the post's publish_state through
// updateState(). A retry or restart resumes the same container and never
// creates a second post.
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  InstagramAuthError,
  InstagramConfigError,
  InstagramError,
  InstagramMediaError,
  InstagramRateLimitError,
} from './errors.mjs';
import { HttpError, defaultSleep, requestJson } from './http.mjs';
import { probeVideo as defaultProbeVideo } from './media-probe.mjs';

const GRAPH = 'https://graph.facebook.com';
const INSTAGRAM_MAX_BYTES = 300 * 1024 * 1024; // Meta Reels limit
const REELS_MIN_SECONDS = 3;
const REELS_MAX_SECONDS = 15 * 60;
const REELS_MIN_FPS = 23;
const REELS_MAX_FPS = 60;
const TOKEN_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export class InstagramPublisher {
  constructor({
    account = 'creator',
    userId,
    accessToken,
    expiresAt = null,
    appId = null,
    appSecret = null,
    apiVersion = 'v26.0',
    expectedAccountType = null,
    mediaHost,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    clock = () => new Date(),
    pollIntervalMs = 60000,
    maxPollMs = 5 * 60 * 1000,
    probeVideo = defaultProbeVideo,
    timeoutMs = 30000,
    maxAttempts = 3,
    shareToFeed = true,
    refreshWindowMs = TOKEN_REFRESH_WINDOW_MS,
    onTokenRefresh = null,
    logger = null,
  } = {}) {
    if (!userId) throw new InstagramConfigError('Instagram userId is missing from the credentials');
    if (!accessToken) throw new InstagramConfigError('Instagram accessToken is missing from the credentials');
    if (!mediaHost) {
      throw new InstagramConfigError(
        'Instagram requires mediaHost credentials (S3-compatible bucket) for the public video URL'
      );
    }

    this.account = account;
    this.userId = userId;
    this.accessToken = accessToken;
    this.expiresAt = expiresAt;
    this.appId = appId;
    this.appSecret = appSecret;
    this.apiVersion = apiVersion;
    this.expectedAccountType = expectedAccountType;
    this.mediaHost = mediaHost;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.clock = clock;
    this.pollIntervalMs = Math.max(1000, pollIntervalMs);
    this.maxPollMs = Math.max(this.pollIntervalMs, maxPollMs);
    this.probeVideo = probeVideo;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = Math.max(1, maxAttempts);
    this.shareToFeed = shareToFeed;
    this.refreshWindowMs = refreshWindowMs;
    this.onTokenRefresh = onTokenRefresh;
    this.logger = logger;

    this._account = null;
    this._state = {};
    this._updateState = () => {};
  }

  /**
   * @param {object} args
   * @param {string} args.account
   * @param {object} args.post
   * @param {object} args.asset
   * @param {object} args.item
   * @param {object|null} args.state - persisted publish_state
   * @param {(patch: object|null) => void} args.updateState
   * @returns {Promise<{ externalId: string, url: string|null }>}
   */
  async publish({ account = this.account, post, asset, item, state = null, updateState = () => {} } = {}) {
    if (account !== this.account) {
      throw new InstagramConfigError(
        `Instagram publisher for '${this.account}' cannot publish account '${account}'`
      );
    }

    this._state = state && typeof state === 'object' ? { ...state } : {};
    this._updateState = (patch) => {
      this._state = patch === null ? {} : { ...this._state, ...patch };
      updateState(patch === null ? null : this._state);
    };

    const current = this._state;

    // A previous process already published and recorded the media id.
    if (current.stage === 'published' && current.mediaId) {
      await this._releaseMedia();
      if (current.permalink) {
        return { externalId: current.mediaId, url: current.permalink };
      }
      await this._ensureToken();
      await this._verifyAccount();
      const url = await this._safePermalink(current.mediaId);
      if (url) this._updateState({ permalink: url });
      return { externalId: current.mediaId, url };
    }

    await this._ensureToken();
    await this._verifyAccount();

    // The process died after asking Instagram to publish. Find the post
    // before doing anything else.
    if (current.stage === 'publishing') {
      const recovered = await this._recoverPublished(post, current);
      if (recovered) return this._finishRecovered(recovered);
      throw new InstagramError(
        'Instagram publish state is ambiguous: a publish was attempted but the media ' +
        'could not be found. Check the account before retrying.',
        { retryable: false, code: 'AMBIGUOUS_PUBLISH' }
      );
    }

    let containerId = current.containerId ?? null;

    if (containerId) {
      const status = await this._containerStatus(containerId);

      if (status.status_code === 'PUBLISHED') {
        const recovered = await this._recoverPublished(post, current);
        if (recovered) return this._finishRecovered(recovered);
        throw new InstagramError(
          'Instagram says the container is published, but the media id could not be recovered.',
          { retryable: false, code: 'PUBLISHED_UNRECOVERED' }
        );
      }

      if (status.status_code === 'FINISHED') {
        return this._publishContainer(containerId, post);
      }

      if (status.status_code === 'IN_PROGRESS') {
        const terminal = await this._waitForContainer(containerId);
        return this._handleTerminal(terminal, containerId, post);
      }

      // ERROR or EXPIRED before a publish attempt: safe to start over.
      this._updateState(null);
      containerId = null;
    }

    await this._checkQuota();
    const videoUrl = await this._prepareMedia(asset, item);
    containerId = await this._createContainer(videoUrl, post);

    this._updateState({
      stage: 'created',
      containerId,
      containerCreatedAt: this.clock().toISOString(),
    });

    const terminal = await this._waitForContainer(containerId);
    return this._handleTerminal(terminal, containerId, post);
  }

  // -------------------------------------------------------------------------
  // Media and container
  // -------------------------------------------------------------------------

  async _prepareMedia(asset, item) {
    const filePath = asset?.file_path;
    if (!filePath) throw new InstagramConfigError('the post has no asset file_path');

    const absolute = path.resolve(filePath);
    if (!existsSync(absolute)) {
      throw new InstagramConfigError(`video not found: ${absolute}`);
    }

    const stat = statSync(absolute);
    if (!stat.isFile()) throw new InstagramConfigError(`video is not a file: ${absolute}`);
    if (stat.size > INSTAGRAM_MAX_BYTES) {
      throw new InstagramMediaError('Instagram Reels accepts videos up to 300 MB');
    }

    const extension = path.extname(absolute).toLowerCase();
    if (!['.mp4', '.mov'].includes(extension)) {
      throw new InstagramMediaError('Instagram Reels requires an MP4 or MOV file');
    }

    const metadata = this.probeVideo(absolute);
    if (!metadata || !Number.isFinite(metadata.fps)) {
      throw new InstagramMediaError(
        'Could not verify the Reels frame rate; ffprobe is required for Instagram publishing'
      );
    }

    const assetDuration = Number(asset.duration_seconds);
    const duration = Number.isFinite(assetDuration) && assetDuration > 0
      ? assetDuration
      : Number(metadata.duration ?? 0);
    if (duration > 0 && (duration < REELS_MIN_SECONDS || duration > REELS_MAX_SECONDS)) {
      throw new InstagramMediaError(
        `Instagram Reels requires 3 seconds to 15 minutes; this video is ${duration}s`
      );
    }
    if (metadata.fps < REELS_MIN_FPS || metadata.fps > REELS_MAX_FPS) {
      throw new InstagramMediaError(
        `Instagram Reels requires 23-60 fps; this video is ${metadata.fps.toFixed(2)} fps`
      );
    }
    if (metadata.width && metadata.width > 1920) {
      throw new InstagramMediaError('Instagram Reels allows at most 1920 horizontal pixels');
    }

    // A landscape master is not a Reel. Refuse before spending an upload.
    if (asset.orientation === 'landscape') {
      throw new InstagramMediaError(
        'Instagram Reels requires a portrait master. Render this item in portrait ' +
        'or attach an Instagram-specific asset.'
      );
    }
    if (asset.width && asset.height && asset.width > asset.height) {
      throw new InstagramMediaError('Instagram Reels requires a portrait video');
    }

    const upload = await this.mediaHost.upload({
      itemId: item?.id ?? null,
      filePath: absolute,
      contentType: extension === '.mov' ? 'video/quicktime' : 'video/mp4',
    });

    this._updateState({ mediaKey: upload.key });
    return upload.url;
  }

  async _createContainer(videoUrl, post) {
    const body = await this._graph('POST', `/${this.userId}/media`, {
      body: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption: composeCaption(post),
        share_to_feed: this.shareToFeed,
      },
    });

    if (!body?.id) {
      throw new InstagramError('Instagram did not return a media container id', {
        retryable: true, code: 'NO_CONTAINER_ID',
      });
    }
    return body.id;
  }

  async _containerStatus(containerId) {
    return this._graph('GET', `/${containerId}`, {
      query: { fields: 'status_code,status' },
    });
  }

  async _waitForContainer(containerId) {
    const started = this.clock().getTime();
    const deadline = started + this.maxPollMs;
    const maxPolls = Math.ceil(this.maxPollMs / this.pollIntervalMs) + 1;

    for (let poll = 0; poll < maxPolls; poll++) {
      const status = await this._containerStatus(containerId);
      if (status.status_code !== 'IN_PROGRESS') return status;

      this._updateState({ stage: 'processing', containerId });

      if (this.clock().getTime() >= deadline) break;
      await this.sleep(this.pollIntervalMs);
    }

    throw new InstagramError(
      'Instagram is still processing the video. The container will be resumed on the next attempt.',
      { retryable: true, code: 'PROCESSING_TIMEOUT' }
    );
  }

  async _handleTerminal(status, containerId, post) {
    if (status.status_code === 'FINISHED') {
      return this._publishContainer(containerId, post);
    }

    if (status.status_code === 'PUBLISHED') {
      const recovered = await this._recoverPublished(post, this._state);
      if (recovered) return this._finishRecovered(recovered);
      throw new InstagramError(
        'Instagram says the container is published, but the media id could not be recovered.',
        { retryable: false, code: 'PUBLISHED_UNRECOVERED' }
      );
    }

    const detail = status.status ? `: ${status.status}` : '';
    this._updateState(null);
    throw new InstagramMediaError(
      `Instagram could not process the video (${status.status_code})${detail}`,
      { retryable: true, code: 'CONTAINER_ERROR' }
    );
  }

  async _publishContainer(containerId, post) {
    this._updateState({
      stage: 'publishing',
      publishAttemptedAt: this.clock().toISOString(),
      captionHash: hashCaption(post),
    });

    let mediaId = null;
    let warnings = [];

    try {
      const body = await this._graph('POST', `/${this.userId}/media_publish`, {
        body: { creation_id: containerId },
      });
      mediaId = body?.id ?? null;
      warnings = publishWarnings(body);
    } catch (err) {
      const recovered = await this._recoverAfterPublishFailure(containerId, post, err);
      if (recovered) return this._finishRecovered(recovered);
      throw err;
    }

    if (!mediaId) {
      const recovered = await this._recoverPublished(post, this._state);
      if (recovered) return this._finishRecovered(recovered);
      throw new InstagramError('Instagram did not return a media id after publishing', {
        retryable: true, code: 'NO_MEDIA_ID',
      });
    }

    this._updateState({
      stage: 'published',
      mediaId,
      publishedAt: this.clock().toISOString(),
    });

    const url = await this._safePermalink(mediaId);
    if (url) this._updateState({ permalink: url });
    await this._releaseMedia();
    return { externalId: mediaId, url, warnings };
  }

  /**
   * A failed media_publish may still have reached Instagram. If the container
   * is FINISHED the publish did not happen and one retry is safe. Otherwise
   * look for the media on the account.
   */
  async _recoverAfterPublishFailure(containerId, post, err) {
    if (err instanceof InstagramAuthError || err instanceof InstagramConfigError) return null;

    let finalError = err;
    const status = await this._safeContainerStatus(containerId);

    if (status?.status_code === 'FINISHED') {
      try {
        const body = await this._graph('POST', `/${this.userId}/media_publish`, {
          body: { creation_id: containerId },
        });
        if (body?.id) {
          this._updateState({
            stage: 'published',
            mediaId: body.id,
            publishedAt: this.clock().toISOString(),
          });
          return {
            id: body.id,
            url: await this._safePermalink(body.id),
            warnings: publishWarnings(body),
          };
        }
      } catch (retryError) {
        finalError = retryError;
      }
    }

    const recovered = await this._recoverPublished(post, this._state);
    if (recovered) return recovered;

    if (
      finalError?.code === 9007 ||
      /already.{0,40}publish/i.test(finalError?.message ?? '')
    ) {
      throw new InstagramError(
        'Instagram reports this media was already published, but it could not be located. ' +
        'Check the account before retrying.',
        { retryable: false, code: 'PUBLISHED_UNRECOVERED' }
      );
    }
    throw finalError;
  }

  async _recoverPublished(post, state = {}) {
    const expectedHash = state.captionHash || hashCaption(post);
    const since = state.publishAttemptedAt || state.containerCreatedAt || null;
    const sinceMs = since ? Date.parse(since) : null;

    const body = await this._graph('GET', `/${this.userId}/media`, {
      query: { fields: 'id,permalink,caption,timestamp', limit: 50 },
    });
    const items = Array.isArray(body?.data) ? body.data : [];
    return selectRecoveryMatch(items, { expectedHash, sinceMs });
  }

  async _finishRecovered(recovered) {
    this._updateState({
      stage: 'published',
      mediaId: recovered.id,
      ...(recovered.url ? { permalink: recovered.url } : {}),
    });
    await this._releaseMedia();
    return {
      externalId: recovered.id,
      url: recovered.url ?? null,
      warnings: Array.isArray(recovered.warnings) ? recovered.warnings : [],
    };
  }

  /** The platform has the video; the temporary hosting link can go. */
  async _releaseMedia() {
    const key = this._state.mediaKey;
    if (!key || typeof this.mediaHost.release !== 'function') return;
    try {
      await this.mediaHost.release(key);
    } catch (err) {
      this._warn(`Instagram published but media cleanup failed: ${err.message}`);
    }
  }

  async _safeContainerStatus(containerId) {
    try {
      return await this._containerStatus(containerId);
    } catch {
      return null;
    }
  }

  async _safePermalink(mediaId) {
    try {
      const body = await this._graph('GET', `/${mediaId}`, {
        query: { fields: 'permalink' },
      });
      return body?.permalink ?? null;
    } catch (err) {
      this._warn(`Instagram published the media but its permalink was not available: ${err.message}`);
      return null;
    }
  }

  /**
   * Meta's content publishing limit is 50 posts per rolling 24 hours. Check it
   * before uploading a large file.
   */
  async _checkQuota() {
    const body = await this._graph('GET', `/${this.userId}/content_publishing_limit`, {
      query: { fields: 'quota_usage,config' },
    });
    const entry = Array.isArray(body?.data) ? body.data[0] : null;
    if (!entry) return;

    const usage = Number(entry.quota_usage ?? 0);
    const total = Number(entry.config?.quota_total ?? entry.quota_total ?? 0);
    if (total > 0 && usage >= total) {
      throw new InstagramRateLimitError(
        `Instagram publishing quota reached (${usage}/${total}). Try again after the quota window.`,
        { code: 'QUOTA_EXCEEDED' }
      );
    }
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  async _ensureToken() {
    if (!this.accessToken) {
      throw new InstagramConfigError('Instagram accessToken is missing from the credentials');
    }

    const expires = this.expiresAt ? Date.parse(this.expiresAt) : null;
    if (expires === null || Number.isNaN(expires)) return;

    const now = this.clock().getTime();
    if (expires <= now) {
      await this._refreshToken('expired');
    } else if (expires - now < this.refreshWindowMs) {
      await this._refreshToken('expiring soon');
    }
  }

  async _refreshToken(reason) {
    if (!this.appId || !this.appSecret) {
      throw new InstagramAuthError(
        `Instagram access token is ${reason} and appId/appSecret are not configured.`
      );
    }

    const url = new URL(`${GRAPH}/${this.apiVersion}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', this.appId);
    url.searchParams.set('client_secret', this.appSecret);
    url.searchParams.set('fb_exchange_token', this.accessToken);

    let body;
    try {
      body = await requestJson(url.toString(), {
        fetchImpl: this.fetchImpl,
        attempts: this.maxAttempts,
        timeoutMs: this.timeoutMs,
        sleep: this.sleep,
        isRetryable: (status) => status === 429 || status >= 500,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        const message = err.body?.error?.message || 'Instagram token refresh failed';
        throw new InstagramAuthError(message, { status: err.status, cause: err });
      }
      throw new InstagramAuthError('Instagram token refresh request failed', { cause: err });
    }

    if (!body?.access_token) {
      throw new InstagramAuthError('Instagram token refresh returned no access token');
    }

    this.accessToken = body.access_token;
    const expiresIn = Number(body.expires_in);
    if (Number.isFinite(expiresIn) && expiresIn > 0) {
      this.expiresAt = new Date(this.clock().getTime() + expiresIn * 1000).toISOString();
    }
    this._account = null;

    if (this.onTokenRefresh) {
      try {
        await this.onTokenRefresh({
          account: this.account,
          userId: this.userId,
          accessToken: this.accessToken,
          expiresAt: this.expiresAt,
        });
      } catch (err) {
        this._warn(`Instagram token refreshed but was not persisted: ${err.message}`);
      }
    }
  }

  async _verifyAccount() {
    if (this._account) return this._account;

    const body = await this._graph('GET', `/${this.userId}`, {
      query: { fields: 'id,username' },
    });

    this._account = {
      id: body?.id ?? this.userId,
      username: body?.username ?? null,
      accountType: null,
    };
    return this._account;
  }

  // -------------------------------------------------------------------------
  // Graph calls
  // -------------------------------------------------------------------------

  async _graph(method, endpoint, { query = null, body = null, attempts = this.maxAttempts } = {}) {
    const url = new URL(`${GRAPH}/${this.apiVersion}${endpoint}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    try {
      return await requestJson(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
        fetchImpl: this.fetchImpl,
        attempts,
        timeoutMs: this.timeoutMs,
        sleep: this.sleep,
        isRetryable: (status, payload) => {
          const code = Number(payload?.error?.code);
          return status === 429 || status >= 500 || [1, 2, 4, 17, 32, 613].includes(code);
        },
      });
    } catch (err) {
      throw this._mapError(err);
    }
  }

  _mapError(err) {
    if (!(err instanceof HttpError)) {
      return new InstagramError(err?.message || 'Instagram request failed', {
        retryable: true, cause: err,
      });
    }

    const payload = err.body?.error ?? err.body ?? {};
    const code = payload.code ?? null;
    const meta = {
      code,
      subcode: payload.error_subcode ?? null,
      status: err.status,
      fbtraceId: payload.fbtrace_id ?? null,
    };
    const message = payload.message || `Instagram API returned HTTP ${err.status}`;

    if ([102, 190, 463].includes(Number(code))) {
      return new InstagramAuthError(message, meta);
    }
    if (err.status === 429 || [4, 17, 32, 613].includes(Number(code))) {
      const retry = err.retryAfterMs
        ? ` Retry after ${Math.ceil(err.retryAfterMs / 1000)}s.`
        : '';
      return new InstagramRateLimitError(`${message}${retry}`, {
        ...meta, retryAfterMs: err.retryAfterMs ?? null,
      });
    }
    return new InstagramError(message, { ...meta, retryable: err.retryable });
  }

  _warn(message) {
    try { this.logger?.warn?.(message); } catch { /* logging must not fail a publish */ }
  }
}

export function composeCaption(post = {}) {
  const caption = typeof post.caption === 'string' ? post.caption.trim() : '';
  const tags = Array.isArray(post.hashtags)
    ? post.hashtags.map((tag) => String(tag).trim()).filter(Boolean).join(' ')
    : '';
  return [caption, tags].filter(Boolean).join('\n\n');
}

export function normalizeCaption(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function hashCaption(post) {
  return hashCaptionText(composeCaption(post));
}

/**
 * Meta can publish successfully while dropping a caption or add-on. Those are
 * partial successes: keep the post published, but record the warnings.
 */
export function publishWarnings(body = {}) {
  const warnings = [];
  if (body?.config_issue) warnings.push(`config_issue=${body.config_issue}`);
  if (body?.caption_add_on_attachment_status) {
    warnings.push(`caption_add_on=${body.caption_add_on_attachment_status}`);
  }
  return warnings;
}

export function hashCaptionText(caption) {
  return createHash('sha256').update(normalizeCaption(caption)).digest('hex');
}

/**
 * Recovery is conservative: exactly one media item may match the caption hash
 * and the attempt window. Zero matches means "not published"; more than one is
 * ambiguous and never guessed.
 */
export function selectRecoveryMatch(items, { expectedHash = null, sinceMs = null } = {}) {
  if (!Array.isArray(items)) return null;

  const matches = [];
  for (const item of items) {
    if (!item?.id) continue;

    if (sinceMs !== null && item.timestamp) {
      const at = Date.parse(item.timestamp);
      if (!Number.isNaN(at) && at < sinceMs - 5 * 60 * 1000) continue;
    }
    if (expectedHash && hashCaptionText(item.caption) !== expectedHash) continue;

    matches.push(item);
  }

  if (!matches.length) return null;
  if (matches.length > 1) {
    throw new InstagramError(
      'Multiple Instagram media match the recovery fingerprint ' +
      `(${matches.map((item) => item.id).join(', ')}); refusing to guess.`,
      { retryable: false, code: 'AMBIGUOUS_RECOVERY' }
    );
  }

  return { id: matches[0].id, url: matches[0].permalink ?? null };
}
