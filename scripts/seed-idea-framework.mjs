// Seed the idea-generation guide (settings.idea_framework).
// Same pattern as seed-script-framework.mjs: versioned JSON, idempotent,
// committed to git. Edit the FRAMEWORK object and re-run to update.
//
// The agent reads this guide BEFORE generating ideas each cycle, so what
// makes an idea worth recording is codified — not vibes.
import { connect } from '@content-os/core';

const FRAMEWORK = {
  version: 2,

  purpose:
    'How to generate content ideas worth recording. Read this before ' +
    'every idea cycle. Ideas are generated FRESH each run \u2014 never recycled from a bank.',

  // What separates a real idea from filler.
  recording_worthiness: {
    rule: 'An idea is worth recording only if it could make a business owner think "I need this for MY business" within the first 5 seconds of hearing the title.',
    tests: [
      'Mirror test: will the viewer learn something about THEIR business - a model, a test, a metric - rather than about ours? A build showcase must still carry a transferable principle, or drop the idea.',
      'Specific outcome: does the title name a concrete result (hours saved, tool replaced, money made)? "Automated invoice processing" passes; "AI is changing everything" fails.',
      'Showable: can it be demonstrated with a real build on screen? If it would be a talking-head essay with nothing to show, it is not for this channel.',
      'Believable from experience: could Bishir have actually built this? Never propose ideas that require fake claims.',
    ],
  },

  // Novelty vs search demand \u2014 the core tradeoff when picking topics.
  novelty_vs_demand: {
    explanation:
      'Search-driven topics (comparisons, pricing breakdowns, how-tos) are safer but crowded. ' +
      'Novel topics (custom builds, contrarian takes) stand out but must still map to a real pain point.',
    guidance: [
      'Aim for novel angles on in-demand problems, not novel problems nobody has.',
      'A custom build beats a hot take. A hot take backed by a real build beats both.',
      'If a topic was covered by big channels last week, find the angle they skipped \u2014 or skip it.',
    ],
  },

  // Every idea MUST map to one of the brand pillars.
  pillar_fit: {
    rule: 'Every idea must map to exactly one pillar from settings.pillars. No exceptions.',
    how: [
      'Read settings.pillars and settings.pillar_details first.',
      'Set the idea\u2019s pillar field to the matching pillar string \u2014 exact match, no paraphrasing.',
      'Use pillar_details.example_topics as inspiration springs, not as a list to copy verbatim.',
    ],
  },

  // Duplicate checking \u2014 titles AND themes.
  duplicate_check: {
    procedure: [
      'engine.addIdeas() dedupes exact titles automatically, but that is the MINIMUM.',
      'Before proposing, query existing items: SELECT title, status, pillar FROM content_items.',
      'Reject your own candidate if an existing item covers the same specific angle \u2014 same topic with a genuinely different angle (different audience, different stack, failure post-mortem vs success story) may pass.',
      'Published/failed items count too. "We tried X and it failed" is a valid NEW angle on a covered topic.',
    ],
  },

  // Effort estimation feeds scoring honestly.
  effort_estimation: {
    rule: 'Set priority honestly: high = timely or cornerstone topic, medium = solid regular content, low = nice-to-have.',
    guidance: [
      'Do not mark everything high \u2014 priority feeds the business-value score, and inflated priorities corrupt ranking.',
      'Timely topics (new tool release, trending pain point) decay fast: propose them while they are timely.',
    ],
  },

  // Title quality bar.
  title_rules: {
    must: [
      'Name the outcome or the stakes, not the category ("Stop paying for 5 SaaS tools" not "SaaS discussion").',
      'Stay under ~70 characters so it survives every platform.',
      'Work as a spoken hook seed \u2014 the script hook will be built from this.',
    ],
    avoid: [
      'Clickbait you cannot pay off in the video.',
      'Question marks stacked on question marks.',
      'Generic AI hype phrasing ("AI will change", "the future of").',
    ],
  },

  // How many ideas per cycle and how to register them.
  cycle_procedure: {
    steps: [
      '1. Read settings: brand, pillars, pillar_details, target_audience, hooks_preferred.',
      '2. Query existing items to know what is already covered.',
      '3. Generate 5-7 candidates across at least 3 different pillars.',
      '4. Apply recording_worthiness tests to each \u2014 drop failures before registering.',
      '5. Register survivors via engine.addIdeas([{ title, source, pillar, hook_style, priority, tags }]).',
      '6. Run engine.evaluate() \u2014 scores + idea_approval gates are created automatically.',
      '7. Report the ranked list to the human and wait for gate decisions.',
    ],
    batch_size: '5-7 ideas per cycle. Fewer starves the pipeline; more dilutes review attention.',
  },
};

// ---------------------------------------------------------------------------
const db = connect();

const existing = db.prepare("SELECT key FROM settings WHERE key = 'idea_framework'").get();
const value = JSON.stringify(FRAMEWORK);
if (existing) {
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, 'idea_framework');
  console.log(`idea_framework updated (${value.length} bytes)`);
} else {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('idea_framework', value);
  console.log(`idea_framework created (${value.length} bytes)`);
}

db.close();
