import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { YouTubeAuthError, YouTubeConfigError, YouTubeError, YouTubeMediaError, YouTubeRateLimitError } from './youtube-errors.mjs';
import { HttpError, defaultSleep } from './http.mjs';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const API_URL = 'https://www.googleapis.com/youtube/v3';

export class YouTubePublisher {
  constructor({
    account = 'main',
    clientId = null,
    clientSecret = null,
    channelId = null,
    accessToken = null,
    refreshToken = null,
    expiresAt = null,
    refreshExpiresAt = null,
    privacyLevel = 'private',
    categoryId = '22',
    defaultLanguage = null,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    clock = () => new Date(),
    timeoutMs = 60000,
    maxAttempts = 3,
    onTokenRefresh = null,
    logger = null,
  } = {}) {
    if (!accessToken) throw new YouTubeConfigError('YouTube accessToken is missing');
    this.account = account;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.channelId = channelId;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.expiresAt = expiresAt;
    this.refreshExpiresAt = refreshExpiresAt;
    this.privacyLevel = privacyLevel || 'private';
    this.categoryId = categoryId || '22';
    this.defaultLanguage = defaultLanguage;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = Math.max(1, maxAttempts);
    this.onTokenRefresh = onTokenRefresh;
    this.logger = logger;

    this._state = {};
    this._updateState = () => {};
  }

  async publish({ account = this.account, post, asset, item, state = null, updateState = () => {} } = {}) {
    if (account !== this.account) throw new YouTubeConfigError(`YouTube publisher for '${this.account}' cannot publish account '${account}'`);

    this._state = state && typeof state === 'object' ? { ...state } : {};
    this._updateState = (patch) => {
      this._state = patch === null ? {} : { ...this._state, ...patch };
      updateState(patch === null ? null : this._state);
    };

    const current = this._state;
    if (current.stage === 'published' && current.videoId) {
      return { externalId: current.videoId, url: current.url ?? `https://www.youtube.com/watch?v=${current.videoId}` };
    }

    await this._ensureToken();

    const filePath = asset?.file_path;
    if (!filePath) throw new YouTubeConfigError('the post has no asset file_path');
    const absolute = path.resolve(filePath);
    if (!existsSync(absolute)) throw new YouTubeConfigError(`video not found: ${absolute}`);
    const stat = statSync(absolute);

    // Resumable upload init
    let uploadUrl = current.uploadUrl ?? null;
    let videoId = current.videoId ?? null;

    if (!uploadUrl) {
      const metadata = this._metadata(post, item);
      const initRes = await this.fetchImpl(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(stat.size),
        },
        body: JSON.stringify(metadata),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!initRes.ok) {
        const text = await initRes.text().catch(() => '');
        throw new YouTubeError(`YouTube upload init failed: HTTP ${initRes.status} ${text.slice(0,200)}`, { status: initRes.status, retryable: initRes.status >= 500 });
      }
      uploadUrl = initRes.headers?.get?.('location') || initRes.headers?.get?.('Location');
      if (!uploadUrl) throw new YouTubeError('YouTube did not return an upload URL', { retryable: true });
      this._updateState({ stage: 'uploading', uploadUrl });
    }

