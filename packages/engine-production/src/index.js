// Production Engine — "How do we turn our recording into finished content?"
//
// Pipeline: Raw footage -> process -> edit -> captions -> visuals -> platform versions
// Output:   FINISHED ASSETS (content item in status `editing`, assets in `review`)
//
// Owned states: shot, editing
//
// When implemented, each action below will:
//   processFootage   — identify clips/takes, detect mistakes and silence,
//                      select best takes, assemble the video
//   edit             — cut dead space, remove mistakes, add cuts/zooms/
//                      transitions, insert b-roll and screen recordings,
//                      clean audio, normalize volume
//   captions         — transcribe, generate subtitles, animate captions,
//                      emphasize key words
//   package          — branding, intro/outro, on-screen text, graphics,
//                      thumbnails, progress indicators
//   platformVersions — derive TikTok / Instagram Reel / YouTube Short /
//                      LinkedIn cuts from the original (one asset per platform)
//
// After editing, the engine requests the `asset_review` gate; the human
// watches the finished video and approves or sends it back for rework.
import { BaseEngine } from '@content-os/core';

export class ProductionEngine extends BaseEngine {
  static NAME = 'production';
  static OWNED_STATES = ['shot', 'editing'];
  static ACTIONS = ['process_footage', 'edit', 'captions', 'package', 'platform_versions'];

  processFootage(options = {}) {
    throw new Error('production.process_footage — footage processing not wired yet');
  }

  edit(options = {}) {
    throw new Error('production.edit — editing not wired yet');
  }

  captions(options = {}) {
    throw new Error('production.captions — captions not wired yet');
  }

  package(options = {}) {
    throw new Error('production.package — visual packaging not wired yet');
  }

  platformVersions(options = {}) {
    throw new Error('production.platform_versions — platform cuts not wired yet');
  }
}