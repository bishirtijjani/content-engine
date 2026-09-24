#!/usr/bin/env python3
"""place.py — build the aligned recording on the video's timeline.

Takes the alignment measured by align.py and writes one mono WAV at the video's
sample rate: the high-quality recording, clock-drift corrected, placed at the
measured offset, with silence where the recorder has no audio.

  video_time = offset + ratio * rec_time

Usage:
  python place.py --video V --audio A --align align.json --out aligned.wav
"""
import argparse
import json
import wave
from pathlib import Path

import numpy as np

from align import decode, FS

LEAD = 0.2  # seconds of recorder kept before the video start when offset is negative


def place(vid, rec, offset: float, ratio: float, fs: int = FS) -> np.ndarray:
    """Resample `rec` by `ratio` and drop it at `offset` into a video-length buffer."""
    total = len(vid)
    if len(rec) == 0 or total == 0:
        return np.zeros(total, dtype=np.float32)

    # source index for each resampled index: rec[k / ratio]
    n_res = int(np.ceil(len(rec) * ratio))
    k = np.arange(n_res, dtype=np.float64)
    res = np.interp(k / ratio, np.arange(len(rec)), rec).astype(np.float32)

    off = int(round(offset * fs))
    out = np.zeros(total, dtype=np.float32)
    src_start = max(0, -off)
    dst_start = max(0, off)
    n = min(len(res) - src_start, total - dst_start)
    if n > 0:
        out[dst_start:dst_start + n] = res[src_start:src_start + n]
    return out


def write_wav(path: str, samples: np.ndarray, fs: int = FS) -> None:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(fs)
        w.writeframes(pcm.tobytes())


def main() -> int:
    ap = argparse.ArgumentParser(description="place the aligned recording on the video timeline")
    ap.add_argument("--video", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--align", required=True, help="align.json from align.py")
    ap.add_argument("--out", required=True, help="output WAV path")
    ap.add_argument("--fs", type=int, default=FS)
    args = ap.parse_args()

    a = json.loads(Path(args.align).read_text(encoding="utf-8"))
    vid = decode(args.video, args.fs)
    rec = decode(args.audio, args.fs)
    out = place(vid, rec, a["offset"], a["ratio"], args.fs)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    write_wav(args.out, out, args.fs)
    print(f"[place] wrote {args.out}  {len(out)/args.fs:.3f}s  "
          f"offset {a['offset']:+.4f}s  ratio {a['ratio']:.6f}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
