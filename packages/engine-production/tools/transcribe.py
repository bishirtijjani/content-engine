#!/usr/bin/env python3
"""Local transcription -> HyperFrames normalized word array.

Wraps faster-whisper (CPU, int8, no compiler needed) and emits the
"Normalized word array" JSON the HyperFrames caption pipeline ingests
directly: [{ "text": str, "start": float, "end": float }, ...].

Usage:
  python tools/transcribe.py input/vid0.mp4
  python tools/transcribe.py input/vid0.mp4 --model small.en --out work/transcript.json
"""
import argparse
import json
import re
import sys
from pathlib import Path


def load_lexicon(path: str) -> dict:
    """Load single-word corrections {heard_lower: correct}. Phrase (multi-word)
    keys are left for the caption builder to apply on grouped line text."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    corr = data.get("corrections", data) if isinstance(data, dict) else {}
    return {
        k.lower(): v
        for k, v in corr.items()
        if isinstance(v, str) and " " not in k and not k.startswith("_")
    }


def apply_lexicon(token: str, lex: dict) -> str:
    """Replace a token's alphanumeric core if it matches a correction,
    preserving surrounding punctuation (e.g. 'Bissure.' -> 'Bishir.')."""
    if not lex:
        return token
    m = re.match(r"^([^\w]*)(.*?)([^\w]*)$", token, re.UNICODE)
    lead, core, trail = m.group(1), m.group(2), m.group(3)
    repl = lex.get(core.lower())
    return f"{lead}{repl}{trail}" if repl else token


def main() -> int:
    ap = argparse.ArgumentParser(description="faster-whisper -> normalized word array")
    ap.add_argument("input", help="audio/video file (mp4, wav, mp3, ...)")
    ap.add_argument("--model", default="base.en",
                    help="whisper model: tiny(.en) base(.en) small(.en) medium(.en) large-v3 "
                         "(default base.en; small.en for better accuracy on low RAM)")
    ap.add_argument("--out", default=None,
                    help="output JSON path (default: <input>.transcript.json)")
    ap.add_argument("--language", default=None,
                    help="force language code (e.g. en, es); omit to auto-detect")
    ap.add_argument("--compute-type", default="int8",
                    help="ctranslate2 compute type (default int8 for CPU/low RAM)")
    ap.add_argument("--no-vad", action="store_true",
                    help="disable VAD silence filtering")
    ap.add_argument("--lexicon", default=None,
                    help="path to a corrections JSON (single-word fixes applied per token)")
    args = ap.parse_args()

    lex = load_lexicon(args.lexicon) if args.lexicon else {}
    if args.lexicon:
        print(f"[transcribe] lexicon: {len(lex)} single-word corrections", file=sys.stderr)

    src = Path(args.input)
    if not src.exists():
        print(f"error: input not found: {src}", file=sys.stderr)
        return 1

    out = Path(args.out) if args.out else src.with_suffix(".transcript.json")
    out.parent.mkdir(parents=True, exist_ok=True)

    from faster_whisper import WhisperModel

    print(f"[transcribe] loading model '{args.model}' (cpu/{args.compute_type})...",
          file=sys.stderr)
    model = WhisperModel(args.model, device="cpu", compute_type=args.compute_type)

    print(f"[transcribe] transcribing {src.name}...", file=sys.stderr)
    segments, info = model.transcribe(
        str(src),
        language=args.language,
        word_timestamps=True,
        vad_filter=not args.no_vad,
    )

    words = []
    for seg in segments:
        for w in (seg.words or []):
            text = (w.word or "").strip()
            if not text:
                continue
            text = apply_lexicon(text, lex)
            words.append({
                "text": text,
                "start": round(float(w.start), 3),
                "end": round(float(w.end), 3),
            })

    out.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")

    dur = round(words[-1]["end"], 2) if words else 0.0
    print(f"[transcribe] language={info.language} "
          f"(p={round(info.language_probability, 3)}) "
          f"words={len(words)} span={dur}s", file=sys.stderr)
    print(f"[transcribe] wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
