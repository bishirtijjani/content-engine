// Seed the script-writing framework — your brand taste, written down.
// Any AI agent reads settings.script_framework before writing a script.
// Edit this file and re-run to update: node scripts/seed-script-framework.mjs
import { connect } from '@content-os/core';

const FRAMEWORK = {
  version: 7,
  purpose:
    "How any AI agent writes scripts for your brand. Read this before writing a single word. " +
    "The engine finalizes; YOU (the agent) write the content. This guide is the brand's taste, written down.",

  quality_bar: {
    doctrine: [
      "The viewer must leave genuinely better off. That is the product - everything else is delivery.",
      "Teach, don't pitch. The value lives in the content itself, not in the packaging.",
      "Generosity is the hook. Give away something usable; follows come from trust, not teasing.",
      "Save test: would a viewer save this WITHOUT being asked to? If not, the content is not finished.",
      "Reshare test: would a viewer send this to a friend who needs it? The value must survive out of context."
    ],
    rhythm: [
      "Natural spoken rhythm - the way a person explains something clearly, one thought per line (a beat, not a fragment).",
      "Full spoken sentences with connectors - 'so', 'and', 'then', 'which', 'because'. Clipped fragments without conjunctions read as ad copy, not speech.",
      "Every line load-bearing: if deleting it loses nothing, delete it.",
      "BANNED: engineered mic-drop lines and ad-copy staccato. A punchline is not value.",
      "BANNED: compressed summary scripts. Write the full transcription of what would actually be said, start to finish.",
      "Hook speed: the turn - what this video is - must arrive within the first ~5 seconds. Stakes come after the promise, not before it."
    ],
    teaching_standard: [
      "Teaching = the viewer can DO something new afterward. Describing = narrating what a system does. Test every line: if the viewer could still ask 'how?' or 'why?', it is describing, not teaching.",
      "Every script states ONE transferable principle as a rule. Example: 'Never let the model decide whether its own output is correct.'",
      "Every script walks ONE worked example with concrete numbers. Example: AI extracts total = 485,000; code computes the line-item sum = 472,000; system flags the document; human reviews it.",
      "Assertions must become distinctions. Never 'skip X' - explain what X answers versus what the better option answers: OCR answers 'what text is on this page?'; document AI answers 'what does this field mean?'; validation answers 'can I trust this answer?'.",
      "No generic advice. Replace 'start small and measure' with the exact metrics to track: extraction accuracy, validation failure rate, duplicate detection rate, percentage requiring human review.",
      "The hook promise must equal the delivery. Promise 'here is how it works' only when the body delivers rules plus examples - never a narrated diagram.",
      "Core architecture principle where relevant: automate the work BEFORE the decision - AI extracts, deterministic code validates, systems receive only validated data, humans see only exceptions.",
      "Teach to the audience's hands: if the viewer cannot personally do or decide what a line suggests, re-level it. Owners buy, judge, and ask questions; builders write code. Match their verbs - 'ask the vendor', 'check the numbers', never 'write a validator'."
    ]
  },

  schema: {
    storage: "JSON in content_items.script",
    fields: {
      hook: "One line. The first 1-3 seconds, spoken verbatim. No greeting, no setup.",
      script: "The full spoken script. Plain text, one paragraph per beat, blank line between beats. Spoken words ONLY - no stage directions, no labels.",
      points: "Array of { title, detail }. The skeleton. detail holds facts and context to riff on while recording.",
      cta: "Exactly ONE call to action.",
      shot_notes: "Timestamped shooting instructions: what is on screen in each beat."
    }
  },

  voice: {
    source_of_truth: "settings.brand (read it every time)",
    rules: [
      "Show real builds, not theory. Every script contains something the viewer can DO or COPY.",
      "Direct and technical. A founder-engineer talking to business owners - not a presenter talking to a conference.",
      "Entertaining but operational: a little personality is good; a lesson they can apply is mandatory.",
      "Never lecture. Explain like you are telling a friend who runs a business.",
      "Specificity test: if a competitor channel could say your script word-for-word, it is not specific enough. Rewrite with real numbers, tools, results."
    ]
  },

  language: {
    rules: [
      "Write for the mouth, not the eye. Short sentences. One idea per sentence.",
      "Use contractions: you're, it's, don't, here's.",
      "Connect with 'but' and 'so' - they pull the viewer forward. Never 'additionally', 'furthermore', 'moreover'.",
      "Concrete over abstract: numbers, tool names, hours saved, dollars spent. Measurements are strong; adjectives are weak.",
      "No corporate speak: never 'leverage', 'synergy', 'utilize' (say 'use'), 'solutions' (name the thing).",
      "No emojis, no hashtags, no greetings ('hey guys'), no sign-offs inside the script.",
      "Read-aloud test: if you would stumble saying it out loud, rewrite it shorter."
    ]
  },

  hooks: {
    universal: [
      "The first 3 seconds decide whether the video exists. Spend real effort here.",
      "Lead with the stake or the outcome - never with context or an introduction.",
      "Be specific: '8 hours a week' beats 'so much time'; '$4,000/month' beats 'a lot of money'.",
      "Open a loop you will close at the end of the video.",
      "Banned openers: 'today we talk about', 'in this video', 'let me tell you why'."
    ],
    styles: {
      story: {
        pattern: "Start mid-action or at the stakes. Problem and result in one breath.",
        good: "My client was spending 8 hours a week on invoices. Now it takes zero.",
        bad: "Let me tell you about the time I learned something about invoice automation."
      },
      question: {
        pattern: "A question the viewer is ALREADY asking themselves, with stakes attached. Not trivia.",
        good: "What would you do with 8 extra hours a week?",
        bad: "Do you know what invoice automation is?"
      },
      stat: {
        pattern: "The number IS the hook. Say it fast, then make it personal immediately.",
        good: "This automation saves 400 hours a year. Here is the whole build.",
        bad: "There are many interesting statistics about automation."
      },
      contrarian: {
        pattern: "Name the common belief, then break it. Defensible with evidence - strong opinion, never rage bait.",
        good: "Your CRM is just a spreadsheet with extra steps - until you set it up like this.",
        bad: "Everything you know about CRMs is wrong."
      },
      problem_statement: {
        pattern: "Describe the pain in the audience's own words. They should think 'that is exactly me'.",
        good: "You are copy-pasting between five tabs to run your business. That ends today.",
        bad: "Many businesses face efficiency challenges."
      }
    }
  },

  structure: {
    short_form: {
      applies_to: "tiktok, instagram reels, youtube shorts - 15-90s",
      note: "Value-first arc: get to the useful thing fast. Stakes serve the lesson, not the tease.",
      beats: [
        { window: "0-3s", job: "HOOK - challenge an assumption or name the stake. Verbatim from the hook field." },
        { window: "3-10s", job: "FRAME - one sentence setting up what the viewer will walk away with." },
        { window: "10-50s", job: "SUBSTANCE - the actual teaching: model, steps, test, build. Over two-thirds of the video. The usable thing is delivered here." },
        { window: "50-57s", job: "TAKEAWAY - compress the value into one repeatable line or action." },
        { window: "last 3s", job: "CTA - light, tied to the value just delivered. Never bait." }
      ]
    },
    long_form: {
      applies_to: "youtube 5-15min",
      beats: [
        { window: "0-20s", job: "COLD OPEN - the best moment of the video, up front. Then the promise." },
        { window: "20-40s", job: "ROADMAP - what the viewer will get. Three beats max." },
        { window: "middle", job: "SECTIONS - each delivers one promised beat. Re-hook between sections with a mini-payoff." },
        { window: "final minute", job: "PAYOFF + next step - close all loops, one CTA." }
      ],
      note: "Long-form spoken words run below raw math because of screen demos and b-roll pauses. Target ~2 spoken words/second."
    },
    retention: [
      "Every sentence must earn the next one. Cut anything that adds neither information nor energy.",
      "Numbers are retention gold: hours, dollars, percentages, counts. Use them constantly.",
      "Deliver payoffs progressively - never save everything for the end.",
      "If a sentence could be deleted and nothing is lost, delete it."
    ]
  },

  length_math: {
    spoken_words_per_second: 2.5,
    tolerance: "+/-20%",
    reference: {
      "15s": "35-45 words",
      "30s": "70-90 words",
      "60s": "145-175 words",
      "90s": "215-265 words"
    },
    rule: "The script field holds SPOKEN WORDS ONLY. Match desired_length_seconds within tolerance. No length planned? Default to 60s.",
    selection_rule: "Content depth determines length; length does not determine content depth. Tiers: simple opinion 30-45s, one useful concept 45-75s, practical teaching 60-120s, deep technical breakdown 90-180+s. The exact duration emerges from how much information the promised value requires to be complete - never pad to fill a target, never compress below it."
  },

  platform_fit: {
    tiktok:     { length: "15-60s",  energy: "high",         notes: "Front-load everything. Assume they leave in 3 seconds. Text overlay on key numbers." },
    instagram:  { length: "15-60s",  energy: "high",         notes: "Same cut as TikTok works. Visual before/after moments perform." },
    youtube:    { length: "5-15min", energy: "measured",     notes: "Cold open, roadmap, deep sections with screen demos. Depth is the value." },
    linkedin:   { length: "30-90s",  energy: "professional", notes: "Business framing, case-study tone. Outcomes over personality." },
    x:          { length: "n/a",     energy: "n/a",          notes: "Threads adapt from the points array; full scripts rare." }
  },

  cta_rules: [
    "Exactly ONE cta per script.",
    "Match the cta to the goal: follow = growth, comment = reach, save = tutorials/value, link = conversion.",
    "Tie it to the promise: 'Follow for more builds like this' - never a generic goodbye."
  ],

  shot_notes_rules: [
    "Timestamped beats matching the script structure (0-5s, 5-20s, ...).",
    "Say what is on screen each beat: talking head, screen share, b-roll, text overlay.",
    "Mark text overlays for key numbers.",
    "Keep it shootable in one session: one camera + screen recording."
  ],

  checklist: [
    "Hook works alone in the first 3 seconds - no greeting, no context needed.",
    "Script word count within +/-20% of desired_length_seconds (default 60s).",
    "Every point has at least one concrete detail: number, tool name, step, or result.",
    "The loop opened in the hook closes by the end.",
    "Exactly one CTA, tied to the promise.",
    "Reads aloud smoothly - short sentences, contractions, no stumbles.",
    "shot_notes present with timestamps.",
    "Zero placeholder text anywhere.",
    "Every claim in the script traces back to research_notes.",
    "Specificity test passed: a competitor could NOT say this exact script.",
    "Save test: a viewer would save this without being asked.",
    "Every line load-bearing - no engineered punchlines standing in for substance.",
    "The viewer could act on this tomorrow using only what the video taught.",
    "Every step-line answers how or why - none merely narrate what happens.",
    "One principle stated as a rule, plus one worked example with concrete numbers.",
    "Zero generic advice - every recommendation names exact metrics or actions.",
    "Hook promise matches what the body actually delivers.",
    "Duration emerged from required information - zero lines exist to fill time.",
    "Say-it-to-a-person test: every line sounds like something you would actually say aloud to one person - no colons introducing lists, no documentation phrases like 'receives validated data', max one idea per breath."
  ],

  exemplars: {
    primary: {
      comment:
        "THE BAR. Written and approved by Bishir himself. Re-read script_text before EVERY draft. " +
        "Match this generosity, rhythm, and usefulness - not necessarily this topic format.",
      source: "Bishir, ratified as the quality standard",
      title: "The three levels of business automation + the 30-second test",
      why: [
        "The content itself is the product: a mental model plus a test the viewer can run today.",
        "Save-worthy with no gimmicks - the value would survive even without the worksheet CTA.",
        "Rhythm is natural explanation: one thought per line, parallel structures carry the flow.",
        "Hook challenges an assumption the viewer holds about themselves."
      ],
      script_text: [
        "You probably think your business is automated. Here's how to find out in 30 seconds.",
        "There are three levels of business automation, and most businesses that think they're at Level 3 are actually stuck at Level 2.",
        "Level 1 is manual.",
        "A person has to start the process, do the work, and make sure it gets finished.",
        "If that person disappears for a week, the process stops.",
        "Level 2 is semi-automated.",
        "This is where most businesses get stuck.",
        "You've got software sending emails, moving data, taking payments, maybe even using AI.",
        "But someone still has to keep the process moving.",
        "For example: a lead fills out your form, your CRM captures them, and an automated email goes out.",
        "Sounds automated, right?",
        "But then someone still has to remember to follow up, qualify the lead, book the appointment, and update the CRM.",
        "That's Level 2.",
        "The system is doing the busy work, but a human is still closing the loop.",
        "And buying more software doesn't automatically get you to Level 3.",
        "Level 3 is autonomous.",
        "The process starts automatically, runs from beginning to end, and a human only steps in when there's an exception or an actual decision to make.",
        "So here's the 30-second test.",
        "Take any recurring process in your business and ask yourself three questions:",
        "One: Does it start without someone remembering to do it?",
        "Two: Does it finish without someone manually pushing it forward?",
        "Three: Does a human only intervene when there's an exception?",
        "Zero or one yes? You're at Level 1.",
        "Two yeses? You're at Level 2.",
        "Three yeses? You're at Level 3.",
        "Save this and run the test on every recurring process in your business.",
        "And comment \"LEVEL\" if you want the full worksheet I use to find your automation gaps."
      ].join("\n\n")
    },
    secondary: {
      comment: "Genre reference for case-study/build scripts. Match this level of specificity.",
      item: {
      title: "How I automated a client's entire invoice process - from 8 hours/week to 0",
      hook_style: "story",
      format: "talking_head",
      desired_length_seconds: 60
    },
    script: {
      hook: "My client was spending 8 hours a week on invoices. Now it takes zero. Here is exactly what I built.",
      script: "Every Monday, she downloaded invoices from three different tools, checked them against bank statements, and emailed each client manually. Eight hours. Every single week. And one missed invoice meant a late payment.\n\nSo I built a pipeline: invoices land in one inbox, an AI agent reads them, matches them to the client records, flags anything that does not line up, and sends the payment reminder - all before she opens her laptop.\n\nResult: 8 hours a week down to zero. No missed invoices in six months. And she did not hire anyone - the system does the work.",
      points: [
        { title: "The 8-hour problem", detail: "Three disconnected tools, manual reconciliation, manual follow-up. One missed invoice = one late payment." },
        { title: "The automation", detail: "Single inbox -> AI reads and extracts -> matches client records -> flags anomalies -> sends reminders automatically." },
        { title: "The result", detail: "8h/week -> 0. Zero missed invoices in 6 months. No new hires." }
      ],
      cta: "Follow for more automation builds - I show real systems, not theory.",
      shot_notes: "Format: talking head + screen share (60s).\n0-5s: Hook on camera, direct eye contact.\n5-20s: Screen share - the messy 'before' (three tabs, manual copy-paste).\n20-40s: Screen share - walk the pipeline: inbox -> extraction -> match -> reminder sent.\n40-55s: Back on camera for the result.\n55-60s: CTA on camera. End frame: '8h -> 0h' text overlay."
      }
    }
  }
};

const db = connect();
const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get('script_framework');
if (existing) {
  db.prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?")
    .run(JSON.stringify(FRAMEWORK), 'script_framework');
  console.log('script_framework updated');
} else {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    .run('script_framework', JSON.stringify(FRAMEWORK));
  console.log('script_framework created');
}

const row = db.prepare('SELECT LENGTH(value) AS size FROM settings WHERE key = ?').get('script_framework');
console.log(`size: ${row.size} bytes`);
db.close();