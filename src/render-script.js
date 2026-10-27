// Script Renderer — turns script data into a presentable Markdown document.
//
// Like HyperFrames renders video from HTML, this renders scripts from data.
// The output is a Markdown document. The script IS the deliverable; the UI
// (ui/) is where it is viewed and edited.

// ============================================================================
// MARKDOWN GENERATION
// ============================================================================

/**
 * Generate a presentable Markdown script from structured data.
 * @param {Object|string} data - { hook, script, points, cta, shot_notes, duration_hint }
 *   or a JSON string of the same, or plain text (rendered as-is)
 * @param {Object} item - content_items row (title, pillar, format, etc.)
 * @returns {string} formatted Markdown
 */
export function generateMarkdown(data, item = {}) {
  // Accept structured JSON stored in the DB (the agent writes JSON to
  // content_items.script). Fall back to plain text for raw scripts.
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed;
      } else {
        return generateMarkdownFromText(data, item);
      }
    } catch {
      return generateMarkdownFromText(data, item);
    }
  }
  if (!data || typeof data !== 'object') {
    return generateMarkdownFromText(String(data ?? ''), item);
  }

  const lines = [];

  // Title
  lines.push(`# ${item.title || 'Untitled Script'}`);
  lines.push('');

  // Metadata bar
  const meta = [];
  if (item.pillar) meta.push(`**Pillar:** ${item.pillar}`);
  if (item.format) meta.push(`**Format:** ${item.format}`);
  if (item.hook_style) meta.push(`**Hook style:** ${item.hook_style}`);
  if (item.desired_length_seconds) meta.push(`**Length:** ${item.desired_length_seconds}s`);
  if (item.target_audience) meta.push(`**Audience:** ${item.target_audience}`);
  if (meta.length) {
    lines.push(meta.join(' &nbsp;|&nbsp; '));
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Hook — the most important part
  if (data.hook) {
    lines.push('## Hook');
    lines.push('');
    lines.push(`> ${data.hook}`);
    lines.push('');
  }

  // Full script
  if (data.script) {
    lines.push('## Script');
    lines.push('');
    lines.push(data.script);
    lines.push('');
  }

  // Talking points
  if (data.points?.length) {
    lines.push('## Talking Points');
    lines.push('');
    for (let i = 0; i < data.points.length; i++) {
      const p = data.points[i];
      lines.push(`### ${i + 1}. ${p.title}`);
      lines.push('');
      lines.push(p.detail);
      lines.push('');
    }
  }

  // CTA
  if (data.cta) {
    lines.push('## Call to Action');
    lines.push('');
    lines.push(`**${data.cta}**`);
    lines.push('');
  }

  // Shot notes
  if (data.shot_notes) {
    lines.push('---');
    lines.push('');
    lines.push('## Shot Notes');
    lines.push('');
    lines.push(data.shot_notes);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate Markdown from a raw script string.
 */
export function generateMarkdownFromText(text, item = {}) {
  const lines = [];
  lines.push(`# ${item.title || 'Untitled Script'}`);
  lines.push('');
  if (item.pillar || item.format) {
    const meta = [];
    if (item.pillar) meta.push(`**Pillar:** ${item.pillar}`);
    if (item.format) meta.push(`**Format:** ${item.format}`);
    lines.push(meta.join(' &nbsp;|&nbsp; '));
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(text);
  lines.push('');
  return lines.join('\n');
}
