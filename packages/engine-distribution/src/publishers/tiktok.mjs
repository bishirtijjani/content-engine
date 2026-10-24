// TikTok Content Posting API — Direct Post.
//
// Official flow:
//   1. POST /v2/post/publish/creator_info/query/   (privacy options, max duration)
//   2. POST /v2/post/publish/video/init/           (publish_id + upload_url)
//   3. PUT  {upload_url}                            (sequential chunks)
//   4. POST /v2/post/publish/status/fetch/          (poll to PUBLISH_COMPLETE)
//
// FILE_UPLOAD is used, so the nginx media host is not needed for TikTok and
// TikTok's PULL_FROM_URL domain-verification requirement does not apply.
//
// External restriction: public Direct Post requires the TikTok app to be
// audited for the video.publish scope. Unaudited clients can only post to
// private accounts; the API returns unaudited_client_can_only_post_to_private_accounts.
import {
  closeSync, existsSync, openSync, readSync, statSync,
} from 'node:fs';
import path from 'node:path';
import { backoffMs, defaultSleep, HttpError, requestJson } from './http.mjs';
import {
  TikTokAmbiguousInitError,
  TikTokAuditError,
  TikTokAuthError,
  TikTokConfigError,
  TikTokError,
  TikTokMediaError,
  TikTokRateLimitError,
} from './tiktok-errors.mjs';

const DEFAULT_API_BASE = 'https://open.tiktokapis.com';
const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_DIRECT_SECONDS = 10 * 60;
const CHUNK_MAX = 64 * 1024 * 1024;
const TOKEN_REFRESH_WINDOW_MS = 60 * 60 * 1000;

export class TikTokPublisher {
  constructor({
    account = 'main',
    slot = null,
    clientKey,
    clientSecret,
    openId,
    accessToken,
    refreshToken,
    expiresAt = null,
    refreshExpiresAt = null,
    apiBase = DEFAULT_API_BASE,
    mode = 'direct',
    privacyLevel = null,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    clock = () => new Date(),
    pollIntervalMs = 5000,
    maxPollMs = 10 * 60 * 1000,
    timeoutMs = 30000,
    maxAttempts = 3,
    onTokenRefresh = null,
    logger = null,
  } = {}) {
    if (!account) throw new TikTokConfigError('TikTok account name is required');
    if (mode !== 'direct') {
      throw new TikTokConfigError(
        'TikTok inbox upload requires manual completion in the TikTok app and is not ' +
        'an unattended publish. Use direct mode after the app audit.'
      );
    }
    if (!clientKey || !clientSecret) {
      throw new TikTokConfigError('TikTok clientKey and clientSecret are required');
    }
    if (!openId || !accessToken || !refreshToken) {
      throw new TikTokConfigError(
        `TikTok account '${account}' is missing openId, accessToken or refreshToken`
      );
    }

    this.account = account;
    this.slot = slot;
    this.clientKey = clientKey;
    this.clientSecret = clientSecret;
    this.openId = openId;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.expiresAt = expiresAt;
    this.refreshExpiresAt = refreshExpiresAt;
    this.apiBase = String(apiBase).replace(/\/+$/, '');
    this.privacyLevel = privacyLevel;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.clock = clock;
    this.pollIntervalMs = Math.max(1000, pollIntervalMs);
    this.maxPollMs = Math.max(this.pollIntervalMs, maxPollMs);
    this.timeoutMs = timeoutMs;
    this.maxAttempts = Math.max(1, maxAttempts);
    this.onTokenRefresh = onTokenRefresh;
    this.logger = logger;

    this._creator = null;
    this._state = {};
    this._updateState = () => {};
  }

  async publish({ account = this.account, post, asset, item, state = null, updateState = () => {} } = {}) {
    if (account !== this.account) {
      throw new TikTokConfigError(
        `TikTok publisher for '${this.account}' cannot publish account '${account}'`
      );
    }

    this._state = state && typeof state === 'object' ? { ...state } : {};
    this._updateState = (patch) => {
      this._state = patch === null ? {} : { ...this._state, ...patch };
      updateState(patch === null ? null : this._state);
    };

    const current = this._state;
    if (current.stage === 'published' && current.publishId) {
      return this._publishedResult(current);
    }

    // The init response was lost. Do not create a second upload blindly.
    if (current.stage === 'initiating' && !current.publishId) {
      throw new TikTokAmbiguousInitError(
        'A TikTok upload initialization was started but no publish_id was saved.'
      );
    }

    await this._ensureToken();
    const media = this._mediaInfo(asset);
    await this._verifyCreator(media);

    if (current.publishId) {
      return this._resume(post, media);
    }

    return this._start(post, media);
  }

