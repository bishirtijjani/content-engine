---
name: codeket-video
description: >-
  Edit video to Bishir Tijjani brand using ffmpeg — burn in branded word-by-word captions,
  resize/reframe to 9:16 / 1:1 / 16:9, add orange intro and outro cards, overlay the
  logo watermark, trim and stitch clips, and normalize audio. Use when the user asks
  to "edit this video", "add captions", "make this a reel", "resize to vertical", "add
  an intro/outro", "watermark this clip", "cut this footage", or "burn subtitles". The
  user provides the raw clip(s); this skill produces a finished branded MP4.
---

# Bishir Tijjani Video

Edit user-supplied footage into finished, on-brand Bishir Tijjani video using ffmpeg in the sandbox. This does real editing on real clips — it does not generate footage from nothing.

## Setup

1. Confirm ffmpeg is available: `ffmpeg -version` (install with `apt-get install -y ffmpeg` if missing).
2. Confirm the input file(s) exist and read their properties: `ffprobe -v error -show_streams input.mp4`.
3. Determine the **account** (@iambishir) and **target ratio** (9:16 reel, 1:1 feed, 16:9 landscape).
4. Work in the outputs folder. Never overwrite the user's original — write new files.

Brand values for filters: orange `#EA580C`, surface `#F59E0B`, navy `#0f4c81`, text `#0f4c81`, white `#FFFFFF`. Fonts: Montserrat (display), Plus Jakarta Sans (body). Install fonts if needed or point ffmpeg drawtext at a Montserrat .ttf.

`references/ffmpeg-recipes.md` has copy-paste commands for every operation below. Read it before running.

## Caption style — LOCKED

Follow this exactly when burning captions:

- Text **mostly white** on orange background. Emphasis words in navy.
- **No box, no background.** Only a strong shadow/border for legibility on any scene: use drawtext `shadowcolor=black@0.85:shadowx=2:shadowy=3` plus `borderw=6:bordercolor=black@0.5` — this reads as a soft dark glow, not a box.
- All text must have a shadow at all times, on any background.
- Reveal **one phrase at a time** (not word-by-word, not the whole sentence). Split the transcript into short phrases; each phrase is one caption event timed to the audio.
- **Emphasis words are much bigger** and sit on **their own line**, colored navy.
- Montserrat 800–900, ALL-CAPS, centered low-third (roughly y = h*0.72).

Prefer generating an ASS/SSA subtitle file (supports per-word color, size, positioning, fade) and burning it with `-vf "ass=captions.ass"`. `references/ffmpeg-recipes.md` includes an ASS template with the Bishir Tijjani styles. For simple cases use chained `drawtext` filters.

## Core operations

1. **Reframe / resize** to target ratio with blurred-orange padding or center-crop (recipes file).
2. **Burn captions** from an ASS file styled to the locked spec.
3. **Intro card** (~1.2s): orange background, BISHIR wordmark, one navy accent underline; crossfade into footage.
4. **Outro / CTA card** (~2s): orange, "BOOK A FREE AUTOMATION AUDIT" + handle, navy button shape.
5. **Logo watermark**: small glyph overlay, top-right, ~60% opacity, safe margin.
6. **Trim / stitch**: cut dead air, concat multiple takes.
7. **Audio**: normalize loudness (`loudnorm`), optional light music bed under −18 LUFS.

## Workflow

1. Read footage properties and the user's intent.
2. If captions are requested and no transcript is given, transcribe first (ask the user for a transcript, or use an available transcription tool), then split into phrases.
3. Build the edit as a documented ffmpeg pipeline (one script the user can re-run). Save it alongside the output so edits are reproducible.
4. Render to H.264 MP4, `-crf 18 -preset medium`, `+faststart`, AAC audio.
5. Present the finished MP4 with `present_files`. Note the ratio, duration, and what was applied.

## Honesty

Be explicit about what this can and cannot do. It CAN: cut, resize, caption, brand, watermark, add cards, normalize audio on clips the user provides. It CANNOT: generate or hallucinate footage, remove complex backgrounds without a source, or produce AI video. If the user wants footage generated, say so and suggest they record or supply clips.
