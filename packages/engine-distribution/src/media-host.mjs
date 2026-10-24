// Media hosting for Instagram's public-video-URL requirement.
//
// The implementation targets S3-compatible object storage: AWS S3, Cloudflare
// R2, Backblaze B2 (S3 API), DigitalOcean Spaces, MinIO. Only PutObject and
// GetObject are needed. Uploads use a short-lived presigned PUT; Instagram
// fetches a short-lived presigned GET. Nothing in the bucket needs to be
// public.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  chmodSync, copyFileSync, createReadStream, existsSync, linkSync, mkdirSync,
  readFileSync, readdirSync, rmdirSync, statSync, unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { backoffMs, defaultSleep } from './publishers/http.mjs';

const MEMORY_UPLOAD_LIMIT = 16 * 1024 * 1024;
const MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024;

export class MediaHostError extends Error {
  constructor(message, { status = null, retryable = false, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MediaHostError';
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * Nginx-served media. The engine hardlinks (or copies) the render into a
 * directory nginx serves, under an unguessable path. No cloud account, no
 * upload API, no filebrowser dependency.
 *
 * Config:
 *   provider: "nginx"
 *   publicBaseUrl: "https://files.codeket.com/media"
 *   rootDir: "/opt/docker/apps/content-os/media"
 *   keyPrefix: "instagram"
 *   ttlHours: 24
 */
export class NginxMediaHost {
  constructor({ config, clock = () => new Date() } = {}) {
    if (!config) throw new MediaHostError('mediaHost configuration is required');
    if (!config.publicBaseUrl) throw new MediaHostError('mediaHost.publicBaseUrl is required');
    if (!config.rootDir) throw new MediaHostError('mediaHost.rootDir is required');

    this.config = {
      keyPrefix: 'instagram',
      ttlHours: 24,
      ...config,
      publicBaseUrl: String(config.publicBaseUrl).replace(/\/+$/, ''),
    };
    this.clock = clock;
    this.rootDir = path.resolve(config.rootDir);
  }

  async upload({ itemId, filePath }) {
    const source = path.resolve(filePath);
    if (!existsSync(source)) throw new MediaHostError(`video not found: ${source}`);

    const stat = statSync(source);
    if (!stat.isFile()) throw new MediaHostError(`video is not a file: ${source}`);

    this._cleanup();

    const folder = `item-${itemId ?? 'unknown'}`;
    const base = path.basename(source).replace(/[^a-zA-Z0-9._-]+/g, '-');
    const token = randomBytes(16).toString('hex');
    const prefix = sanitizeKeyPath(this.config.keyPrefix);
    const key = [prefix, folder, `${token}-${base}`].filter(Boolean).join('/');
    const target = this._pathFor(key);

    mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    try {
      linkSync(source, target);
    } catch {
      copyFileSync(source, target);
    }
    chmodSync(target, 0o644);

    return {
      key,
      url: `${this.config.publicBaseUrl}/${encodeKeyPath(key)}`,
      uploaded: true,
    };
  }

  /** Best effort: remove the temporary link after the platform confirms. */
  release(key) {
    const target = this._pathFor(key);
    if (!existsSync(target)) return false;
    unlinkSync(target);
    this._pruneEmpty(path.dirname(target));
    return true;
  }

  _pathFor(key) {
    const target = path.resolve(this.rootDir, key);
    if (target !== this.rootDir && !target.startsWith(this.rootDir + path.sep)) {
      throw new MediaHostError('refusing a media path outside the served directory');
    }
    return target;
  }

  /** Public worker hook. Returns the number of expired files removed. */
  cleanup() {
    return this._cleanup();
  }

  _cleanup() {
    const ttl = Number(this.config.ttlHours);
    if (!Number.isFinite(ttl) || ttl <= 0) return 0;
    return this._cleanupDir(this.rootDir, this.clock().getTime() - ttl * 3600_000, 0);
  }

  _cleanupDir(dir, cutoff, depth) {
    if (depth > 3) return 0;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return 0;
    }

    let removed = 0;
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        removed += this._cleanupDir(full, cutoff, depth + 1);
        try {
          if (readdirSync(full).length === 0) rmdirSync(full);
        } catch { /* not empty or already gone */ }
      } else if (entry.isFile()) {
        try {
          if (statSync(full).mtimeMs < cutoff) {
            unlinkSync(full);
            removed++;
          }
        } catch { /* already gone */ }
      }
    }
    return removed;
  }

