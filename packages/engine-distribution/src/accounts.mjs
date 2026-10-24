// Authorized publishing accounts and eligibility.
//
// settings.distribution.accounts is the source of truth when present:
//
//   {
//     "accounts": [
//       { "platform": "tiktok",    "account": "main",    "authorized": true },
//       { "platform": "tiktok",    "account": "clips",   "authorized": true },
//       { "platform": "instagram", "account": "creator", "type": "creator",
//         "authorized": true },
//       { "platform": "youtube",   "account": "main",    "authorized": true }
//     ]
//   }
//
// Each account is authorized on its own. `authorized: false` or
// `enabled: false` excludes it without touching the others.
//
// With no distribution setting, the engine falls back to the platform keys in
// settings.platforms, one account per platform named "default".

export function loadSettings(db) {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}

/**
 * The accounts an item may be published to.
 *
 * @param {object} settings - parsed settings rows
 * @param {object} [opts]
 * @param {object} [opts.item] - the content item (for pillar platform fit)
 * @param {string[]} [opts.platforms] - explicit platform override
 * @returns {Array<{platform: string, account: string, label: string|null,
 *                  type: string|null, enabled: boolean, authorized: boolean}>}
 */
export function resolveAccounts(settings, { item = null, platforms = null } = {}) {
  const configured = settings?.distribution?.accounts;
  const accounts = Array.isArray(configured) && configured.length
    ? configured.map(normalizeConfiguredAccount)
    : fallbackAccounts(settings);

  const seen = new Set();
  for (const account of accounts) {
    const key = `${account.platform}:${account.account}`;
    if (seen.has(key)) {
      throw new Error(`duplicate distribution account '${key}'`);
    }
    seen.add(key);
  }

  const explicit = Array.isArray(platforms) && platforms.length
    ? new Set(platforms.map((p) => normalizeName(p)).filter(Boolean))
    : null;

  // An explicit platform list is a deliberate override: it bypasses the
  // pillar's platform fit instead of intersecting with it.
  const pillarPlatforms = !explicit && item?.pillar
    ? settings?.pillar_details?.[item.pillar]?.platforms
    : null;
  const pillar = Array.isArray(pillarPlatforms) && pillarPlatforms.length
    ? new Set(pillarPlatforms.map((p) => normalizeName(p)).filter(Boolean))
    : null;

  return accounts.filter((account) => {
    if (!account.enabled || !account.authorized) return false;
    if (explicit && !explicit.has(account.platform)) return false;
    if (pillar && !pillar.has(account.platform)) return false;
    return true;
  });
}

function fallbackAccounts(settings) {
  const platforms = settings?.platforms;
  if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) return [];
  return Object.keys(platforms).map((platform) => ({
    platform: normalizeName(platform),
    account: 'default',
    label: null,
    type: null,
    enabled: true,
    authorized: true,
  }));
}

function normalizeConfiguredAccount(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`distribution account #${index} must be an object`);
  }
  const platform = normalizeName(raw.platform);
  const account = normalizeName(raw.account ?? raw.id ?? raw.label);
  if (!platform) {
    throw new Error(`distribution account #${index} has no platform`);
  }
  if (!account) {
    throw new Error(`distribution account #${index} has no account name`);
  }

  const type = raw.type == null ? null : normalizeName(raw.type);
  if (platform === 'instagram' && type && !['creator', 'business'].includes(type)) {
    throw new Error(`invalid instagram account type '${raw.type}' (use 'creator' or 'business')`);
  }

  return {
    platform,
    account,
    label: raw.label ?? null,
    type,
    enabled: raw.enabled !== false,
    authorized: raw.authorized !== false,
  };
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase();
}
