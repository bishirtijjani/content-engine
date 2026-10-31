// Credentials and provider configuration.
//
// Secrets live outside the repository by default:
//   ~/.config/content-os/credentials.json
// Override the path with CONTENT_OS_CREDENTIALS. Environment variables can
// supply the same values; they take precedence when present.
//
// Shape:
// {
//   "instagram": {
//     "appId": "...",
//     "appSecret": "...",
//     "apiVersion": "v26.0",
//     "accounts": {
//       "creator": {
//         "userId": "1784...",
//         "accessToken": "...",
//         "expiresAt": "2026-12-21T00:00:00.000Z"
//       }
//     }
//   },
//   "mediaHost": {
//     "provider": "s3",
//     "bucket": "...",
//     "region": "us-east-1",
//     "endpoint": null,
//     "accessKeyId": "...",
//     "secretAccessKey": "...",
//     "keyPrefix": "content-os/instagram",
//     "signedPutSeconds": 3600,
//     "signedGetSeconds": 7200
//   }
// }
import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { PROJECT_ROOT } from '@content-os/core';

export const DEFAULT_CREDENTIALS_PATH = path.join(
  homedir(), '.config', 'content-os', 'credentials.json'
);

export function credentialsPath(explicit = null) {
  return explicit || process.env.CONTENT_OS_CREDENTIALS || DEFAULT_CREDENTIALS_PATH;
}

/**
 * The deployment convention is one .env next to the app directory:
 *   /opt/docker/apps/content-os/.env
 * PROJECT_ROOT is <app>/repo, so its parent is the app directory.
 */
export function defaultEnvFile() {
  return process.env.CONTENT_OS_ENV_FILE || path.resolve(PROJECT_ROOT, '..', '.env');
}

/** Read a .env file. Values override the JSON store; process env wins last. */
export function readEnvFile(file = defaultEnvFile()) {
  if (!file || !existsSync(file)) return {};
  assertSecurePermissions(file);

  const values = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = unquote(match[2].trim());
  }
  return values;
}

/** Update or append keys in a .env file, preserving comments and order. */
export function writeEnvValues(file, updates) {
  const target = file || defaultEnvFile();
  const lines = existsSync(target) ? readFileSync(target, 'utf8').split(/\r?\n/) : [];
  const pending = new Map(
    Object.entries(updates).filter(([, value]) => value !== undefined && value !== null)
  );
  const output = [];

  for (const line of lines) {
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && pending.has(match[1])) {
      output.push(`${match[1]}=${formatEnvValue(pending.get(match[1]))}`);
      pending.delete(match[1]);
    } else {
      output.push(line);
    }
  }

  if (output.length && output[output.length - 1] !== '') output.push('');
  for (const [key, value] of pending) output.push(`${key}=${formatEnvValue(value)}`);

  writeFileAtomically(target, `${output.join('\n').replace(/\n+$/, '')}\n`);
  return target;
}

/** Stored values only. Environment variables are applied by loadCredentials. */
export function loadStoredCredentials({ path: file = null } = {}) {
  const target = credentialsPath(file);
  if (!existsSync(target)) return {};
  assertSecurePermissions(target);
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('the root value must be an object');
    }
    return parsed;
  } catch (err) {
    throw new Error(`credentials file ${target} is not valid JSON: ${err.message}`);
  }
}

/** Stored values with .env and process environment overrides. */
export function loadCredentials({ path: file = null, env = process.env, envFile = null } = {}) {
  const fileEnv = envFile ? readEnvFile(envFile) : {};
  return applyEnvironment(loadStoredCredentials({ path: file }), { ...fileEnv, ...env });
}

export function saveCredentials(credentials, { path: file = null } = {}) {
  const target = credentialsPath(file);
  writeFileAtomically(target, `${JSON.stringify(credentials, null, 2)}\n`);
  return target;
}

/**
 * Persist a refreshed Instagram token without touching other accounts or
 * providers. Env-only setups are written to the same file so the refresh
 * survives a restart.
 */
