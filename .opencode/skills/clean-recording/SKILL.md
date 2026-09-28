---
name: clean-recording
description: Turn a raw recording into one clean video — sync the separate high-quality audio to the camera video, then cut it down to the script read once. Use when the user drops raw footage plus a separate audio recording in a folder and wants it cleaned, or says "clean this recording", "sync the audio", "cut the pauses", "remove my restarts".
---

# Clean a recording

You turn one raw recording into one clean video. The cleaner
(`packages/engine-production/tools/clean/`) does the mechanical work. It runs
BEFORE the production engine. Neither ever modifies the raw footage.

## The rule of this tool

The engine works. The agent decides. The engine is deterministic and cannot
judge meaning, so every judgement goes to the agent in **one file**
(`<name>.review.json`). The engine proposes; the agent answers; the engine obeys.
Never let the engine guess relevance, a misheard word, or whether two takes are
the same line.

## Input

One folder, `data/<name>/`, containing:

- **one video** — the camera file, with its own scratch audio (the anchor for sync)
- **one audio** — the separate high-quality recording
- **`script.txt`** — the script, one line per line-as-read (the spine)

When the item came from the content engine, `ready()` already made this folder
as `data/vid<id>/` and wrote `script.txt` from the approved script. Record by
reading that file, then drop the camera video and the audio into it.

## The loop

```bash
npm run clean -- data/vid1           # propose: cut list + read + review file
# read data/vid1/vid1.read.txt, edit data/vid1/vid1.review.json
npm run clean -- data/vid1           # re-run until the read is clean
npm run clean -- data/vid1 --apply   # render the cleaned video
```

`--realign` ignores the cached alignment. `--model small.en` uses a bigger
speech model.

## The gate (mandatory)

A plain run only proposes. It prints the cut list, the read, and any warnings,
and writes the review file. **Nothing is cut until `--apply`, and `--apply` only
after the human has read `<name>.read.txt` and approved.** Cuts are a human
decision, exactly like the engine's gates.

## With a script (the usual case)

The script is the spine. The cleaner aligns the spoken words to the script
lines, keeps the **last take of each line**, and cuts everything else. It reads
`script.txt`; without it, falls back to pauses + repeats.

The engine cannot judge these, so it hands them over in `<name>.review.json`:

- **lines** — every script line: `found` or `missing`, the words `heard`, and
  `decision`: `keep` or `skip`. A line the engine could not place carries the
  nearest words it heard as `candidate`. Edit `start`/`end` to trim a line's
  window.
- **words** — the engine heard one thing, the script says another: `heard`,
  `fix`, and `decision`: `fix` or `leave` (default `leave` — the engine never
  edits text on its own).
- **asides** — stretches between takes (earlier tries, self-talk, detours):
  `decision`: `keep` (relevant) or `drop` (default).
- **cuts** — time ranges you add by hand: a repeated take the engine missed, a
  stumble, a cut-off point. `{ "start", "end", "why" }`.

Decisions, trimmed windows, and hand cuts are preserved across re-runs.

## Before you approve

1. **Read `<name>.read.txt`.** The whole edit, one paragraph per kept line, in
   order. It matches the video: a trimmed pause joins the two words, so a phrase
   split by a pause still reads as one line.
2. **Clear every warning.** The run flags what the eye would catch:
   - `SILENCE` — a long pause left inside a take.
   - `REPEAT` — the same phrase said twice in one line (two takes slipped in).
   Settle them with a `cut` or a line `start`/`end` trim, re-run, and confirm
   the warnings are gone.
3. Then `--apply`.

## What it does, in order

1. **align** — offset and clock drift between the camera audio and the recording
   (`align.py`). Refuses to continue if the match is weak.
2. **place** — the recording on the video timeline (`place.py`).
3. **silence** — silent stretches measured from the audio (`silence.py`). Pauses
   come from measured audio, never from transcript gaps.
4. **words** — a word-timed transcript of the aligned audio (`transcribe.py`).
5. **cuts** — the script-led cut (`lib/script.mjs` + `lib/cut.mjs`).

## What it cuts

- **earlier tries** — for each line, the last take is kept; the first take and
  anything said up to it is dropped.
- **off-script stretches** — between takes, unless the agent marks them `keep`.
- **pauses** — measured silence, trimmed clear of any word.
- **fillers** and **self-talk** — inside a kept take.
- **tags** — a baked-in watermark at the very start or end (Auphonic's free tag).

## Output

`data/<name>/<name>.cleaned.mp4` plus `<name>.cleaned.transcript.json`. The
`aligned.wav` is kept so re-runs stay fast — do not delete the sidecars. Hand
the clean to the production engine:

```js
engine.processFootage({ targetId, filePath: 'data/vid1/vid1.cleaned.mp4' });
```

`edit()` reuses `<name>.cleaned.transcript.json` for captions.

## Tuning (in `config/style.json` → `clean`)

- `gapMin` / `gapKeep` / `minCut` — pause thresholds.
- `fillers` / `selfTalk` / `selfTalkExact` — words and asides removed on sight.
- `tags` / `tag` — a baked-in watermark's phrases and how close to the edges.
- Line matching (defaults in `lib/script.mjs`): `tailWindow`, `runGap`,
  `regionTol`, and the anchor/miss budgets.

Change a number, re-run. Alignment, audio, silence, and words stay cached; only
the cut re-encodes.

## Cost

- align / place / silence / words: cached after the first run.
- the cut: one re-encode of the video (the slow step).
- the final video is encoded at most twice: once here, once by the render.

## Hard rules

- The cleaner **never** writes to the video or the audio; it refuses any output
  path that equals an input.
- Never `--apply` without the human reading `<name>.read.txt` and saying yes.
- The engine never edits text on its own (word fixes default to `leave`).
- Pauses come from measured audio silence, never from transcript gaps.

## Windows

- Always run `node` with `--disable-warning=ExperimentalWarning`.
- Python and ffmpeg must be on PATH.
