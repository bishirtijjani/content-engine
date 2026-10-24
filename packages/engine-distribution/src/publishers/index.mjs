// Compose the real platform publishers used by DistributionEngine.
//
// Instagram uses the nginx media host; TikTok uses FILE_UPLOAD and therefore
// needs no public URL. Account names come from settings.distribution.accounts,
// so adapt/schedule and publishing always agree.
import { loadSettings, resolveAccounts } from '../accounts.mjs';
import {
  credentialsPath,
  defaultEnvFile,
  instagramAccounts,
  instagramApp,
  loadCredentials,
  mediaHostConfig,
  saveInstagramToken,
  saveTikTokToken,
  tikTokConfig,
} from '../credentials.mjs';
import { NginxMediaHost, S3MediaHost } from '../media-host.mjs';
import { InstagramConfigError } from './errors.mjs';
import { InstagramPublisher } from './instagram.mjs';
import { TikTokConfigError } from './tiktok-errors.mjs';
import { TikTokPublisher } from './tiktok.mjs';

/**
 * @param {object} opts
 * @param {object} [opts.db] - used to read settings when settings is omitted
 * @param {object} [opts.settings]
 * @param {object} [opts.credentials]
 * @param {string} [opts.credentialsPath]
 * @param {string} [opts.envFile]
 * @param {object} [opts.mediaHost] - injected media host (tests)
 * @param {object} [opts.extraPublishers] - { 'tiktok:main': publisher }
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.sleep]
 * @param {Function} [opts.clock]
 * @param {object} [opts.logger]
 */