export function saveInstagramToken(
  accountName,
  { accessToken, expiresAt, userId = null },
  { path: file = null, envFile = null } = {}
) {
  const targets = [];

  if (envFile) {
    targets.push(writeEnvValues(envFile, {
      INSTAGRAM_ACCOUNT: accountName,
      INSTAGRAM_USER_ID: userId,
      INSTAGRAM_ACCESS_TOKEN: accessToken,
      INSTAGRAM_TOKEN_EXPIRES_AT: expiresAt,
    }));
  }

  if (file) {
    const stored = loadStoredCredentials({ path: file });
    const instagram = { ...(stored.instagram ?? {}) };
    const accounts = { ...(instagram.accounts ?? {}) };

    accounts[accountName] = {
      ...(accounts[accountName] ?? {}),
      ...(userId ? { userId } : {}),
      accessToken,
      ...(expiresAt ? { expiresAt } : {}),
    };
    instagram.accounts = accounts;
    stored.instagram = instagram;
    targets.push(saveCredentials(stored, { path: file }));
  }

  return targets;
}

/** Account name -> { userId, accessToken, expiresAt }. */
export function instagramAccounts(credentials = {}) {
  const instagram = credentials.instagram ?? {};
  const normalize = (accounts) => Object.fromEntries(
    Object.entries(accounts).map(([name, value]) => [String(name).toLowerCase(), value])
  );

  if (instagram.accounts && typeof instagram.accounts === 'object' && !Array.isArray(instagram.accounts)) {
    return normalize(instagram.accounts);
  }
  if (instagram.accessToken) {
    return normalize({
      [instagram.account || 'creator']: {
        userId: instagram.userId ?? null,
        accessToken: instagram.accessToken,
        expiresAt: instagram.expiresAt ?? null,
      },
    });
  }
  return {};
}

export function instagramApp(credentials = {}) {
  const instagram = credentials.instagram ?? {};
  return {
    appId: instagram.appId ?? null,
    appSecret: instagram.appSecret ?? null,
    apiVersion: instagram.apiVersion ?? process.env.INSTAGRAM_API_VERSION ?? 'v26.0',
  };
}

/** TikTok account name -> independently authorized token set. */
export function tikTokAccounts(credentials = {}) {
  const tiktok = credentials.tiktok ?? {};
  const accounts = tiktok.accounts;
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return {};

  return Object.fromEntries(Object.entries(accounts).map(([name, value]) => [
    String(name).toLowerCase(),
    {
      name: String(name).toLowerCase(),
      slot: value.slot ?? null,
      clientKey: value.clientKey ?? tiktok.clientKey ?? null,
      clientSecret: value.clientSecret ?? tiktok.clientSecret ?? null,
      openId: value.openId ?? null,
      accessToken: value.accessToken ?? null,
      refreshToken: value.refreshToken ?? null,
      expiresAt: value.expiresAt ?? null,
      refreshExpiresAt: value.refreshExpiresAt ?? null,
      mode: value.mode ?? 'direct',
      privacyLevel: value.privacyLevel ?? null,
      scope: value.scope ?? null,
    },
  ]));
}

export function tikTokConfig(credentials = {}) {
  const tiktok = credentials.tiktok ?? {};
  return {
    clientKey: tiktok.clientKey ?? null,
    clientSecret: tiktok.clientSecret ?? null,
    apiBase: tiktok.apiBase ?? 'https://open.tiktokapis.com',
    accounts: tikTokAccounts(credentials),
  };
}

/**
 * Persist refreshed TikTok tokens to the same numbered .env slot. The slot is
 * required; tokens are never written to an invented account.
 */
