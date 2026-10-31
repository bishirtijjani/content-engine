export class LinkedInError extends Error {
  constructor(message, { status = null, code = null, retryable = true, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LinkedInError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}
export class LinkedInAuthError extends LinkedInError {
  constructor(message, meta = {}) { super(message, { ...meta, retryable: false }); this.name = 'LinkedInAuthError'; }
}
export class LinkedInConfigError extends LinkedInError {
  constructor(message, meta = {}) { super(message, { ...meta, retryable: false }); this.name = 'LinkedInConfigError'; }
}
export class LinkedInMediaError extends LinkedInError {
  constructor(message, meta = {}) { super(message, { ...meta, retryable: true }); this.name = 'LinkedInMediaError'; }
}
export class LinkedInRateLimitError extends LinkedInError {
  constructor(message, meta = {}) { super(message, { ...meta, retryable: true }); this.name = 'LinkedInRateLimitError'; }
}