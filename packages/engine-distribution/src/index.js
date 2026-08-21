// Distribution Engine — "Where, when and how should this be published?"
//
// Pipeline: Adapt -> Schedule -> Publish -> Cross-post
// Output:   PUBLISHED POSTS (content item in status `published`)
//
// Owned states: scheduled
//
// When implemented, each action below will:
//   adapt      — per-platform caption, title, description, hashtags, keywords,
//                cover/thumbnail, CTA, format (writes one `posts` row per platform)
//   schedule   — pick the best slot per platform from the cadence in settings
//                (sets posts.scheduled_at)
//   publish    — actually publish via each platform's API; record external_id,
//                url, and failures (posts.status -> published | failed)
//   crossPost  — fan one piece of content out across platforms with
//                platform-specific adaptations
//
// Note: YouTube and LinkedIn have clean official APIs; TikTok and Instagram
// are restricted — that will shape how `publish` is implemented per platform.
import { BaseEngine } from '@content-os/core';

export class DistributionEngine extends BaseEngine {
  static NAME = 'distribution';
  static OWNED_STATES = ['scheduled'];
  static ACTIONS = ['adapt', 'schedule', 'publish', 'cross_post'];

  adapt(options = {}) {
    throw new Error('distribution.adapt — platform adaptation not wired yet');
  }

  schedule(options = {}) {
    throw new Error('distribution.schedule — scheduling not wired yet');
  }

  publish(options = {}) {
    throw new Error('distribution.publish — publishing not wired yet');
  }

  crossPost(options = {}) {
    throw new Error('distribution.cross_post — cross-posting not wired yet');
  }
}