export function saveTikTokToken(
  accountName,
  tokens,
  { slot = null, path: file = null, envFile = null } = {}
) {
  const name = String(accountName).toLowerCase();
  const targets = [];

  if (envFile) {
    const values = readEnvFile(envFile);
    let resolvedSlot = slot;

    if (resolvedSlot === null) {
      for (const [key, value] of Object.entries(values)) {
        const match = key.match(/^TIKTOK_ACCOUNT_(\d+)_NAME$/);
        if (match && String(value).toLowerCase() === name) {
          resolvedSlot = Number(match[1]);
          break;
        }
      }
    }
    if (resolvedSlot === null) {
      throw new Error(
        `no TikTok account slot for '${name}' in ${envFile}; run scripts/tiktok-auth.mjs with --slot`
      );
    }

    targets.push(writeEnvValues(envFile, {
      [`TIKTOK_ACCOUNT_${resolvedSlot}_NAME`]: name,
      [`TIKTOK_ACCOUNT_${resolvedSlot}_OPEN_ID`]: tokens.openId,
      [`TIKTOK_ACCOUNT_${resolvedSlot}_ACCESS_TOKEN`]: tokens.accessToken,
      [`TIKTOK_ACCOUNT_${resolvedSlot}_REFRESH_TOKEN`]: tokens.refreshToken,
      [`TIKTOK_ACCOUNT_${resolvedSlot}_EXPIRES_AT`]: tokens.expiresAt,
      [`TIKTOK_ACCOUNT_${resolvedSlot}_REFRESH_EXPIRES_AT`]: tokens.refreshExpiresAt,
      [`TIKTOK_ACCOUNT_${resolvedSlot}_SCOPE`]: tokens.scope,
    }));
  }

  if (file) {
    const stored = loadStoredCredentials({ path: file });
    const tiktok = { ...(stored.tiktok ?? {}) };
    const accounts = { ...(tiktok.accounts ?? {}) };
    accounts[name] = {
      ...(accounts[name] ?? {}),
      ...tokens,
      slot: slot ?? accounts[name]?.slot ?? null,
    };
    tiktok.accounts = accounts;
    stored.tiktok = tiktok;
    targets.push(saveCredentials(stored, { path: file }));
  }

  return targets;
}

/** LinkedIn account name -> independently authorized token set. */
export function linkedInAccounts(credentials = {}) {
  const linkedin = credentials.linkedin ?? {};
  const accounts = linkedin.accounts;
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return {};

  return Object.fromEntries(Object.entries(accounts).map(([name, value]) => [
    String(name).toLowerCase(),
    {
      name: String(name).toLowerCase(),
      slot: value.slot ?? null,
      clientId: value.clientId ?? linkedin.clientId ?? null,
      clientSecret: value.clientSecret ?? linkedin.clientSecret ?? null,
      memberUrn: value.memberUrn ?? value.member_urn ?? null,
      accessToken: value.accessToken ?? null,
      refreshToken: value.refreshToken ?? null,
      expiresAt: value.expiresAt ?? null,
      refreshExpiresAt: value.refreshExpiresAt ?? null,
      scope: value.scope ?? null,
      apiVersion: value.apiVersion ?? linkedin.apiVersion ?? null,
    },
  ]));
}

export function linkedInApp(credentials = {}) {
  const linkedin = credentials.linkedin ?? {};
  return {
    clientId: linkedin.clientId ?? null,
    clientSecret: linkedin.clientSecret ?? null,
    redirectUri: linkedin.redirectUri ?? null,
    apiVersion: linkedin.apiVersion ?? process.env.LINKEDIN_API_VERSION ?? '202610',
  };
}