    // Upload bytes if not already done
    if (!current.uploaded || current.uploadedBytes !== stat.size) {
      const putRes = await this.fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(stat.size),
        },
        body: await (await import('node:fs')).readFileSync(absolute),
        signal: AbortSignal.timeout(this.timeoutMs * 4),
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => '');
        throw new YouTubeError(`YouTube upload failed: HTTP ${putRes.status} ${text.slice(0,200)}`, { status: putRes.status, retryable: putRes.status >= 500 });
      }
      const body = await putRes.json().catch(() => null);
      videoId = body?.id ?? videoId;
      this.logger?.info?.(`YouTube upload completed: videoId=${videoId} status=${putRes.status}`);
      this._updateState({ stage: 'processing', uploadUrl, uploaded: true, uploadedBytes: stat.size, videoId });
    }

    if (!videoId) {
      // try to get from state or fail
      throw new YouTubeError('YouTube did not return a video id', { retryable: true });
    }

    // Poll processing
    const ready = await this._waitForProcessing(videoId);
    if (!ready) {
      throw new YouTubeMediaError('YouTube video did not finish processing in time', { code: 'PROCESSING_TIMEOUT' });
    }

    // Thumbnail (optional)
    if (post?.thumbnail_path) {
      await this._uploadThumbnail(videoId, post.thumbnail_path).catch((err) => {
        this.logger?.warn?.(`YouTube thumbnail upload failed: ${err.message}`);
      });
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    this._updateState({ stage: 'published', videoId, url, publishedAt: this.clock().toISOString() });
    return { externalId: videoId, url };
  }

  _metadata(post, item) {
    const pm = post?.platform_metadata || {};
    const minimal = pm.minimalMetadata === true;
    const scheduleRequested = pm.schedule === true;
    const scheduledAt = (scheduleRequested && post?.scheduled_at) ? new Date(post.scheduled_at) : null;
    const isScheduled = scheduledAt && scheduledAt.getTime() > this.clock().getTime();
    const privacy = isScheduled ? 'private' : (pm.privacyLevel || this.privacyLevel || 'private');
    const status = { privacyStatus: privacy };
    if (isScheduled) status.publishAt = scheduledAt.toISOString();
    const tags = minimal ? [] : (Array.isArray(post?.hashtags) ? post.hashtags.map((t) => String(t).replace(/^#/, '')) : []);
    const snippet = {
      title: post?.title || item?.title || 'Untitled',
      description: [post?.caption, post?.description].filter(Boolean).join('\n\n'),
      tags,
      categoryId: minimal ? '22' : (pm.categoryId || post?.categoryId || this.categoryId || '22'),
    };
    if (!minimal) {
      const lang = pm.defaultLanguage || post?.defaultLanguage || this.defaultLanguage;
      if (lang) {
        snippet.defaultLanguage = lang;
        snippet.defaultAudioLanguage = lang;
      }
    }
    return { snippet, status };
  }

  async _waitForProcessing(videoId) {
    const deadline = this.clock().getTime() + 5 * 60 * 1000;
    while (this.clock().getTime() < deadline) {
      try {
        const r = await this.fetchImpl(`${API_URL}/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (r.ok) {
          const body = await r.json();
          const v = body?.items?.[0];
          const uploadStatus = v?.status?.uploadStatus;
          if (uploadStatus === 'processed') return true;
          if (uploadStatus === 'failed' || uploadStatus === 'rejected') return false;
        }
      } catch { /* ignore */ }
      await this.sleep(5000);
    }
    return false;
  }

  async _uploadThumbnail(videoId, filePath) {
    const absolute = path.resolve(filePath);
    if (!existsSync(absolute)) return;
    const ext = path.extname(absolute).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
      throw new YouTubeMediaError('YouTube thumbnail must be PNG or JPEG', { code: 'THUMBNAIL_FORMAT' });
    }
    const stat = (await import('node:fs')).statSync(absolute);
    if (stat.size > 2 * 1024 * 1024) {
      throw new YouTubeMediaError('YouTube thumbnail must be under 2 MB', { code: 'THUMBNAIL_SIZE' });
    }
    const buf = (await import('node:fs')).readFileSync(absolute);
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const res = await this.fetchImpl(`${UPLOAD_URL}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': mime,
        'Content-Length': String(buf.length),
      },
      body: buf,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new YouTubeError(`thumbnail upload failed: HTTP ${res.status}`, { status: res.status });
  }

  async _ensureToken() {
    if (!this.accessToken) throw new YouTubeAuthError('YouTube accessToken is missing');
    const expires = this.expiresAt ? Date.parse(this.expiresAt) : null;
    if (expires === null || Number.isNaN(expires)) return;
    const now = this.clock().getTime();
    if (expires - now < 60 * 60 * 1000) {
      await this._refreshToken();
    }
  }

  async _refreshToken() {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new YouTubeAuthError('YouTube access token expired; reconnect the account');
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.access_token) {
      throw new YouTubeAuthError('YouTube token refresh failed', { status: res.status });
    }
    this.accessToken = body.access_token;
    if (body.expires_in) this.expiresAt = new Date(this.clock().getTime() + Number(body.expires_in) * 1000).toISOString();
    if (this.onTokenRefresh) {
      try {
        await this.onTokenRefresh({ account: this.account, channelId: this.channelId, accessToken: this.accessToken, expiresAt: this.expiresAt, refreshToken: this.refreshToken, scope: body.scope ?? null });
      } catch (err) {
        this.logger?.warn?.(`YouTube token refreshed but not persisted: ${err.message}`);
      }
    }
  }
}