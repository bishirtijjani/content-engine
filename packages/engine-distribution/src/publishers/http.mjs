// JSON HTTP with timeouts, bounded retries and Retry-After support.
// The URL is never put in an error message: provider URLs can contain
// signatures or credentials.

export class HttpError extends Error {
  constructor(message, {
    status = null, body = null, headers = null, retryable = false, retryAfterMs = null,
  } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(value);
  if (!Number.isNaN(at)) return Math.max(0, at - now);
  return null;
}

export function backoffMs(attempt, base = 500, cap = 30000) {
  return Math.min(cap, base * 2 ** (attempt - 1));
}

export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} url
 * @param {object} opts
 * @param {Function} opts.fetchImpl
 * @param {Function} [opts.isRetryable] (status, parsedBody) => boolean
 * @param {number} [opts.attempts]
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.sleep]
 * @returns {Promise<object|null>}
 */
export async function requestJson(url, {
  method = 'GET',
  headers = {},
  body = undefined,
  bodyType = 'json',
  fetchImpl = globalThis.fetch,
  attempts = 3,
  timeoutMs = 30000,
  sleep = defaultSleep,
  isRetryable = (status) => status === 429 || status >= 500,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('no fetch implementation available');
  }

  const requestHeaders = { ...headers };
  let payload;
  if (body !== undefined && body !== null) {
    if (bodyType === 'form') {
      payload = new URLSearchParams(body).toString();
      requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/x-www-form-urlencoded';
    } else if (bodyType === 'raw') {
      payload = body;
    } else {
      payload = JSON.stringify(body);
      requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
    }
  }

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    let text;
    let parsed;

    try {
      response = await fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await response.text();
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { raw: text.slice(0, 1000) };
      }
    } catch (err) {
      lastError = err;
      if (attempt === attempts) throw err;
      await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) return parsed;

    const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
    const err = new HttpError(`HTTP ${response.status}`, {
      status: response.status,
      body: parsed,
      headers: response.headers,
      retryable: Boolean(isRetryable(response.status, parsed)),
      retryAfterMs,
    });
    lastError = err;

    if (!err.retryable || attempt === attempts) throw err;
    await sleep(retryAfterMs ?? backoffMs(attempt));
  }

  throw lastError ?? new Error('request failed');
}
