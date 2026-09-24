#!/usr/bin/env python3
"""silence.py — find silent stretches in a recording, from the audio itself.

The transcript can miss words (a small model, a quiet passage), so a gap in the
transcript is NOT proof of silence. This measures the audio energy directly and
reports the stretches that are actually quiet, so the cleaner never cuts speech
it failed to hear.

Usage:
  python silence.py --audio aligned.wav [--min 0.6] > silences.json
"""
import argparse
import json
import sys
import wave

import numpy as np


def load_wav(path):
    w = wave.open(path)
    n = w.getnframes()
    fs = w.getframerate()
    x = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float32) / 32768.0
    w.close()
    return x, fs


def frame_rms(x, fs, win=0.02):
    step = max(1, int(win * fs))
    n = len(x) // step
    if n == 0:
        return np.zeros(0, dtype=np.float64), step
    frames = x[: n * step].reshape(n, step).astype(np.float64)
    return np.sqrt(np.mean(frames * frames, axis=1)), step


def detect_silences(x, fs, min_gap=0.6, win=0.02, pad=0.05):
    """Silent spans [start, end] in seconds, each at least `min_gap` long.

    The threshold adapts to the recording: the quiet floor plus 6% of the
    speech-to-floor range.
    """
    rms, step = frame_rms(x, fs, win)
    if len(rms) == 0:
        return []
    floor = float(np.percentile(rms, 10))
    speech = float(np.percentile(rms, 90))
    thr = floor + 0.06 * (speech - floor)
    below = rms < thr
    spans = []
    i = 0
    n = len(below)
    while i < n:
        if below[i]:
            j = i
            while j < n and below[j]:
                j += 1
            s = max(0.0, i * step / fs - pad)
            e = min(len(x) / fs, j * step / fs + pad)
            if e - s >= min_gap:
                spans.append((round(s, 3), round(e, 3)))
            i = j
        else:
            i += 1
    return spans


def main() -> int:
    ap = argparse.ArgumentParser(description="find silent stretches from the audio")
    ap.add_argument("--audio", required=True)
    ap.add_argument("--min", type=float, default=0.6, help="minimum silence length (s)")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    x, fs = load_wav(args.audio)
    spans = detect_silences(x, fs, args.min)
    payload = [{"start": s, "end": e} for s, e in spans]
    text = json.dumps(payload, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
    print(text)
    print(f"[silence] {len(spans)} silent span(s) >= {args.min}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
