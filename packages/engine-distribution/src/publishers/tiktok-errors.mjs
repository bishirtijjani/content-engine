// TikTok-specific failures. `retryable: false` stops the engine loop.

export class TikTokError extends Error {
  constructor(message, {
    code = null, status = null, retryable = false, retryAfterMs = null, logId = null, cause = null,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TikTokError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.logId = logId;
  }
}

export class TikTokAuthError extends TikTokError {
  constructor(message, options = {}) {
    super(
      `${message} Reauthorize TikTok with scripts/tiktok-auth.mjs for the affected account.`,
      { ...options, retryable: false }
    );
    this.name = 'TikTokAuthError';
    this.reauthRequired = true;
  }
}

export class TikTokRateLimitError extends TikTokError {
  constructor(message, options = {}) {
    super(message, { ...options, retryable: true });
    this.name = 'TikTokRateLimitError';
  }
}

export class TikTokConfigError extends TikTokError {
  constructor(message, options = {}) {
    super(message, { ...options, retryable: false });
    this.name = 'TikTokConfigError';
  }
}

export class TikTokAuditError extends TikTokError {
  constructor(message, options = {}) {
    super(
      `${message} TikTok requires the app to be audited for public Direct Post; ` +
      'unaudited clients can only post to private accounts. Complete the Content Posting API audit.',
      { ...options, retryable: false }
    );
    this.name = 'TikTokAuditError';
    this.auditRequired = true;
  }
}

export class TikTokAmbiguousInitError extends TikTokError {
  constructor(message, options = {}) {
    super(
      `${message} A TikTok upload initialization may have succeeded without a recorded ` +
      'publish_id. Check the account and resolve manually before retrying; refusing to ' +
      'create a possible duplicate.',
      { ...options, retryable: false, code: 'AMBIGUOUS_TIKTOK_INIT' }
    );
    this.name = 'TikTokAmbiguousInitError';
  }
}

export class TikTokMediaError extends TikTokError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'TikTokMediaError';
  }
}
