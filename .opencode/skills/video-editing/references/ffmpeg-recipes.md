# Example Brand ffmpeg Recipes

Brand: orange `#EA580C`, surface `#F59E0B`, navy `#0f4c81`, text `#FFFFFF`, white `#FFFFFF`. Replace `IN.mp4`/`OUT.mp4`. Point `fontfile=` at a Montserrat .ttf (e.g. download Montserrat-Black.ttf into the working dir).

## 0. Inspect
```bash
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,duration -of default=noprint_wrappers=1 IN.mp4
```

## 1. Reframe to 9:16 (blurred orange pad — keeps whole frame)
```bash
ffmpeg -i IN.mp4 -vf "scale=1080:-1,\
boxblur=20:5,scale=1080:1920,setsar=1,\
drawbox=color=0xEA580C@0.35:t=fill,\
[bg];[0:v]scale=1080:-1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2" \
-c:a copy OUT_vertical.mp4
```
Simple center-crop to 9:16 instead:
```bash
ffmpeg -i IN.mp4 -vf "scale=-1:1920,crop=1080:1920" -c:a copy OUT_crop.mp4
```
1:1 square crop:
```bash
ffmpeg -i IN.mp4 -vf "crop=min(iw\,ih):min(iw\,ih),scale=1080:1080" -c:a copy OUT_square.mp4
```

## 2. Burn LOCKED captions via ASS (per-phrase, colored emphasis, no box)
Create `captions.ass`. ASS colors are &HAABBGGRR (BGR + alpha). Orange #EA580C → `&H000C58EA`; Navy #0f4c81 → `&H00814C0F`; White → `&H00FFFFFF`.
```
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginV
; BorderStyle=1 (outline+shadow, NOT boxed). Big shadow = readable on any scene. No background.
Style: White,   Montserrat, 78,  &H00FFFFFF, &H00000000, &H00000000, 1, 1, 3, 4, 2, 260
Style: Orange,  Montserrat, 132, &H000C58EA, &H00000000, &H00000000, 1, 1, 3, 4, 2, 260
Style: Navy,    Montserrat, 132, &H00814C0F, &H00000000, &H00000000, 1, 1, 3, 4, 2, 260

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
; one PHRASE at a time; emphasis word bigger + own line via \N and inline style
Dialogue: 0,0:00:00.00,0:00:01.20,White,,0,0,0,,I AM A
Dialogue: 0,0:00:01.20,0:00:02.60,Orange,,0,0,0,,SOFTWARE\NDEVELOPER
Dialogue: 0,0:00:02.60,0:00:04.20,White,,0,0,0,,AND {\rNavy}AI{\rWhite}\NENGINEER
```
Burn it:
```bash
ffmpeg -i IN.mp4 -vf "ass=captions.ass" -c:a copy OUT_captioned.mp4
```
Tip: to force the fonts dir → add `:fontsdir=./fonts` inside the ass filter.

## 3. Single drawtext (quick one-liner caption, still no box)
```bash
ffmpeg -i IN.mp4 -vf "drawtext=fontfile=Montserrat-Black.ttf:text='BOOKS CLIENTS 24/7':\
fontcolor=white:fontsize=72:x=(w-tw)/2:y=h*0.72:\
shadowcolor=black@0.85:shadowx=2:shadowy=3:borderw=6:bordercolor=black@0.4" \
-c:a copy OUT.mp4
```

## 4. Orange intro card (1.2s) then crossfade into footage
```bash
# make intro
ffmpeg -f lavfi -i color=c=0xEA580C:s=1080x1920:d=1.2 -vf \
"drawtext=fontfile=Montserrat-Black.ttf:text='BISHIR':fontcolor=0x0f4c81:fontsize=120:x=(w-tw)/2:y=(h-th)/2:\
box=0,drawbox=x=(w-360)/2:y=h/2+90:w=360:h=10:color=0x0f4c81:t=fill" \
-r 30 intro.mp4
# crossfade (xfade needs same size/fps/pixfmt)
ffmpeg -i intro.mp4 -i IN.mp4 -filter_complex \
"[0:v][1:v]xfade=transition=fade:duration=0.4:offset=0.9,format=yuv420p[v]" \
-map "[v]" -map 1:a? OUT_with_intro.mp4
```

## 5. Outro / CTA card (2s)
```bash
ffmpeg -f lavfi -i color=c=0xEA580C:s=1080x1920:d=2 -vf \
"drawtext=fontfile=Montserrat-Black.ttf:text='BOOK A FREE':fontcolor=0x0f4c81:fontsize=96:x=(w-tw)/2:y=h*0.34,\
drawtext=fontfile=Montserrat-Black.ttf:text='AUTOMATION AUDIT':fontcolor=0x0f4c81:fontsize=96:x=(w-tw)/2:y=h*0.44,\
drawtext=fontfile=Montserrat-Medium.ttf:text='link in bio  ·  contact@bishirtijjani.com':fontcolor=0xFFFFFF:fontsize=40:x=(w-tw)/2:y=h*0.60" \
-r 30 outro.mp4
```
Concat footage + outro (same codec/size):
```bash
printf "file 'IN.mp4'\nfile 'outro.mp4'\n" > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy OUT_with_outro.mp4   # re-encode if properties differ
```

## 6. Logo watermark (glyph top-right)
```bash
ffmpeg -i IN.mp4 -i logo_glyph.png -filter_complex \
"[1]scale=120:-1,format=rgba,colorchannelmixer=aa=0.6[wm];[0][wm]overlay=W-w-40:40" \
-c:a copy OUT_wm.mp4
```

## 7. Trim / stitch
```bash
ffmpeg -ss 00:00:03 -to 00:00:18 -i IN.mp4 -c copy OUT_trim.mp4      # trim
printf "file 'a.mp4'\nfile 'b.mp4'\n" > l.txt
ffmpeg -f concat -safe 0 -i l.txt -c copy OUT_join.mp4                # stitch (identical codecs)
```

## 8. Normalize audio + final export
```bash
ffmpeg -i IN.mp4 -af loudnorm=I=-16:TP=-1.5:LRA=11 \
-c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -movflags +faststart \
-c:a aac -b:a 192k OUT_final.mp4
```

## Notes
- Always re-encode (not `-c copy`) when concatenating clips with different resolution/fps/codec.
- Fonts: `apt-get install -y fonts-montserrat` or download the .ttf into the working dir and reference by path.
- Keep the pipeline in a saved `.sh` next to the output so edits are reproducible.
