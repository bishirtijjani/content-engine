// Composition generator — transforms a content item's script JSON + shot_notes
// into a HyperFrames HTML composition.
//
// The engine never writes content. This module only structures agent-written
// content (hook, script, points, cta, shot_notes) into a HyperFrames HTML
// composition with data-* timing attributes.
//
// HyperFrames composition contract:
//   - Root element with data-composition-id, data-width, data-height, data-fps
//   - window.__timelines registration for the runtime
//   - Clips: elements with class="clip" and data-start/data-duration
//
// shot_notes format (plain text, timestamped beats):
//   0-5s: Hook on camera - problem AND promise in one breath.
//   5-15s: Old grind montage - camera + text overlay "read, type, check"
//   15-50s: Screen share of the automation running
//   50-57s: Result on camera - "8 hours down to 20 minutes"
//   last 3s: CTA on camera - "follow for the full build breakdown"

/**
 * Parse shot_notes into structured beat segments.
 * Each line: "start-end: description" or "last Ns: description"
 * @param {string} shotNotes
 * @param {number} totalDuration - fallback duration in seconds
 * @returns {Array<{start: number, end: number, description: string}>}
 */
export function parseShotNotes(shotNotes, totalDuration = 60) {
  if (!shotNotes || typeof shotNotes !== 'string') return [];

  const beats = [];
  const lines = shotNotes.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(\d+)-(\d+)s:\s*(.+)$/);
    if (match) {
      beats.push({
        start: Number(match[1]),
        end: Number(match[2]),
        description: match[3],
      });
      continue;
    }

    // Handle "last Ns:" format
    const lastMatch = line.match(/^last\s+(\d+)s:\s*(.+)$/);
    if (lastMatch) {
      const n = Number(lastMatch[1]);
      beats.push({
        start: totalDuration - n,
        end: totalDuration,
        description: lastMatch[2],
      });
      continue;
    }
  }

  return beats;
}

/**
 * Escape HTML special characters for safe embedding in HTML.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate a HyperFrames HTML composition from a content item's script.
 * @param {Object} script - Parsed script JSON: { hook, script, points, cta, shot_notes }
 * @param {Object} item - Content item row (for desired_length_seconds, title, etc.)
 * @returns {string} HTML composition string
 */
export function generateComposition(script, item) {
  const duration = item.desired_length_seconds ?? 60;
  const fps = 30;
  const compositionId = `item-${item.id}`;
  const width = 1080;
  const height = 1920;

  const hook = escapeHtml(script.hook ?? '');
  const narration = escapeHtml(script.script ?? '');
  const cta = escapeHtml(script.cta ?? '');
  const title = escapeHtml(item.title ?? '');

  // Parse shot_notes into beats
  const beats = parseShotNotes(script.shot_notes, duration);

  // Build beat segments for the composition
  const beatSegments = beats.length > 0 ? beats : [
    { start: 0, end: duration, description: 'Full video' },
  ];

  // Calculate durations for each segment
  const hookEnd = beatSegments[0]?.end ?? 5;
  const narrationStart = hookEnd;
  const narrationEnd = duration - 3;
  const ctaStart = duration - 3;
  const ctaEnd = duration;

  // Generate the composition HTML following the HyperFrames contract
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .scene {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 4rem;
    }
    .hook {
      font-size: 2.5rem;
      font-weight: 700;
      line-height: 1.2;
      max-width: 800px;
      margin-bottom: 2rem;
    }
    .narration {
      font-size: 1.5rem;
      line-height: 1.4;
      max-width: 800px;
      opacity: 0.9;
    }
    .cta {
      font-size: 1.8rem;
      font-weight: 600;
      margin-top: 2rem;
      padding: 1rem 2rem;
      background: rgba(255,255,255,0.1);
      border-radius: 8px;
    }
    .beat-label {
      position: absolute;
      top: 1rem;
      left: 1rem;
      font-size: 0.8rem;
      opacity: 0.5;
      background: rgba(0,0,0,0.5);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div id="${compositionId}"
       class="scene"
       data-composition-id="${compositionId}"
       data-width="${width}"
       data-height="${height}"
       data-fps="${fps}"
       data-duration="${duration}">
    <div class="beat-label" id="beat-label">Hook</div>
    <div class="hook clip" id="hook" data-start="0" data-duration="${hookEnd}">
      ${hook}
    </div>
    <div class="narration clip" id="narration" data-start="${narrationStart}" data-duration="${narrationEnd - narrationStart}">
      ${narration}
    </div>
    <div class="cta clip" id="cta" data-start="${ctaStart}" data-duration="${ctaEnd - ctaStart}">
      ${cta}
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["${compositionId}"] = {
      compositionId: "${compositionId}",
      duration: ${duration},
      fps: ${fps},
      width: ${width},
      height: ${height},
      tracks: [
        { id: "hook", clips: [{ start: 0, duration: ${hookEnd} }] },
        { id: "narration", clips: [{ start: ${narrationStart}, duration: ${narrationEnd - narrationStart} }] },
        { id: "cta", clips: [{ start: ${ctaStart}, duration: ${ctaEnd - ctaStart} }] }
      ]
    };
  </script>
</body>
</html>`;

  return html;
}

/**
 * Generate a HyperFrames composition for a single beat segment.
 * Used for multi-scene compositions where each beat is a separate scene.
 * @param {Object} beat - { start, end, description }
 * @param {Object} script - Full script object
 * @param {Object} item - Content item
 * @returns {string} HTML for the beat
 */
export function generateBeatComposition(beat, script, item) {
  const duration = beat.end - beat.start;
  const fps = 30;
  const compositionId = `item-${item.id}-beat-${beat.start}`;
  const width = 1080;
  const height = 1920;
  const title = escapeHtml(item.title ?? '');
  const description = escapeHtml(beat.description ?? '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ${description}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .scene {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 4rem;
    }
    .beat-label {
      position: absolute;
      top: 1rem;
      left: 1rem;
      font-size: 0.8rem;
      opacity: 0.5;
      background: rgba(0,0,0,0.5);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }
    .description {
      font-size: 1.5rem;
      line-height: 1.4;
      max-width: 800px;
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div id="${compositionId}"
       class="scene"
       data-composition-id="${compositionId}"
       data-width="${width}"
       data-height="${height}"
        data-fps="${fps}"
        data-duration="${duration}">
     <div class="beat-label">${description}</div>
    <div class="description clip" id="description" data-start="0" data-duration="${duration}">
      ${description}
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["${compositionId}"] = {
      compositionId: "${compositionId}",
      duration: ${duration},
      fps: ${fps},
      width: ${width},
      height: ${height},
      tracks: [
        { id: "description", clips: [{ start: 0, duration: ${duration} }] }
      ]
    };
  </script>
</body>
</html>`;
}
