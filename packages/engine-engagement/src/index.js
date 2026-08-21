// Engagement Engine — "What happens after people interact with our content?"
//
// Pipeline: Monitor -> Classify -> Act (reply / ignore / save idea / escalate)
// Output:   RESOLVED ENGAGEMENT + LEADS + NEW IDEAS fed back into the DB
//
// This engine does not own content_item states; it works on `engagement_items`
// and `conversations`, and writes back into the loop:
//   - "how much does this cost?"      -> lead (start a conversation)
//   - "can you make a video about X?" -> content idea (new content_item)
//   - "this doesn't work because..."  -> technical discussion
//   - "fire emojis"                   -> simple engagement (auto-reply or ignore)
//   - abuse / angry customers         -> escalation gate (human decides)
//
// When implemented, each action below will:
//   monitor   — pull comments, DMs, mentions from all platforms
//   classify  — label each item (lead | idea | technical | simple | negative |
//               spam) with a confidence score
//   reply     — auto-reply from templates for simple/FAQ items
//   escalate  — request an `escalation` gate for money/reputation items
//   saveIdea  — turn idea-classified items into new content_items
import { BaseEngine } from '@content-os/core';

export class EngagementEngine extends BaseEngine {
  static NAME = 'engagement';
  static OWNED_STATES = [];
  static ACTIONS = ['monitor', 'classify', 'reply', 'escalate', 'save_idea'];

  /** Survey unhandled engagement items instead of content states. */
  run({ targetId = null, options = {} } = {}) {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS n FROM engagement_items WHERE status = 'new'"
    ).get();
    this.log('survey', {
      message: `found ${row.n} unhandled engagement item(s) (automation not yet implemented)`,
    });
    return { unhandled_engagement: row.n };
  }

  monitor(options = {}) {
    throw new Error('engagement.monitor — monitoring not wired yet');
  }

  classify(options = {}) {
    throw new Error('engagement.classify — classification not wired yet');
  }

  reply(options = {}) {
    throw new Error('engagement.reply — auto-reply not wired yet');
  }

  escalate(options = {}) {
    throw new Error('engagement.escalate — escalation not wired yet');
  }

  saveIdea(options = {}) {
    throw new Error('engagement.save_idea — idea capture not wired yet');
  }
}