---
name: script-writing
description: Operating loop for content-os — generate fresh ideas, drive them through the engine to finished, ready-to-shoot scripts with human gate approvals. Use when asked to create content, generate video ideas, write scripts, or run a content cycle in the content-os workspace.
---

# Content-os operating loop

You are the brain. The engine (`@content-os/engine-content`) is the muscle.
The engine NEVER writes content — you do. The engine moves state, enforces
gates, validates structure, and keeps the audit trail.

## Before anything: load context

Read these settings from `data/content.db` (table `settings`, JSON in `value`):

- `brand` — voice, tone, positioning
- `pillars` + `pillar_details` — the 5 content pillars and their example topics
- `target_audience` — who this is for and their pain points
- `hooks_preferred` — hook style priority order
- `script_framework` — HOW to write scripts (quality bar, hooks, structure, length math, checklist)
- `idea_framework` — HOW to generate ideas worth recording

## Starting a cycle

Any natural request starts the loop — "get me ideas", "let's get new scripts",
"run a content cycle", or similar. Do not require exact phrases. Map the
request to the same procedure below.

## Presentation rules (mandatory)

- After `evaluate()`, ALWAYS present the ranked idea list in chat as a table:
  ID, score, title, pillar/hook style, and the score reason. Never make the
  human ask for details or a better format.
- After rendering a script, always share the URL and summarize what changed
  if it is a revision.
- Research notes need NO separate human approval — the script_review gate
  covers the finished result.

## The loop

### 1. Generate fresh ideas

Ideas are generated FRESH every cycle. Never recycle old ones. Follow
`idea_framework.cycle_procedure`: read brand context, query existing items,
generate 5–7 candidates across ≥3 pillars, apply the recording-worthiness tests, then:

```js
import { connect } from '@content-os/core';
import { ContentEngine } from '@content-os/engine-content';
const engine = new ContentEngine(connect());
engine.addIdeas([{ title, source, pillar, hook_style, priority, tags }, ...]);
engine.evaluate(); // scores + idea_approval gates created automatically
```

Report the ranked list (title, score, reason) to the human and STOP.
Do not proceed past an idea_approval gate without a human decision.

### 2. After idea approval → plan

Human approves gates directly or asks you to record their decision.
Then run `engine.plan()` — fills pillar/format/hook/length/angle/CTA.

### 3. Research (you write, engine finalizes)

Write real research into `content_items.research_notes` (facts, sources,
claims to verify). Minimum ~100 chars of substance; template junk is rejected.
Then `engine.research()`.

### 4. Write the script (you write, engine finalizes)

Before drafting: read `script_framework.quality_bar` in full (doctrine,
rhythm, teaching_standard) AND re-read
`script_framework.exemplars.primary.script_text` — Bishir's own approved
standard. Draft to that bar, not to "passes the validator". Then treat every
rejection note as calibration: fold the correction into how you write all
future drafts, not just this one.

Pick `desired_length_seconds` BEFORE drafting per
`length_math.selection_rule` — never squeeze a teaching piece into 60s;
raise the target instead.

Before calling `engine.script()`, state in chat:
1. **Viewer takeaway** — what they learn about THEIR business
2. **The principle-as-rule** taught, and the worked example included
3. **Complete without the CTA?** — must be yes
If any answer is blank or vague, the draft is not done. Do not submit.

Write structured JSON into `content_items.script`:

```json
{ "hook": "...", "script": "spoken words only", "points": [{"title": "...", "detail": "..."}], "cta": "...", "shot_notes": "..." }
```

Rules (enforced by the engine's validator — it will REJECT violations):

- `script` field = spoken words only, within ±20% of
  `desired_length_seconds × spoken_words_per_second` (default 60s @ 2.5 w/s → 120–180 words)
- all fields non-empty, ≥1 titled point
- no placeholders/TBDs/template text
- follow `script_framework` for hook style, structure beats, voice, platform fit
- run the framework's own 10-point checklist on yourself BEFORE saving

Then `engine.script()` — moves to `scripted` + requests `script_review`.

If the log says `script rejected by structural check — <reason>`, fix exactly
that and re-run. Do not weaken the script to pass; fix the substance.

### 5. Review in the UI

Open the item in the control center UI (`ui/`). The UI renders the hook, spoken
lines, points, CTA and shot notes, and edits save straight back to the DB.
Show it to the human for the `script_review` decision. If rejected: edit the
script, then `engine.resubmit({ targetId })`.
If approved: `engine.ready()` → item lands in `ready_to_shoot`.

`ready()` also creates the item's folder `data/item-<id>/` and writes
`script.txt` there — the spoken lines, one per line, from the approved script
(hook, then script, then cta). That file is the spine of the clean. Tell the
human: **record by reading `data/item-<id>/script.txt`, then drop the camera
video and the separate audio recording into that same folder.**

## Windows / environment gotchas

- Inline `node -e "..."` breaks on PowerShell quote escaping. For any ad-hoc
  DB script, write a temp `.mjs` file INSIDE the workspace (temp dirs cannot
  resolve `@content-os/core`), run it, delete it.
- Always run node with `--disable-warning=ExperimentalWarning`.
- Tests: `npm test` (must stay green).

## Hard rules

- Never write placeholder content. Ever. Not even as scaffolding.
- Never approve your own gates. Gates are human decisions.
- Never bypass the engine by writing status columns directly — use actions.
- One idea cycle = fresh ideas only. Check `idea_framework.duplicate_check`.