  _pruneEmpty(dir) {
    let current = dir;
    while (current.startsWith(this.rootDir + path.sep)) {
      try {
        if (readdirSync(current).length > 0) return;
        rmdirSync(current);
      } catch {
        return;
      }
      current = path.dirname(current);
    }
  }
}

export class S3MediaHost {
  constructor({
    config,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    clock = () => new Date(),
    timeoutMs = 15 * 60 * 1000,
    attempts = 3,
  } = {}) {
    if (!config) {
      throw new MediaHostError('mediaHost configuration is required for Instagram publishing');
    }
    if (!config.bucket) throw new MediaHostError('mediaHost.bucket is required');
    if (!config.region) throw new MediaHostError('mediaHost.region is required');
    if (!config.accessKeyId) throw new MediaHostError('mediaHost.accessKeyId is required');
    if (!config.secretAccessKey) throw new MediaHostError('mediaHost.secretAccessKey is required');
    if (config.provider && !['s3', 'r2', 'minio', 'b2', 's3-compatible'].includes(config.provider)) {
      throw new MediaHostError(`unsupported mediaHost.provider '${config.provider}'`);
    }

    this.config = {
      forcePathStyle: Boolean(config.endpoint),
      keyPrefix: 'content-os/instagram',
      signedPutSeconds: 3600,
      signedGetSeconds: 7200,
      ...config,
    };
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.attempts = Math.max(1, attempts);
  }

  /** Deterministic key: a changed file gets a new key, a retry reuses it. */
  keyFor({ itemId, filePath }) {
    const absolute = path.resolve(filePath);
    const stat = statSync(absolute);
    if (!stat.isFile()) throw new MediaHostError(`video is not a file: ${absolute}`);
    if (stat.size > MAX_OBJECT_BYTES) {
      throw new MediaHostError('video exceeds the 5 GB object limit');
    }

    const base = path.basename(absolute).replace(/[^a-zA-Z0-9._-]+/g, '-');
    const version = createHash('sha256')
      .update(`${stat.size}:${Math.floor(stat.mtimeMs)}:${base}`)
      .digest('hex')
      .slice(0, 12);
    const prefix = String(this.config.keyPrefix || '').replace(/^\/+|\/+$/g, '');
    const folder = `item-${itemId ?? 'unknown'}`;
    return `${prefix ? `${prefix}/` : ''}${folder}/${version}-${base}`;
  }

  /** Upload if needed. Returns a public (presigned) GET URL. */
  async upload({ itemId, filePath, contentType = 'video/mp4' }) {
    const absolute = path.resolve(filePath);
    if (!existsSync(absolute)) {
      throw new MediaHostError(`video not found: ${absolute}`);
    }

    const stat = statSync(absolute);
    if (!stat.isFile()) throw new MediaHostError(`video is not a file: ${absolute}`);
    if (stat.size > MAX_OBJECT_BYTES) {
      throw new MediaHostError('video exceeds the 5 GB object limit');
    }

    const key = this.keyFor({ itemId, filePath: absolute });
    const getUrl = this.publicUrl(key) ?? this.presign('GET', key, this.config.signedGetSeconds);

    if (await this._exists(getUrl)) {
      return { key, url: getUrl, uploaded: false };
    }

    const putUrl = this.presign('PUT', key, this.config.signedPutSeconds);
    await this._put(putUrl, absolute, contentType, stat.size);
    return { key, url: getUrl, uploaded: true };
  }