  async _start(post, media) {
    this._updateState({
      stage: 'initiating',
      initRequestedAt: this.clock().toISOString(),
      mode: 'direct',
    });

    let init;
    try {
      init = await this._api('POST', '/v2/post/publish/video/init/', {
        body: {
          post_info: {
            title: composeTikTokTitle(post),
            privacy_level: this._privacyLevel(),
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            brand_content_toggle: false,
            brand_organic_toggle: false,
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: media.size,
            chunk_size: media.chunkSize,
            total_chunk_count: media.totalChunks,
          },
        },
      });
    } catch (err) {
      // A clear 4xx/business rejection means no upload exists. A network or
      // 5xx failure may have reached TikTok, so the ambiguous state is kept.
      if (isDefinitiveInitFailure(err)) {
        this._updateState(null);
        throw err;
      }
      throw new TikTokAmbiguousInitError(
        `TikTok upload initialization failed without a definite rejection: ${err.message}`
      );
    }

    const data = init?.data ?? {};
    if (!data.publish_id || !data.upload_url) {
      throw new TikTokAmbiguousInitError(
        'TikTok accepted the initialization but returned no publish_id or upload_url.'
      );
    }

    this._updateState({
      stage: 'uploading',
      publishId: data.publish_id,
      uploadUrl: data.upload_url,
      videoSize: media.size,
      chunkSize: media.chunkSize,
      totalChunks: media.totalChunks,
      uploadedBytes: 0,
      mode: 'direct',
    });

    await this._upload(media);
    return this._pollAndFinish(post);
  }

  async _resume(post, media) {
    const state = this._state;
    if (state.videoSize && Number(state.videoSize) !== media.size) {
      throw new TikTokError(
        'The video changed after the TikTok upload was initialized. Reset the publish state before retrying.',
        { retryable: false, code: 'VIDEO_CHANGED' }
      );
    }

    if (state.stage === 'uploading' || Number(state.uploadedBytes ?? 0) < media.size) {
      await this._upload(media);
    }
    return this._pollAndFinish(post);
  }

  // -------------------------------------------------------------------------
  // Creator, media, upload
  // -------------------------------------------------------------------------

  async _verifyCreator(media) {
    const body = await this._api('POST', '/v2/post/publish/creator_info/query/');
    const data = body?.data ?? {};
    this._creator = data;

    const maxDuration = Number(data.max_video_post_duration_sec ?? 0);
    if (maxDuration > 0 && media.duration > maxDuration) {
      throw new TikTokMediaError(
        `Video is ${media.duration}s; this TikTok account allows ${maxDuration}s`
      );
    }
    if (!Array.isArray(data.privacy_level_options) || !data.privacy_level_options.length) {
      throw new TikTokConfigError('TikTok returned no privacy_level_options for this account');
    }
  }

  _privacyLevel() {
    const options = this._creator?.privacy_level_options ?? [];
    if (this.privacyLevel) {
      if (!options.includes(this.privacyLevel)) {
        throw new TikTokConfigError(
          `TikTok privacy level '${this.privacyLevel}' is not available; options: ${options.join(', ')}`
        );
      }
      return this.privacyLevel;
    }
    if (options.includes('PUBLIC_TO_EVERYONE')) return 'PUBLIC_TO_EVERYONE';

    throw new TikTokConfigError(
      'TikTok cannot publish publicly for this account. Set the account privacy level ' +
      `in the .env. Allowed options: ${options.join(', ')}`
    );
  }

  _mediaInfo(asset) {
    const filePath = asset?.file_path;
    if (!filePath) throw new TikTokConfigError('the post has no asset file_path');

    const absolute = path.resolve(filePath);
    if (!existsSync(absolute)) throw new TikTokConfigError(`video not found: ${absolute}`);

    const stat = statSync(absolute);
    if (!stat.isFile()) throw new TikTokConfigError(`video is not a file: ${absolute}`);
    if (stat.size <= 0) throw new TikTokMediaError('video is empty');
    if (stat.size > MAX_BYTES) throw new TikTokMediaError('TikTok accepts videos up to 4 GB');

    const extension = path.extname(absolute).toLowerCase();
    const contentType = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
    }[extension];
    if (!contentType) throw new TikTokMediaError('TikTok requires MP4, MOV or WebM');

