// Per-platform copy limits and validation.
//
// The content agent writes the copy. The engine only checks it against the
// platform's hard limits and refuses anything that cannot be published as
// written. Nothing here rewrites the agent's words.

export const PLATFORM_LIMITS = {
  tiktok: {
    caption: 2200, hashtags: 30, title: null, description: null,
    hashtagsInCaption: true,
  },
  youtube: {
    caption: 5000, hashtags: 15, title: 100, description: 5000,
    hashtagsInCaption: false, requireTitle: true,
  },
  instagram: {
    caption: 2200, hashtags: 30, title: null, description: null,
    hashtagsInCaption: true,
  },
  linkedin: {
    caption: 3000, hashtags: 30, title: null, description: null,
    hashtagsInCaption: true,
  },
  x: {
    caption: 280, hashtags: 10, title: null, description: null,
    hashtagsInCaption: true,
  },
  other: {
    caption: 5000, hashtags: 30, title: 100, description: 5000,
    hashtagsInCaption: false,
  },
};

const PLACEHOLDER = /\b(TBD|TODO|FIXME|placeholder|lorem ipsum)\b/i;
const TEMPLATE_MARKER = /\{\{[^}]*\}\}|<[a-z][^>]*>/i;

export function platformLimits(platform) {
  return PLATFORM_LIMITS[normalizePlatform(platform)] ?? PLATFORM_LIMITS.other;
}

export function normalizePlatform(platform) {
  return String(platform ?? '').trim().toLowerCase();
}

/**
 * Validate one platform's copy.
 *
 * @param {string} platform
 * @param {object} copy - { title?, caption, description?, hashtags?, thumbnail_path? }
 * @returns {{ ok: true, value: object } | { ok: false, reason: string }}
 */
export function validateCopy(platform, copy) {
  const name = normalizePlatform(platform);
  const limits = platformLimits(name);

  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) {
    return fail('copy must be an object');
  }

  if (copy.title !== undefined && copy.title !== null && typeof copy.title !== 'string') {
    return fail('title must be a string');
  }
  if (copy.description !== undefined && copy.description !== null && typeof copy.description !== 'string') {
    return fail('description must be a string');
  }

  const title = optionalString(copy.title);
  if (limits.requireTitle && !title) {
    return fail(`title is required for ${name}`);
  }
  if (title && limits.title && title.length > limits.title) {
    return fail(`title is ${title.length} characters; ${name} allows ${limits.title}`);
  }

  const caption = typeof copy.caption === 'string' ? copy.caption.trim() : '';
  if (!caption) return fail('caption is required');
  if (caption.length > limits.caption) {
    return fail(`caption is ${caption.length} characters; ${name} allows ${limits.caption}`);
  }

  const description = optionalString(copy.description);
  if (description && limits.description && description.length > limits.description) {
    return fail(`description is ${description.length} characters; ${name} allows ${limits.description}`);
  }

  const hashtags = copy.hashtags ?? [];
  if (!Array.isArray(hashtags)) return fail('hashtags must be an array');
  if (hashtags.length > limits.hashtags) {
    return fail(`${hashtags.length} hashtags; ${name} allows ${limits.hashtags}`);
  }
  for (const tag of hashtags) {
    if (typeof tag !== 'string' || !/^#[^\s#]+$/.test(tag.trim())) {
      return fail(`invalid hashtag: ${JSON.stringify(tag)}`);
    }
  }

  if (limits.hashtagsInCaption && hashtags.length) {
    const total = caption.length + 1 + hashtags.join(' ').length;
    if (total > limits.caption) {
      return fail(
        `caption plus hashtags is ${total} characters; ${name} allows ${limits.caption}`
      );
    }
  }

  for (const [field, value] of [['title', title], ['caption', caption], ['description', description]]) {
    if (value && (PLACEHOLDER.test(value) || TEMPLATE_MARKER.test(value))) {
      return fail(`${field} contains placeholder text`);
    }
  }

  const thumbnail = copy.thumbnail_path;
  if (thumbnail !== undefined && thumbnail !== null && typeof thumbnail !== 'string') {
    return fail('thumbnail_path must be a string');
  }

  return {
    ok: true,
    value: {
      title: title ?? null,
      caption,
      description: description ?? null,
      hashtags: hashtags.map((tag) => tag.trim()),
      thumbnail_path: thumbnail ?? null,
    },
  };
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function fail(reason) {
  return { ok: false, reason };
}
