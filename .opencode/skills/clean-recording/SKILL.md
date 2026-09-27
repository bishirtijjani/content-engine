---
name: clean-recording
description: Turn a raw recording into one clean video — sync the separate high-quality audio to the camera video, then cut pauses and wrong takes. Use when the user drops raw footage plus a separate audio recording in a folder and wants it cleaned, or says "clean this recording", "sync the audio", "cut the pauses", "remove my restarts".
---

# Clean a recording

You turn one raw recording into one clean video. The cleaner
(`packages/engine-production/tools/clean/`) does the work. It is deterministic:
the same folder always gives the same cut list, whatever model runs it.

This runs BEFORE the production engine. The production engine then adds captions
and graphics. The cleaner and the engine never modify the raw footage.

## Input

One folder, `data/<name>/`, containing exactly:

- **one video** — the camera file, with its own scratch audio (the anchor for sync)
- **one audio** — the separate high-quality recording
- optional **`script.txt`** — the script you read from

Anything else in the folder is ignored. More than one video or audio is an error.

## The two commands

```bash
npm run clean -- data/vid1           # propose: print the cut list, cut nothing
npm run clean -- data/vid1 --apply   # apply the cut list after approval
```

Add `--realign` to ignore the cached alignment and measure again.
Add `--model small.en` to use a bigger speech model (slower, more accurate).

## The gate (mandatory)

Running the cleaner **without** `--apply` only proposes. It prints a table of
every cut with its time and reason. **Show that table to the human and wait for
their yes.** Never run `--apply` on your own judgement. Cuts are a human
decision, exactly like the engine's gates.

## What it does, in order

1. **align** — measures the offset and clock drift between the camera's audio and
   the recording, down to the sample (`align.py`). Refuses to continue if the
   match is weak.
2. **place** — puts the recording on the video's timeline (`place.py`).
3. **silence** — measures the silent stretches from the audio itself
   (`silence.py`). Pauses never come from the transcript, so a word the speech
   model missed can never be cut.
4. **words** — a word-timed transcript of the aligned audio (`transcribe.py`).
5. **cuts** — pauses, filler words, self-talk, and repeated takes (`lib/cut.mjs`).

## What it cuts

- **pauses** — silence measured from the audio, trimmed to a short breath.
- **fillers** — "um", "uh", and similar.
- **self-talk** — asides said to himself: "start again", "I'm supposed to",
  counting "three two one". Matched on the words themselves, so a countdown
  stuck to the start of a line is removed on its own.
- **repeated takes** — a line said more than once. The **last** try is kept;
  the first try and everything said up to it (including any aside in between)
  is removed. This is the main fix for reading a script line by line and
  restarting.
- **false starts** — a short fragment the next line repeats from the top.
- **tags** — a watermark a service baked into the audio (e.g. Auphonic's free
  "free audio post production by auphonic.com"). Removed only at the very start
  or end, never mid-video.

A short fragment right before a repeated line is treated as the same broken
sentence and removed with it.

Each step is cached next to the video (`<name>.align.json`, `.aligned.wav`,
`.silences.json`, `.transcript.json`, `.cuts.json`). Re-running reuses the cache;
only the final cut re-encodes.

## Output

`data/<name>/<name>.cleaned.mp4` plus `<name>.cleaned.transcript.json`. The
aligned `.wav` is kept so re-runs stay fast — do not delete the sidecars.

After the human is happy with the clean, hand it to the production engine:

```js
engine.processFootage({ targetId, filePath: 'data/vid1/vid1.cleaned.mp4' });
```

`edit()` reuses `<name>.cleaned.transcript.json` for captions instead of
listening again.

## Tuning (in `config/style.json` → `clean`)

- `gapMin` — shortest silence to trim (seconds). Raise it to cut fewer pauses.
- `gapKeep` — silence left after the previous word.
- `minCut` — shortest pause cut allowed.
- `fillers` — words removed on sight.
- `selfTalk` — asides removed on sight (whole-word phrases).
- `selfTalkExact` — single words removed only when the whole line is that word.
- `tags` — a baked-in watermark's phrases; `tag` — how close to the start or end
  it must be, and the gap that still counts as one tag.
- `retake` — how two takes are judged the same line (similarity, words compared,
  false-start length).
- `repeat` — how far apart two tries can be, how many lines ahead to look, the
  shortest line treated as a repeat, and how close a fragment must be to join a
  repeat cut.

Change a number, re-run. Alignment, audio, silence and words stay cached; only
the cut re-encodes (the slow part, ~minutes for a long video).

## Cost

- align / place / silence / words: cached after the first run.
- the cut: one re-encode of the whole video. This is the slow step.
- the final video is encoded at most twice total: once here, once by the render.

## Hard rules

- The cleaner **never** writes to the video or the audio. It only reads them,
  and refuses any output path that equals an input.
- Never `--apply` without showing the cut list and getting the human's yes.
- Pauses come from measured audio silence, never from transcript gaps.

## Windows

- Always run `node` with `--disable-warning=ExperimentalWarning`.
- Python and ffmpeg must be on PATH (the cleaner shells out to both).