    const duration = Number(asset.duration_seconds ?? 0);
    if (duration > MAX_DIRECT_SECONDS) {
      throw new TikTokMediaError('TikTok Direct Post accepts videos up to 10 minutes');
    }
    if (asset.width && (asset.width < 360 || asset.width > 4096)) {
      throw new TikTokMediaError('TikTok requires width between 360 and 4096 pixels');
    }
    if (asset.height && (asset.height < 360 || asset.height > 4096)) {
      throw new TikTokMediaError('TikTok requires height between 360 and 4096 pixels');
    }

    const plan = planChunks(stat.size);
    return {
      filePath: absolute,
      size: stat.size,
      contentType,
      duration,
      chunkSize: plan.chunkSize,
      totalChunks: plan.totalChunks,
    };
  }

  async _upload(media) {
    const state = this._state;
    if (!state.uploadUrl) {
      throw new TikTokError(
        'TikTok upload URL is missing; cannot resume this publish.',
        { retryable: false, code: 'UPLOAD_URL_MISSING' }
      );
    }
    if (state.videoSize && Number(state.videoSize) !== media.size) {
      throw new TikTokError(
        'The video changed after the TikTok upload was initialized. Reset the publish state before retrying.',
        { retryable: false, code: 'VIDEO_CHANGED' }
      );
    }

    const chunkSize = Number(state.chunkSize) || media.chunkSize;
    let uploaded = Number(state.uploadedBytes ?? 0);

    while (uploaded < media.size) {
      const end = Math.min(uploaded + chunkSize - 1, media.size - 1);
      const buffer = readChunk(media.filePath, uploaded, end);

      try {
        await this._putChunk(
          state.uploadUrl, buffer, uploaded, end, media.size, media.contentType
        );
      } catch (err) {
        if (err.code === 'CHUNK_RANGE') {
          uploaded = Number(this._state.uploadedBytes ?? 0);
          continue;
        }
        throw err;
      }

      uploaded = end + 1;
      this._updateState({ uploadedBytes: uploaded, stage: 'uploading' });
    }

    this._updateState({ stage: 'processing', uploadedBytes: media.size });
  }

  async _putChunk(uploadUrl, buffer, start, end, total, contentType) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await this.fetchImpl(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(buffer.length),
            'Content-Range': `bytes ${start}-${end}/${total}`,
          },
          body: buffer,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.status === 201 || response.status === 206) return;

        if (response.status === 403) {
          this._updateState(null);
          throw new TikTokError(
            'TikTok upload URL expired; the next attempt will initialize a new upload.',
            { retryable: true, code: 'UPLOAD_URL_EXPIRED' }
          );
        }

        if (response.status === 416) {
          const uploadedBytes = parseUploadedRange(response.headers?.get?.('content-range'));
          if (uploadedBytes !== null) {
            this._updateState({ uploadedBytes });
          }
          throw new TikTokError('TikTok reported a different upload offset', {
            retryable: true, code: 'CHUNK_RANGE', status: 416,
          });
        }

        await response.text().catch(() => '');
        const retryable = response.status === 429 || response.status >= 500;
        const err = new TikTokError(`TikTok chunk upload failed with HTTP ${response.status}`, {
          retryable, status: response.status, code: 'UPLOAD_HTTP',
        });
        lastError = err;
        if (!retryable || attempt === this.maxAttempts) throw err;
        await this.sleep(backoffMs(attempt));
      } catch (err) {
        if (err.code === 'CHUNK_RANGE' || err.code === 'UPLOAD_URL_EXPIRED') throw err;
        lastError = err;
        if (err.retryable === false || attempt === this.maxAttempts) {
          if (err instanceof TikTokError) throw err;
          throw new TikTokError(`TikTok chunk upload failed: ${err.message}`, {
            retryable: true, cause: err,
          });
        }
        await this.sleep(backoffMs(attempt));
      }
    }

    throw lastError ?? new TikTokError('TikTok chunk upload failed', { retryable: true });
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  async _pollAndFinish(post) {
    this._updateState({ stage: 'processing' });

    const deadline = this.clock().getTime() + this.maxPollMs;
    const maxPolls = Math.ceil(this.maxPollMs / this.pollIntervalMs) + 1;

    for (let poll = 0; poll < maxPolls; poll++) {
      const publishId = this._state.publishId;
      const body = await this._api('POST', '/v2/post/publish/status/fetch/', {
        body: { publish_id: publishId },
      });
      const data = body?.data ?? {};
      const status = data.status;

      if (status === 'PUBLISH_COMPLETE') {
        const postId = Array.isArray(data.publicaly_available_post_id)
          ? data.publicaly_available_post_id[0] ?? null
          : null;
        const username = this._creator?.creator_username ?? null;
        const url = postId && username
          ? `https://www.tiktok.com/@${username}/video/${postId}`
          : null;

        this._updateState({
          stage: 'published',
          publishId,
          postId,
          url,
          publishedAt: this.clock().toISOString(),
        });
        return { externalId: String(postId ?? publishId), url };
      }

      if (status === 'FAILED') {
        const reason = data.fail_reason || 'unknown';
        const retryable = reason === 'internal' || reason === 'video_pull_failed';
        this._updateState(null);
        throw new TikTokError(`TikTok publishing failed: ${reason}`, {
          retryable, code: 'PUBLISH_FAILED', status: 200,
        });
      }

      if (status === 'SEND_TO_USER_INBOX') {
        throw new TikTokError(
          `TikTok delivered publish ${publishId} to the inbox instead of posting it directly. ` +
          'Direct Post requires an audited app and the video.publish scope.',
          { retryable: false, code: 'INBOX_DELIVERY' }
        );
      }

      if (status !== 'PROCESSING_UPLOAD' && status !== 'PROCESSING_DOWNLOAD') {
        throw new TikTokError(`Unexpected TikTok status '${status ?? 'missing'}'`, {
          retryable: true, code: 'UNKNOWN_STATUS',
        });
      }

      if (this.clock().getTime() >= deadline) break;
      await this.sleep(this.pollIntervalMs);
    }

    throw new TikTokError(
      'TikTok is still processing the video. The publish will resume on the next attempt.',
      { retryable: true, code: 'PROCESSING_TIMEOUT' }
    );
  }

  _publishedResult(state) {
    return {
      externalId: String(state.postId ?? state.publishId),
      url: state.url ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // OAuth
  // -------------------------------------------------------------------------

  async _ensureToken() {
    const now = this.clock().getTime();
    const refreshExpires = this.refreshExpiresAt ? Date.parse(this.refreshExpiresAt) : null;
    if (refreshExpires !== null && !Number.isNaN(refreshExpires) && refreshExpires <= now) {
      throw new TikTokAuthError('TikTok refresh token has expired.');
    }

    const expires = this.expiresAt ? Date.parse(this.expiresAt) : null;
    if (expires !== null && !Number.isNaN(expires) && expires - now < TOKEN_REFRESH_WINDOW_MS) {
      await this._refreshToken();
    }
  }

  async _refreshToken() {
    if (!this.refreshToken) {
      throw new TikTokAuthError('TikTok refresh token is missing.');
    }

    let body;
    try {
      body = await requestJson(`${this.apiBase}/v2/oauth/token/`, {
        method: 'POST',
        bodyType: 'form',
        body: {
          client_key: this.clientKey,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
        },
        fetchImpl: this.fetchImpl,
        attempts: this.maxAttempts,
        timeoutMs: this.timeoutMs,
        sleep: this.sleep,
        isRetryable: (status) => status === 429 || status >= 500,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        const message = err.body?.error_description || err.body?.error || 'TikTok token refresh failed';
        throw new TikTokAuthError(message, { status: err.status, cause: err });
      }
      throw new TikTokAuthError('TikTok token refresh request failed', { cause: err });
    }

    if (!body?.access_token || !body?.refresh_token) {
      throw new TikTokAuthError('TikTok token refresh returned incomplete tokens');
    }

    this.accessToken = body.access_token;
    this.refreshToken = body.refresh_token;
    this.openId = body.open_id ?? this.openId;

    const expiresIn = Number(body.expires_in);
    const refreshExpiresIn = Number(body.refresh_expires_in);
    if (Number.isFinite(expiresIn) && expiresIn > 0) {
      this.expiresAt = new Date(this.clock().getTime() + expiresIn * 1000).toISOString();
    }
    if (Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0) {
      this.refreshExpiresAt = new Date(
        this.clock().getTime() + refreshExpiresIn * 1000
      ).toISOString();
    }

    if (this.onTokenRefresh) {
      try {
        await this.onTokenRefresh({
          account: this.account,
          slot: this.slot,
          openId: this.openId,
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          expiresAt: this.expiresAt,
          refreshExpiresAt: this.refreshExpiresAt,
          scope: body.scope ?? null,
        });
      } catch (err) {
        this._warn(`TikTok token refreshed but was not persisted: ${err.message}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // API and errors
  // -------------------------------------------------------------------------

  async _api(method, endpoint, {
    body = null, bodyType = 'json', attempts = this.maxAttempts,
  } = {}) {
    const url = `${this.apiBase}${endpoint}`;

    try {
      const parsed = await requestJson(url, {
        method,
        headers: { Authorization: `Bearer ${this.accessToken}` },
        body,
        bodyType,
        fetchImpl: this.fetchImpl,
        attempts,
        timeoutMs: this.timeoutMs,
        sleep: this.sleep,
        isRetryable: (status, payload) => {
          const code = payload?.error?.code;
          return status === 429 || status >= 500
            || code === 'rate_limit_exceeded' || code === 'internal_error';
        },
      });

      const code = parsed?.error?.code;
      if (code && code !== 'ok') {
        throw this._mapCode(
          code, parsed.error.message, parsed.error.log_id, 200, null, false
        );
      }
      return parsed;
    } catch (err) {
      if (err instanceof TikTokError) throw err;
      throw this._mapError(err);
    }
  }

  _mapError(err) {
    if (err instanceof TikTokError) return err;
    if (!(err instanceof HttpError)) {
      return new TikTokError(err?.message || 'TikTok request failed', {
        retryable: true, cause: err,
      });
    }

    const payload = err.body?.error;
    const objectPayload = payload && typeof payload === 'object' ? payload : null;
    const code = objectPayload?.code ?? (typeof payload === 'string' ? payload : null);
    const message = objectPayload?.message
      || err.body?.error_description
      || `TikTok API returned HTTP ${err.status}`;

    return this._mapCode(
      code,
      message,
      objectPayload?.log_id ?? err.body?.log_id ?? null,
      err.status,
      err.retryAfterMs,
      err.retryable
    );
  }

  _mapCode(code, message, logId, status, retryAfterMs, httpRetryable) {
    const meta = { code, status, logId, retryAfterMs };

    if (['access_token_invalid', 'scope_not_authorized', 'scope_permission_missed'].includes(code)) {
      return new TikTokAuthError(message || code, meta);
    }
    if (code === 'unaudited_client_can_only_post_to_private_accounts') {
      return new TikTokAuditError(message || code, meta);
    }
    if (
      status === 429 || code === 'rate_limit_exceeded'
      || code === 'reached_active_user_cap' || code === 'spam_risk_too_many_posts'
    ) {
      return new TikTokRateLimitError(message || code, meta);
    }
    if (code === 'privacy_level_option_mismatch') {
      return new TikTokConfigError(message || code, meta);
    }
    if (String(code ?? '').startsWith('spam_risk')) {
      return new TikTokError(message || code, { ...meta, retryable: false });
    }
    if (status >= 500 || code === 'internal_error' || httpRetryable) {
      return new TikTokError(message || code, { ...meta, retryable: true });
    }
    return new TikTokError(message || code || 'TikTok rejected the request', {
      ...meta, retryable: false,
    });
  }

  _warn(message) {
    try { this.logger?.warn?.(message); } catch { /* logging must not fail a publish */ }
  }
}

export function composeTikTokTitle(post = {}) {
  const caption = typeof post.caption === 'string' ? post.caption.trim() : '';
  const tags = Array.isArray(post.hashtags)
    ? post.hashtags.map((tag) => String(tag).trim()).filter(Boolean).join(' ')
    : '';
  const title = [caption, tags].filter(Boolean).join('\n\n');
  if (title.length > 2200) {
    throw new TikTokConfigError('TikTok title exceeds 2200 UTF-16 characters');
  }
  return title;
}

export function planChunks(size) {
  if (size <= CHUNK_MAX) return { chunkSize: size, totalChunks: 1 };

  let chunkSize = CHUNK_MAX;
  let totalChunks = Math.floor(size / chunkSize);
  if (totalChunks < 2) {
    chunkSize = Math.ceil(size / 2);
    totalChunks = Math.max(2, Math.floor(size / chunkSize));
  }
  return { chunkSize, totalChunks };
}

function readChunk(filePath, start, end) {
  const length = end - start + 1;
  const buffer = Buffer.allocUnsafe(length);
  const fd = openSync(filePath, 'r');
  try {
    const read = readSync(fd, buffer, 0, length, start);
    if (read !== length) {
      throw new TikTokError('Short read while preparing a TikTok chunk', {
        retryable: false, code: 'SHORT_READ',
      });
    }
    return buffer;
  } finally {
    closeSync(fd);
  }
}

function parseUploadedRange(value) {
  const match = String(value ?? '').match(/bytes\s+\d+-(\d+)\/(\d+)/i);
  return match ? Number(match[1]) + 1 : null;
}

function isDefinitiveInitFailure(err) {
  if (!err) return false;
  if (err instanceof TikTokAuthError || err instanceof TikTokAuditError
    || err instanceof TikTokConfigError || err instanceof TikTokRateLimitError) {
    return true;
  }
  if (err instanceof TikTokError) {
    if (err.status >= 400 && err.status < 500) return true;
    if (err.status === 200 && err.code) return true;
  }
  return false;
}
