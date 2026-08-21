# content-os — The Creator Workflow

> The software view lives in [architecture.md](architecture.md). This document
> describes the exact same system from the creator's perspective: what a normal
> week looks like, where you intervene, and how the loop feeds itself.

**The operating model: batch production.** You do not make one video at a time.
You produce in batches: 20 scripts approved → one recording session → upload
everything → automation fans out into platform assets, schedules, publishing,
engagement handling, and analytics. You intervene at exactly five points.

## The five times you touch the system

| # | When | What you do | Time |
|---|---|---|---|
| 1 | Monday | Pick and approve ideas | 30 min |
| 2 | Tuesday | Approve scripts | 45 min |
| 3 | Wednesday | **Shoot the batch** | 2–4 hours |
| 4 | Thursday | Approve finished assets | 30–60 min |
| 5 | Sunday | Escalations + accept insights | 30 min |

Everything else — research, script drafting, editing, captions, platform
versions, scheduling, publishing, comment triage, metrics collection, pattern
analysis — is automated.

## The week, day by day

### Monday — Strategy & Ideas

1. **Review last week's numbers** (30 min). The Analytics Engine has already
   collected metrics and proposed insights. You accept or reject them.
   Accepted insights are promoted to **playbook rules** — the knowledge the
   Content Engine will use this week.
2. **Clear the comment inbox.** The Engagement Engine has classified everything.
   You handle only the escalations (money, reputation, angry customers).
   Comments classified as ideas were already turned into content items.
3. **Pick the batch.** The Content Engine proposes 25–30 candidate ideas
   (from trends, comments, competitors, past successes), scored 0–100 using
   the playbook. You pick 20 and approve each (idea gate). Rejected ideas are
   archived with a reason — that reason is data for the engine.

### Tuesday — Research & Scripts

1. The Content Engine researches the 20 approved ideas (facts, sources, claims
   to verify) and drafts 20 scripts with hooks, talking points, CTAs, and shot
   instructions.
2. **You review all 20 scripts** (45 min). Each one needs your approval
   (script gate). Rejected scripts go back for revision — you write a note,
   the engine revises, you re-review. **Nothing gets shot without an approved
   script.** This is the gate that protects your Wednesday.

### Wednesday — Shoot Day (the only non-negotiable manual step)

1. You create a **recording session** for the week's batch and assign the 20
   approved items to it.
2. You shoot. One take per script, or a long-form session you'll split later —
   the system supports both: one recording can feed many items.
3. You upload the footage to the session and mark it uploaded. **Your manual
   work for the week is done.**

### Thursday — Production

1. The Production Engine picks up the session and processes it as a batch:
   transcribes, cuts dead space, edits, captions, adds visuals, and produces
   platform-specific assets (TikTok cut, Reel cut, Short, LinkedIn version)
   for every item.
2. **You review the finished assets** (30–60 min). Approve or send back for
   rework. Approved items become schedulable.

### Friday — Scheduling

1. The Distribution Engine reads the content calendar, picks the best slots
   per platform (from the cadence in settings), and writes platform-adapted
   posts: captions, hashtags, titles, thumbnails, CTAs.
2. You glance at the week's publishing plan and confirm. (Optional — you can
   also let it run.)

### Saturday — Publishing

1. Automation publishes on schedule. YouTube and LinkedIn via official APIs;
   TikTok and Instagram via whatever integration is available.
2. The Engagement Engine monitors comments, DMs, and mentions in real time:
   classifies, auto-replies to simple/FAQ items, opens conversations for
   leads, saves ideas, and escalates only what needs you.

### Sunday — Engagement & Review

1. You handle the week's escalations and reply to leads that are warming up.
2. Weekly review: what worked, what didn't. The Analytics Engine has already
   correlated metrics against hooks, pillars, lengths, CTAs, and platforms.
   You accept the insights that hold up — they become playbook rules for next
   Monday. The loop is closed.

## The batch pipeline (the core pattern)

```
20 approved scripts
   → 1 recording session
   → N recordings (raw footage files)
   → M content items (one recording can split into several items)
   → P platform assets per item (tiktok, reel, short, linkedin)
   → Q posts per item (one per platform)
   → metrics per post
   → insights → playbook rules → next week's ideas
```

## Fast paths (when the week breaks)

- **Breaking news** — an idea can be fast-tracked: idea → scripted in hours,
  skipping research/planning. The system records exactly what was skipped and
  why, and the script still needs your approval before you shoot.
- **Comment-driven content** — a comment like "compare this with Claude" is
  classified as an idea and enters next week's batch automatically. You just
  approve it on Monday.
- **Follow-ups** — a video that performs well can spawn follow-ups that reuse
  its research and assets. The link is recorded (follow_up, reuse_research,
  reuse_asset) so the system knows the family tree.

## What the system knows about you (settings)

- Brand name, tone rules, topics of authority, topics to avoid
- Posting cadence per platform (e.g., TikTok 5×/week, YouTube 2×/week)
- Preferred shoot days and publish windows

## The loop, in one sentence

**You approve ideas and scripts, shoot, approve the finished videos, and make
the judgment calls — the system does everything else, and every week it gets
smarter because the analytics from last week are the playbook for this week.**