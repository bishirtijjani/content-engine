export class YouTubeError extends Error {
  constructor(message, { status = null, code = null, retryable = true, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'YouTubeError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}
export class YouTubeAuthError extends YouTubeError {
  constructor(message, meta = {}) { super(message, { ...meta, retryable: false }); this.name = 'YouTubeAuthError'; }
}
export class YouTubeConfigError extends YouTubeError {
  constructor(message, meta = {}) { super(message, { ...meta, retryable: false }); this.name = 'YouTubeConfigError'; }
}
export class YouTubeMediaError extends YouTubeError {
  constructor(message, meta = {}) { super(message, { ...meta, retryable: true }); this.name = 'YouTubeMediaError'; }
}
export class YouTubeRateLimitError extends YouTubeError {
  constructor(message, meta = {}) { super(message, { ...meta, retryable: true }); this.name = 'YouTubeRateLimitError'; }
}