export function saveLinkedInToken(
  accountName,
  tokens,
  { slot = null, path: file = null, envFile = null } = {}
) {
  const name = String(accountName).toLowerCase();
  const targets = [];

  if (envFile) {
    const values = readEnvFile(envFile);
    let resolvedSlot = slot;
    if (resolvedSlot === null) {
      for (const [key, value] of Object.entries(values)) {
        const match = key.match(/^LINKEDIN_ACCOUNT_(\d+)_NAME$/);
        if (match && String(value).toLowerCase() === name) {
          resolvedSlot = Number(match[1]);
          break;
        }
      }
    }
    if (resolvedSlot === null) {
      throw new Error(
        `no LinkedIn account slot for '${name}' in ${envFile}; run scripts/linkedin-auth.mjs with --slot`
      );
    }

    const updates = {
      [`LINKEDIN_ACCOUNT_${resolvedSlot}_NAME`]: name,
      [`LINKEDIN_ACCOUNT_${resolvedSlot}_MEMBER_URN`]: tokens.memberUrn,
      [`LINKEDIN_ACCOUNT_${resolvedSlot}_ACCESS_TOKEN`]: tokens.accessToken,
      [`LINKEDIN_ACCOUNT_${resolvedSlot}_EXPIRES_AT`]: tokens.expiresAt,
    };
    if (tokens.scope) updates[`LINKEDIN_ACCOUNT_${resolvedSlot}_SCOPE`] = tokens.scope;
    if (tokens.memberUrn) updates[`LINKEDIN_ACCOUNT_${resolvedSlot}_MEMBER_URN`] = tokens.memberUrn;
    if (tokens.refreshToken) {
      updates[`LINKEDIN_ACCOUNT_${resolvedSlot}_REFRESH_TOKEN`] = tokens.refreshToken;
    }
    if (tokens.refreshExpiresAt) {
      updates[`LINKEDIN_ACCOUNT_${resolvedSlot}_REFRESH_EXPIRES_AT`] = tokens.refreshExpiresAt;
    }
    targets.push(writeEnvValues(envFile, updates));
  }

  if (file) {
    const stored = loadStoredCredentials({ path: file });
    const linkedin = { ...(stored.linkedin ?? {}) };
    const accounts = { ...(linkedin.accounts ?? {}) };
    accounts[name] = {
      ...(accounts[name] ?? {}),
      ...tokens,
      slot: slot ?? accounts[name]?.slot ?? null,
    };
    linkedin.accounts = accounts;
    stored.linkedin = linkedin;
    targets.push(saveCredentials(stored, { path: file }));
  }

  return targets;
}

/** YouTube account name -> independently authorized token set. */
export function youTubeAccounts(credentials = {}) {
  const youtube = credentials.youtube ?? {};
  const accounts = youtube.accounts;
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return {};

  return Object.fromEntries(Object.entries(accounts).map(([name, value]) => [
    String(name).toLowerCase(),
    {
      name: String(name).toLowerCase(),
      slot: value.slot ?? null,
      clientId: value.clientId ?? youtube.clientId ?? null,
      clientSecret: value.clientSecret ?? youtube.clientSecret ?? null,
      channelId: value.channelId ?? null,
      accessToken: value.accessToken ?? null,
      refreshToken: value.refreshToken ?? null,
      expiresAt: value.expiresAt ?? null,
      refreshExpiresAt: value.refreshExpiresAt ?? null,
      scope: value.scope ?? null,
      privacyLevel: value.privacyLevel ?? youtube.privacyLevel ?? 'private',
    },
  ]));
}

export function youTubeApp(credentials = {}) {
  const youtube = credentials.youtube ?? {};
  return {
    clientId: youtube.clientId ?? null,
    clientSecret: youtube.clientSecret ?? null,
    redirectUri: youtube.redirectUri ?? null,
  };
}

export function saveYouTubeToken(
  accountName,
  tokens,
  { slot = null, path: file = null, envFile = null } = {}
) {
  const name = String(accountName).toLowerCase();
  const targets = [];

  if (envFile) {
    const values = readEnvFile(envFile);
    let resolvedSlot = slot;
    if (resolvedSlot === null) {
      for (const [key, value] of Object.entries(values)) {
        const match = key.match(/^YOUTUBE_ACCOUNT_(\d+)_NAME$/);
        if (match && String(value).toLowerCase() === name) {
          resolvedSlot = Number(match[1]);
          break;
        }
      }
    }
    if (resolvedSlot === null) {
      throw new Error(`no YouTube account slot for '${name}' in ${envFile}`);
    }

    const updates = {
      [`YOUTUBE_ACCOUNT_${resolvedSlot}_NAME`]: name,
      [`YOUTUBE_ACCOUNT_${resolvedSlot}_CHANNEL_ID`]: tokens.channelId,
      [`YOUTUBE_ACCOUNT_${resolvedSlot}_ACCESS_TOKEN`]: tokens.accessToken,
      [`YOUTUBE_ACCOUNT_${resolvedSlot}_EXPIRES_AT`]: tokens.expiresAt,
      [`YOUTUBE_ACCOUNT_${resolvedSlot}_SCOPE`]: tokens.scope,
    };
    if (tokens.refreshToken) updates[`YOUTUBE_ACCOUNT_${resolvedSlot}_REFRESH_TOKEN`] = tokens.refreshToken;
    if (tokens.refreshExpiresAt) updates[`YOUTUBE_ACCOUNT_${resolvedSlot}_REFRESH_EXPIRES_AT`] = tokens.refreshExpiresAt;
    if (tokens.privacyLevel) updates[`YOUTUBE_ACCOUNT_${resolvedSlot}_PRIVACY_LEVEL`] = tokens.privacyLevel;
    targets.push(writeEnvValues(envFile, updates));
  }

  if (file) {
    const stored = loadStoredCredentials({ path: file });
    const youtube = { ...(stored.youtube ?? {}) };
    const accounts = { ...(youtube.accounts ?? {}) };
    accounts[name] = { ...(accounts[name] ?? {}), ...tokens, slot: slot ?? accounts[name]?.slot ?? null };
    youtube.accounts = accounts;
    stored.youtube = youtube;
    targets.push(saveCredentials(stored, { path: file }));
  }

  return targets;
}

