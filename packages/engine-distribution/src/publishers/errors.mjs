// Errors the engine and the operator can act on. `retryable: false` stops the
// engine's retry loop; `reauthRequired` means the credentials must change.

export class InstagramError extends Error {
  constructor(message, {
    code = null, subcode = null, status = null, retryable = false,
    retryAfterMs = null, fbtraceId = null, cause = null,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'InstagramError';
    this.code = code;
    this.subcode = subcode;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.fbtraceId = fbtraceId;
  }
}

export class InstagramAuthError extends InstagramError {
  constructor(message, options = {}) {
    const advice = 'Reauthorize Instagram with `node scripts/instagram-auth.mjs` ' +
      'and update the credentials file.';
    super(`${message} ${advice}`, { ...options, retryable: false });
    this.name = 'InstagramAuthError';
    this.reauthRequired = true;
  }
}

export class InstagramRateLimitError extends InstagramError {
  constructor(message, options = {}) {
    super(message, { ...options, retryable: true });
    this.name = 'InstagramRateLimitError';
  }
}

export class InstagramConfigError extends InstagramError {
  constructor(message, options = {}) {
    super(message, { ...options, retryable: false });
    this.name = 'InstagramConfigError';
  }
}

export class InstagramMediaError extends InstagramError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'InstagramMediaError';
  }
}
