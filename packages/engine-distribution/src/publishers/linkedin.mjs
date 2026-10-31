import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import path from 'node:path';
import { LinkedInAuthError, LinkedInConfigError, LinkedInError, LinkedInMediaError, LinkedInRateLimitError } from './linkedin-errors.mjs';
import { HttpError, defaultSleep, requestJson } from './http.mjs';

const DEFAULT_API_VERSION = '202610';

export class LinkedInPublisher {
  constructor({
    account = 'main',
    clientId = null,
    clientSecret = null,
    memberUrn = null,
    accessToken = null,
    refreshToken = null,
    expiresAt = null,
    refreshExpiresAt = null,
    apiVersion = DEFAULT_API_VERSION,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    clock = () => new Date(),
    timeoutMs = 60000,
    maxAttempts = 3,
    onTokenRefresh = null,
    logger = null,
  } = {}) {
    if (!memberUrn) throw new LinkedInConfigError('LinkedIn memberUrn is missing from the credentials');
    if (!accessToken) throw new LinkedInConfigError('LinkedIn accessToken is missing from the credentials');

    this.account = account;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.memberUrn = memberUrn;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.expiresAt = expiresAt;
    this.refreshExpiresAt = refreshExpiresAt;
    this.apiVersion = apiVersion || DEFAULT_API_VERSION;
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

  async publish({ account = this.account, post, asset, item, state = null, updateState = () => {}, assets = null } = {}) {
    if (account !== this.account) {
      throw new LinkedInConfigError(`LinkedIn publisher for '${this.account}' cannot publish account '${account}'`);
    }

    this._state = state && typeof state === 'object' ? { ...state } : {};
    this._updateState = (patch) => {
      this._state = patch === null ? {} : { ...this._state, ...patch };
      updateState(patch === null ? null : this._state);
    };

    const current = this._state;
    if (current.stage === 'published' && current.postUrn) {
      return { externalId: current.postUrn, url: current.url ?? null };
    }

    await this._ensureToken();

    const assetsList = Array.isArray(assets) && assets.length ? assets : (asset ? [asset] : []);
    const imageAssets = assetsList.filter((a) => isImage(a?.file_path));
    const primary = asset ?? assetsList[0] ?? null;

    // Determine content type
    const isPdf = isPdfPath(primary?.file_path);
    const isVideo = isVideoPath(primary?.file_path);

    // Idempotent: if state has postUrn already, finish
    if (current.postUrn) {
      this._updateState({ stage: 'published', postUrn: current.postUrn });
      return { externalId: current.postUrn, url: current.url ?? null };
    }

    let postUrn = null;
    let url = null;

    try {
      if (isPdf) {
        postUrn = await this._publishDocument(post, primary);
      } else if (isVideo) {
        postUrn = await this._publishVideo(post, primary);
      } else if (imageAssets.length > 1) {
        postUrn = await this._publishMultiImage(post, imageAssets);
      } else if (imageAssets.length === 1) {
        postUrn = await this._publishImage(post, imageAssets[0]);
      } else {
        postUrn = await this._publishText(post);
      }
    } catch (err) {
      throw err;
    }

    url = `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`;
    this._updateState({ stage: 'published', postUrn, url, publishedAt: this.clock().toISOString() });
    return { externalId: postUrn, url };
  }

  // -------------------------------------------------------------------------
  // Text
  // -------------------------------------------------------------------------
  async _publishText(post) {
    const body = this._basePostBody(post);
    return this._createPost(body);
  }

  // -------------------------------------------------------------------------
  // Single image
  // -------------------------------------------------------------------------
  async _publishImage(post, asset) {
    const imageUrn = await this._uploadImage(asset);
    const body = this._basePostBody(post);
    body.content = { media: { id: imageUrn } };
    return this._createPost(body);
  }

  // -------------------------------------------------------------------------
  // Multi image
  // -------------------------------------------------------------------------
  async _publishMultiImage(post, assets) {
    const images = [];
    for (const asset of assets.slice(0, 20)) {
      const urn = await this._uploadImage(asset, false);
      images.push({ id: urn, altText: asset?.notes || undefined });
    }
    const body = this._basePostBody(post);
    body.content = { multiImage: { images } };
    return this._createPost(body);
  }

  // -------------------------------------------------------------------------
  // Video
  // -------------------------------------------------------------------------
  async _publishVideo(post, asset) {
    const videoUrn = await this._uploadVideo(asset);
    const body = this._basePostBody(post);
    body.content = { media: { id: videoUrn } };
    return this._createPost(body);
  }

  // -------------------------------------------------------------------------
  // Document (PDF)
  // -------------------------------------------------------------------------
  async _publishDocument(post, asset) {
    const docUrn = await this._uploadDocument(asset, post?.title);
    const body = this._basePostBody(post);
    body.content = { media: { title: post?.title || path.basename(asset.file_path), id: docUrn } };
    return this._createPost(body);
  }

  _basePostBody(post) {
    const commentary = [post?.caption, Array.isArray(post?.hashtags) ? post.hashtags.join(' ') : '']
      .filter(Boolean).join('\n\n');
    return {
      author: this.memberUrn,
      commentary,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
    };
  }

  async _createPost(body) {
    const url = 'https://api.linkedin.com/rest/posts';
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'LinkedIn-Version': this.apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    const urn = res.headers?.get?.('x-restli-id') || parsed?.id || parsed?.value?.id || null;
    if (res.ok && urn) return urn;
    if (!res.ok) {
      const msg = parsed?.message || `LinkedIn API HTTP ${res.status}`;
      if (res.status === 429) throw new LinkedInRateLimitError(msg, { status: res.status });
      if (res.status === 401 || res.status === 403) throw new LinkedInAuthError(msg, { status: res.status });
      throw new LinkedInError(msg, { status: res.status, retryable: res.status >= 500 });
    }
    throw new LinkedInError('LinkedIn did not return a post URN', { retryable: true, code: 'NO_POST_URN' });
  }

  // -------------------------------------------------------------------------
  // Uploads
  // -------------------------------------------------------------------------
  async _uploadImage(asset, useCache = true) {
    if (useCache && this._state.imageUrn) return this._state.imageUrn;
    const absolute = resolveFile(asset);
    const init = await this._rest('POST', '/rest/images?action=initializeUpload', {
      body: { initializeUploadRequest: { owner: this.memberUrn } },
    });
    const value = init?.value ?? init;
    const uploadUrl = value?.uploadUrl;
    const imageUrn = value?.image;
    if (!uploadUrl || !imageUrn) throw new LinkedInMediaError('LinkedIn image upload initialization failed', { code: 'IMAGE_INIT_FAILED' });

    this._updateState({ stage: 'uploading', imageUrn });
    await this._putBinary(uploadUrl, absolute, contentTypeForImage(absolute));
    return imageUrn;
  }

  async _uploadDocument(asset, title) {
    if (this._state.documentUrn) return this._state.documentUrn;
    const absolute = resolveFile(asset);
    const init = await this._rest('POST', '/rest/documents?action=initializeUpload', {
      body: { initializeUploadRequest: { owner: this.memberUrn } },
    });
    const value = init?.value ?? init;
    const uploadUrl = value?.uploadUrl;
    const docUrn = value?.document;
    if (!uploadUrl || !docUrn) throw new LinkedInMediaError('LinkedIn document upload initialization failed', { code: 'DOC_INIT_FAILED' });

    this._updateState({ stage: 'uploading', documentUrn: docUrn });
    await this._putBinary(uploadUrl, absolute, 'application/pdf');
    return docUrn;
  }

  async _uploadVideo(asset) {
    if (this._state.videoUrn) return this._state.videoUrn;
    const absolute = resolveFile(asset);
    const stat = statSync(absolute);
    const init = await this._rest('POST', '/rest/videos?action=initializeUpload', {
      body: { initializeUploadRequest: { owner: this.memberUrn, fileSizeBytes: stat.size } },
    });
    const value = init?.value ?? init;
    const videoUrn = value?.video;
    const uploadInstructions = value?.uploadInstructions ?? [];
    const singleUrl = value?.uploadUrl;

    if (!videoUrn) throw new LinkedInMediaError('LinkedIn video upload initialization failed', { code: 'VIDEO_INIT_FAILED' });
    this._updateState({ stage: 'uploading', videoUrn });

    const etags = [];

    if (uploadInstructions.length) {
      for (const inst of uploadInstructions) {
        const start = Number(inst.firstByte ?? 0);
        const end = Number(inst.lastByte ?? stat.size - 1);
        const chunk = readRange(absolute, start, end);
        const etag = await this._putBinary(inst.uploadUrl, chunk, 'application/octet-stream', {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        });
        etags.push(etag);
      }
    } else if (singleUrl) {
      const etag = await this._putBinary(singleUrl, absolute, 'application/octet-stream');
      etags.push(etag);
    } else {
      throw new LinkedInMediaError('LinkedIn returned no upload URL for video', { code: 'VIDEO_NO_URL' });
    }

    // Finalize the multipart upload before polling for processing.
    await this._rest('POST', '/rest/videos?action=finalizeUpload', {
      body: {
        finalizeUploadRequest: {
          video: videoUrn,
          uploadToken: value?.uploadToken ?? '',
          uploadedPartIds: etags,
        },
      },
    });

    // Wait for LinkedIn to finish processing the video before creating the post.
    await this._waitForVideo(videoUrn);

    this._updateState({ stage: 'uploading', videoUrn });
    return videoUrn;
  }

  async _waitForVideo(videoUrn) {
    const deadline = this.clock().getTime() + 2 * 60 * 1000;
    while (this.clock().getTime() < deadline) {
      try {
        const body = await this._rest('GET', `/rest/videos/${encodeURIComponent(videoUrn)}`);
        const status = body?.status ?? body?.value?.status;
        if (status === 'AVAILABLE' || status === 'READY') return;
        if (status === 'PROCESSING_FAILED' || status === 'FAILED') {
          throw new LinkedInMediaError('LinkedIn video processing failed', { code: 'VIDEO_PROCESSING_FAILED' });
        }
      } catch (err) {
        if (err instanceof LinkedInMediaError) throw err;
        // ignore transient
      }
      await this.sleep(5000);
    }
    throw new LinkedInMediaError('LinkedIn video did not become available in time', { code: 'VIDEO_PROCESSING_TIMEOUT' });
  }

  async _putBinary(url, data, contentType, extraHeaders = {}) {
    const payload = (typeof data === 'string')
      ? await readFileBuffer(data)
      : data;
    const res = await this.fetchImpl(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, ...extraHeaders },
      body: payload,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LinkedInError(`LinkedIn upload failed with HTTP ${res.status}: ${text.slice(0, 200)}`, {
        status: res.status, retryable: res.status === 429 || res.status >= 500,
      });
    }
    return res.headers?.get?.('etag') ?? res.headers?.get?.('ETag') ?? '';
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------
  async _ensureToken() {
    if (!this.accessToken) throw new LinkedInAuthError('LinkedIn accessToken is missing');
    const expires = this.expiresAt ? Date.parse(this.expiresAt) : null;
    if (expires === null || Number.isNaN(expires)) return;
    const now = this.clock().getTime();
    if (expires <= now) {
      await this._refreshToken();
    }
  }

  async _refreshToken() {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new LinkedInAuthError('LinkedIn access token expired; reconnect the account');
    }
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    let body;
    try {
      const res = await this.fetchImpl('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      body = await res.json();
      if (!res.ok) throw new HttpError('token refresh failed', { status: res.status, body });
    } catch (err) {
      throw new LinkedInAuthError(err?.message || 'LinkedIn token refresh failed', { cause: err });
    }
    if (!body?.access_token) throw new LinkedInAuthError('LinkedIn token refresh returned no access token');
    this.accessToken = body.access_token;
    if (body.expires_in) this.expiresAt = new Date(this.clock().getTime() + Number(body.expires_in) * 1000).toISOString();
    if (body.refresh_token) this.refreshToken = body.refresh_token;
    if (this.onTokenRefresh) {
      try {
        await this.onTokenRefresh({ account: this.account, memberUrn: this.memberUrn, accessToken: this.accessToken, expiresAt: this.expiresAt, refreshToken: this.refreshToken });
      } catch (err) {
        this.logger?.warn?.(`LinkedIn token refreshed but not persisted: ${err.message}`);
      }
    }
  }

  async _rest(method, endpoint, { body = null } = {}) {
    const url = `https://api.linkedin.com${endpoint}`;
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      'LinkedIn-Version': this.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    };
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 500) }; }
      if (!res.ok) {
        const msg = parsed?.message || parsed?.error_description || `LinkedIn API HTTP ${res.status}`;
        if (res.status === 429) throw new LinkedInRateLimitError(msg, { status: res.status });
        if (res.status === 401 || res.status === 403) throw new LinkedInAuthError(msg, { status: res.status });
        throw new LinkedInError(msg, { status: res.status, retryable: res.status >= 500 });
      }
      return parsed;
    } catch (err) {
      if (err instanceof LinkedInError) throw err;
      throw new LinkedInError(err?.message || 'LinkedIn request failed', { retryable: true, cause: err });
    }
  }
}

// helpers
function resolveFile(asset) {
  if (!asset?.file_path) throw new LinkedInConfigError('the post has no asset file_path');
  const absolute = path.resolve(asset.file_path);
  if (!existsSync(absolute)) throw new LinkedInConfigError(`file not found: ${absolute}`);
  return absolute;
}

function isImage(p) { return /\.(png|jpe?g|gif|webp)$/i.test(String(p || '')); }
function isVideoPath(p) { return /\.(mp4|mov|webm)$/i.test(String(p || '')); }
function isPdfPath(p) { return /\.pdf$/i.test(String(p || '')); }

async function readFileBuffer(filePath) {
  const { readFileSync } = await import('node:fs');
  return readFileSync(filePath);
}

function readRange(filePath, start, end) {
  const fd = openSync(filePath, 'r');
  const buf = Buffer.alloc(end - start + 1);
  readSync(fd, buf, 0, buf.length, start);
  closeSync(fd);
  return buf;
}

function contentTypeForImage(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}