export function createPublisherFromSettings({
  db = null,
  settings = null,
  credentials = null,
  credentialsPath: explicitPath = null,
  envFile = null,
  mediaHost = null,
  extraPublishers = {},
  fetchImpl = globalThis.fetch,
  sleep,
  clock,
  logger = null,
} = {}) {
  const resolvedSettings = settings ?? (db ? loadSettings(db) : {});
  const file = credentialsPath(explicitPath);
  const envPath = envFile ?? defaultEnvFile();
  const resolvedCredentials = credentials ?? loadCredentials({
    path: explicitPath,
    envFile: envPath,
  });

  const app = instagramApp(resolvedCredentials);
  const accounts = instagramAccounts(resolvedCredentials);
  const hostConfig = mediaHostConfig(resolvedCredentials);
  const tiktok = tikTokConfig(resolvedCredentials);

  const publishers = { ...extraPublishers };
  const missing = new Map();
  const mediaHosts = new Set();

  const configured = resolveAccounts(resolvedSettings);
  const instagramConfigured = configured.filter((account) => account.platform === 'instagram');
  const tiktokConfigured = configured.filter((account) => account.platform === 'tiktok');

  let sharedHost = mediaHost;
  if (!sharedHost && hostConfig) {
    try {
      sharedHost = hostConfig.provider === 'nginx'
        ? new NginxMediaHost({ config: hostConfig, clock })
        : new S3MediaHost({ config: hostConfig, fetchImpl, sleep, clock });
    } catch (err) {
      for (const account of instagramConfigured) {
        missing.set(`instagram:${account.account}`, err.message);
      }
    }
  }
  if (sharedHost) mediaHosts.add(sharedHost);

  const instagramBehavior = resolvedSettings.distribution?.instagram ?? {};
  const tiktokBehavior = resolvedSettings.distribution?.tiktok ?? {};

  for (const account of instagramConfigured) {
    const key = `instagram:${account.account}`;
    const creds = accounts[account.account];

    if (!creds) {
      missing.set(
        key,
        `no Instagram credentials for account '${account.account}' in ${envPath} or ${file}`
      );
      continue;
    }
    if (!creds.userId) {
      missing.set(key, `Instagram credentials for '${account.account}' have no userId`);
      continue;
    }
    if (!creds.accessToken) {
      missing.set(key, `Instagram credentials for '${account.account}' have no accessToken`);
      continue;
    }
    if (!sharedHost) {
      missing.set(
        key,
        'mediaHost credentials are missing; Instagram needs a public video URL'
      );
      continue;
    }

    const expectedType = account.type === 'creator' || account.account === 'creator'
      ? 'CREATOR'
      : null;

    publishers[key] = new InstagramPublisher({
      account: account.account,
      userId: creds.userId,
      accessToken: creds.accessToken,
      expiresAt: creds.expiresAt ?? null,
      appId: app.appId,
      appSecret: app.appSecret,
      apiVersion: instagramBehavior.apiVersion ?? app.apiVersion,
      expectedAccountType: expectedType,
      mediaHost: sharedHost,
      fetchImpl,
      sleep,
      clock,
      logger,
      ...pick(instagramBehavior, [
        'pollIntervalMs', 'maxPollMs', 'timeoutMs', 'maxAttempts',
        'shareToFeed', 'refreshWindowMs',
      ]),
      onTokenRefresh: async ({ accessToken, expiresAt }) => {
        saveInstagramToken(
          account.account,
          { accessToken, expiresAt, userId: creds.userId },
          { path: explicitPath, envFile: envPath }
        );
      },
    });
  }

  for (const account of tiktokConfigured) {
    const key = `tiktok:${account.account}`;
    const creds = tiktok.accounts[account.account];

    if (!creds) {
      missing.set(
        key,
        `no TikTok credentials for account '${account.account}' in ${envPath} or ${file}`
      );
      continue;
    }
    if (!creds.openId || !creds.accessToken || !creds.refreshToken) {
      missing.set(
        key,
        `TikTok credentials for '${account.account}' need openId, accessToken and refreshToken`
      );
      continue;
    }

    try {
      publishers[key] = new TikTokPublisher({
        account: account.account,
        slot: creds.slot,
        clientKey: creds.clientKey ?? tiktok.clientKey,
        clientSecret: creds.clientSecret ?? tiktok.clientSecret,
        openId: creds.openId,
        accessToken: creds.accessToken,
        refreshToken: creds.refreshToken,
        expiresAt: creds.expiresAt ?? null,
        refreshExpiresAt: creds.refreshExpiresAt ?? null,
        apiBase: tiktok.apiBase,
        mode: creds.mode ?? 'direct',
        privacyLevel: creds.privacyLevel ?? null,
        fetchImpl,
        sleep,
        clock,
        logger,
        ...pick(tiktokBehavior, ['pollIntervalMs', 'maxPollMs', 'timeoutMs', 'maxAttempts']),
        onTokenRefresh: async (tokenSet) => {
          saveTikTokToken(account.account, tokenSet, {
            slot: creds.slot,
            path: explicitPath,
            envFile: envPath,
          });
        },
      });
    } catch (err) {
      missing.set(key, err.message);
    }
  }

  return {
    publishers,

    health() {
      return {
        publishers: Object.keys(publishers),
        missing: Object.fromEntries(missing),
      };
    },

    async cleanup() {
      let removed = 0;
      for (const host of mediaHosts) {
        if (typeof host.cleanup === 'function') removed += await host.cleanup();
      }
      return removed;
    },

    async publish(args) {
      const key = `${args.platform}:${args.account}`;
      const publisher = publishers[key] ?? publishers[args.platform] ?? null;

      if (publisher) return publisher.publish(args);

      if (missing.has(key)) {
        const message = missing.get(key);
        throw args.platform === 'tiktok'
          ? new TikTokConfigError(message)
          : new InstagramConfigError(message);
      }
      if (args.platform === 'instagram' && !instagramConfigured.length) {
        throw new InstagramConfigError(
          'no Instagram account is configured; add one to settings.distribution.accounts'
        );
      }
      if (args.platform === 'tiktok' && !tiktokConfigured.length) {
        throw new TikTokConfigError(
          'no TikTok account is configured; add one to settings.distribution.accounts'
        );
      }

      const error = new Error(
        `no publisher configured for ${key}. Configure credentials or pass it in extraPublishers`
      );
      error.retryable = false;
      throw error;
    },
  };
}

function pick(object, keys) {
  const out = {};
  for (const key of keys) {
    if (object[key] !== undefined) out[key] = object[key];
  }
  return out;
}