  publicUrl(key) {
    if (!this.config.publicBaseUrl) return null;
    const base = String(this.config.publicBaseUrl).replace(/\/+$/, '');
    return `${base}/${encodeKeyPath(key)}`;
  }

  /** Best effort: remove the object after the platform confirms. */
  async release(key) {
    const url = this.presign('DELETE', key, 900);
    try {
      const response = await this.fetchImpl(url, {
        method: 'DELETE',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** S3 lifecycle rules own expiration; no worker action is needed. */
  async cleanup() {
    return 0;
  }

  presign(method, key, expires) {
    const target = this._target(key);
    return sigV4Presign({
      method,
      host: target.host,
      path: target.path,
      region: this.config.region,
      service: 's3',
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      sessionToken: this.config.sessionToken ?? null,
      expires,
      now: this.clock(),
    });
  }

  async _exists(url) {
    try {
      const response = await this.fetchImpl(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async _put(url, filePath, contentType, size) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const streamed = size > MEMORY_UPLOAD_LIMIT;
        const body = streamed ? createReadStream(filePath) : readFileSync(filePath);
        const response = await this.fetchImpl(url, {
          method: 'PUT',
          body,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(size),
          },
          ...(streamed ? { duplex: 'half' } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          const err = new MediaHostError(
            `media upload failed with HTTP ${response.status}`,
            { status: response.status, retryable: response.status === 429 || response.status >= 500 }
          );
          if (!err.retryable || attempt === this.attempts) throw err;
          lastError = err;
          await this.sleep(backoffMs(attempt));
          continue;
        }
        return;
      } catch (err) {
        lastError = err;
        if (err instanceof MediaHostError) {
          if (!err.retryable || attempt === this.attempts) throw err;
        } else if (attempt === this.attempts) {
          throw new MediaHostError(`media upload failed: ${err.message}`, {
            retryable: true, cause: err,
          });
        }
        await this.sleep(backoffMs(attempt));
      }
    }

    throw lastError ?? new MediaHostError('media upload failed');
  }

  _target(key) {
    const encodedKey = encodeKeyPath(key);
    const bucket = this.config.bucket;

    if (this.config.endpoint) {
      const endpoint = new URL(this.config.endpoint);
      const base = endpoint.pathname.replace(/\/+$/, '');
      if (this.config.forcePathStyle) {
        const prefix = `${base}/${encodeRfc3986(bucket)}`.replace(/\/+/g, '/');
        return { host: endpoint.host, path: normalizePath(`${prefix}/${encodedKey}`) };
      }
      return { host: `${bucket}.${endpoint.host}`, path: normalizePath(`${base}/${encodedKey}`) };
    }

    if (this.config.forcePathStyle) {
      return {
        host: `s3.${this.config.region}.amazonaws.com`,
        path: `/${encodeRfc3986(bucket)}/${encodedKey}`,
      };
    }

    return {
      host: `${bucket}.s3.${this.config.region}.amazonaws.com`,
      path: `/${encodedKey}`,
    };
  }
}

/**
 * AWS Signature Version 4 presigned URL. Exported for the known-vector test.
 */
export function sigV4Presign({
  method = 'GET',
  host,
  path: canonicalPath,
  region,
  service = 's3',
  accessKeyId,
  secretAccessKey,
  sessionToken = null,
  expires = 900,
  now = new Date(),
}) {
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  if (sessionToken) params['X-Amz-Security-Token'] = sessionToken;

  const canonicalQuery = Object.keys(params)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(params[key])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    String(method).toUpperCase(),
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    'aws4_request'
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return `https://${host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function encodeKeyPath(key) {
  return String(key).split('/').map(encodeRfc3986).join('/');
}

function sanitizeKeyPath(value) {
  return String(value ?? '')
    .split('/')
    .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^\.+$/, ''))
    .filter(Boolean)
    .join('/');
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizePath(value) {
  return value.startsWith('/') ? value : `/${value}`;
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}