export function mediaHostConfig(credentials = {}) {
  const host = credentials.mediaHost ?? credentials.media_host ?? null;
  if (!host || typeof host !== 'object') return null;

  const provider = host.provider ?? (host.rootDir ? 'nginx' : 's3');
  if (provider === 'nginx' || provider === 'local') {
    return {
      provider: 'nginx',
      publicBaseUrl: host.publicBaseUrl ?? null,
      rootDir: host.rootDir ?? null,
      keyPrefix: host.keyPrefix ?? 'instagram',
      ttlHours: host.ttlHours ?? 24,
    };
  }

  return {
    provider,
    bucket: host.bucket ?? null,
    region: host.region ?? 'auto',
    endpoint: host.endpoint ?? null,
    accessKeyId: host.accessKeyId ?? null,
    secretAccessKey: host.secretAccessKey ?? null,
    publicBaseUrl: host.publicBaseUrl ?? null,
    keyPrefix: host.keyPrefix ?? 'content-os/instagram',
    forcePathStyle: host.forcePathStyle ?? Boolean(host.endpoint),
    signedPutSeconds: host.signedPutSeconds ?? 3600,
    signedGetSeconds: host.signedGetSeconds ?? 7200,
  };
}

function applyEnvironment(stored, env) {
  const out = JSON.parse(JSON.stringify(stored));
  const instagram = { ...(out.instagram ?? {}) };

  if (env.INSTAGRAM_APP_ID) instagram.appId = env.INSTAGRAM_APP_ID;
  if (env.INSTAGRAM_APP_SECRET) instagram.appSecret = env.INSTAGRAM_APP_SECRET;
  if (env.INSTAGRAM_API_VERSION) instagram.apiVersion = env.INSTAGRAM_API_VERSION;

  if (env.INSTAGRAM_USER_ID || env.INSTAGRAM_ACCESS_TOKEN || env.INSTAGRAM_TOKEN_EXPIRES_AT) {
    const name = env.INSTAGRAM_ACCOUNT || 'creator';
    const accounts = { ...(instagram.accounts ?? {}) };
    accounts[name] = {
      ...(accounts[name] ?? {}),
      ...(env.INSTAGRAM_USER_ID ? { userId: env.INSTAGRAM_USER_ID } : {}),
      ...(env.INSTAGRAM_ACCESS_TOKEN ? { accessToken: env.INSTAGRAM_ACCESS_TOKEN } : {}),
      ...(env.INSTAGRAM_TOKEN_EXPIRES_AT ? { expiresAt: env.INSTAGRAM_TOKEN_EXPIRES_AT } : {}),
    };
    instagram.accounts = accounts;
  }

  if (Object.keys(instagram).length) out.instagram = instagram;

  const tiktok = { ...(out.tiktok ?? {}) };
  if (env.TIKTOK_CLIENT_KEY) tiktok.clientKey = env.TIKTOK_CLIENT_KEY;
  if (env.TIKTOK_CLIENT_SECRET) tiktok.clientSecret = env.TIKTOK_CLIENT_SECRET;
  if (env.TIKTOK_API_BASE) tiktok.apiBase = env.TIKTOK_API_BASE;

  const tiktokSlots = {};
  for (const [key, value] of Object.entries(env)) {
    const match = key.match(/^TIKTOK_ACCOUNT_(\d+)_(.+)$/);
    if (!match) continue;
    const slot = Number(match[1]);
    tiktokSlots[slot] = tiktokSlots[slot] ?? {};
    tiktokSlots[slot][match[2].toLowerCase()] = value;
  }
  if (Object.keys(tiktokSlots).length) {
    const accounts = { ...(tiktok.accounts ?? {}) };
    for (const [slot, fields] of Object.entries(tiktokSlots)) {
      if (!fields.name) continue;
      const name = String(fields.name).toLowerCase();
      accounts[name] = {
        ...(accounts[name] ?? {}),
        name,
        slot: Number(slot),
        clientKey: fields.client_key ?? tiktok.clientKey ?? null,
        clientSecret: fields.client_secret ?? tiktok.clientSecret ?? null,
        openId: fields.open_id ?? null,
        accessToken: fields.access_token ?? null,
        refreshToken: fields.refresh_token ?? null,
        expiresAt: fields.expires_at ?? null,
        refreshExpiresAt: fields.refresh_expires_at ?? null,
        mode: fields.mode ?? 'direct',
        privacyLevel: fields.privacy_level ?? null,
        scope: fields.scope ?? null,
      };
    }
    tiktok.accounts = accounts;
  }
  if (Object.keys(tiktok).length) out.tiktok = tiktok;

  const linkedin = { ...(out.linkedin ?? {}) };
  if (env.LINKEDIN_CLIENT_ID) linkedin.clientId = env.LINKEDIN_CLIENT_ID;
  if (env.LINKEDIN_CLIENT_SECRET) linkedin.clientSecret = env.LINKEDIN_CLIENT_SECRET;
  if (env.LINKEDIN_REDIRECT_URI) linkedin.redirectUri = env.LINKEDIN_REDIRECT_URI;
  if (env.LINKEDIN_API_VERSION) linkedin.apiVersion = env.LINKEDIN_API_VERSION;

  const linkedinSlots = {};
  for (const [key, value] of Object.entries(env)) {
    const match = key.match(/^LINKEDIN_ACCOUNT_(\d+)_(.+)$/);
    if (!match) continue;
    const slot = Number(match[1]);
    linkedinSlots[slot] = linkedinSlots[slot] ?? {};
    linkedinSlots[slot][match[2].toLowerCase()] = value;
  }
  if (Object.keys(linkedinSlots).length) {
    const accounts = { ...(linkedin.accounts ?? {}) };
    for (const [slot, fields] of Object.entries(linkedinSlots)) {
      if (!fields.name) continue;
      const name = String(fields.name).toLowerCase();
      accounts[name] = {
        ...(accounts[name] ?? {}),
        name,
        slot: Number(slot),
        clientId: fields.client_id ?? linkedin.clientId ?? null,
        clientSecret: fields.client_secret ?? linkedin.clientSecret ?? null,
        memberUrn: fields.member_urn ?? null,
        accessToken: fields.access_token ?? null,
        refreshToken: fields.refresh_token ?? null,
        expiresAt: fields.expires_at ?? null,
        refreshExpiresAt: fields.refresh_expires_at ?? null,
        scope: fields.scope ?? null,
        apiVersion: fields.api_version ?? linkedin.apiVersion ?? null,
      };
    }
    linkedin.accounts = accounts;
  }
  if (Object.keys(linkedin).length) out.linkedin = linkedin;

  const youtube = { ...(out.youtube ?? {}) };
  if (env.YOUTUBE_CLIENT_ID) youtube.clientId = env.YOUTUBE_CLIENT_ID;
  if (env.YOUTUBE_CLIENT_SECRET) youtube.clientSecret = env.YOUTUBE_CLIENT_SECRET;
  if (env.YOUTUBE_REDIRECT_URI) youtube.redirectUri = env.YOUTUBE_REDIRECT_URI;
  if (env.YOUTUBE_PRIVACY_LEVEL) youtube.privacyLevel = env.YOUTUBE_PRIVACY_LEVEL;

  const youtubeSlots = {};
  for (const [key, value] of Object.entries(env)) {
    const match = key.match(/^YOUTUBE_ACCOUNT_(\d+)_(.+)$/);
    if (!match) continue;
    const slot = Number(match[1]);
    youtubeSlots[slot] = youtubeSlots[slot] ?? {};
    youtubeSlots[slot][match[2].toLowerCase()] = value;
  }
  if (Object.keys(youtubeSlots).length) {
    const accounts = { ...(youtube.accounts ?? {}) };
    for (const [slot, fields] of Object.entries(youtubeSlots)) {
      if (!fields.name) continue;
      const name = String(fields.name).toLowerCase();
      accounts[name] = {
        ...(accounts[name] ?? {}),
        name,
        slot: Number(slot),
        clientId: fields.client_id ?? youtube.clientId ?? null,
        clientSecret: fields.client_secret ?? youtube.clientSecret ?? null,
        channelId: fields.channel_id ?? null,
        accessToken: fields.access_token ?? null,
        refreshToken: fields.refresh_token ?? null,
        expiresAt: fields.expires_at ?? null,
        refreshExpiresAt: fields.refresh_expires_at ?? null,
        scope: fields.scope ?? null,
        privacyLevel: fields.privacy_level ?? youtube.privacyLevel ?? 'private',
      };
    }
    youtube.accounts = accounts;
  }
  if (Object.keys(youtube).length) out.youtube = youtube;

  const host = { ...(out.mediaHost ?? {}) };
  if (env.MEDIA_HOST_PROVIDER) host.provider = env.MEDIA_HOST_PROVIDER;
  if (env.MEDIA_HOST_BUCKET) host.bucket = env.MEDIA_HOST_BUCKET;
  if (env.MEDIA_HOST_REGION) host.region = env.MEDIA_HOST_REGION;
  if (env.MEDIA_HOST_ENDPOINT) host.endpoint = env.MEDIA_HOST_ENDPOINT;
  if (env.MEDIA_HOST_ACCESS_KEY_ID) host.accessKeyId = env.MEDIA_HOST_ACCESS_KEY_ID;
  if (env.MEDIA_HOST_SECRET_ACCESS_KEY) host.secretAccessKey = env.MEDIA_HOST_SECRET_ACCESS_KEY;
  if (env.MEDIA_HOST_PUBLIC_BASE_URL) host.publicBaseUrl = env.MEDIA_HOST_PUBLIC_BASE_URL;
  if (env.MEDIA_HOST_ROOT_DIR) host.rootDir = env.MEDIA_HOST_ROOT_DIR;
  if (env.MEDIA_HOST_KEY_PREFIX) host.keyPrefix = env.MEDIA_HOST_KEY_PREFIX;
  if (env.MEDIA_HOST_TTL_HOURS) host.ttlHours = Number(env.MEDIA_HOST_TTL_HOURS);
  if (env.MEDIA_HOST_FORCE_PATH_STYLE !== undefined) {
    host.forcePathStyle = env.MEDIA_HOST_FORCE_PATH_STYLE === 'true' || env.MEDIA_HOST_FORCE_PATH_STYLE === '1';
  }
  if (env.MEDIA_HOST_SIGNED_PUT_SECONDS) host.signedPutSeconds = Number(env.MEDIA_HOST_SIGNED_PUT_SECONDS);
  if (env.MEDIA_HOST_SIGNED_GET_SECONDS) host.signedGetSeconds = Number(env.MEDIA_HOST_SIGNED_GET_SECONDS);
  if (Object.keys(host).length) out.mediaHost = host;

  return out;
}

function assertSecurePermissions(file) {
  if (process.platform === 'win32') return;
  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) {
    throw new Error(
      `credentials file ${file} is accessible to group or others (mode ${mode.toString(8)}); ` +
      'run chmod 600 on it'
    );
  }
}

function writeFileAtomically(target, content) {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, target);
  chmodSync(target, 0o600);
}

function formatEnvValue(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  return value;
}
