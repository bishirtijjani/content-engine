#!/usr/bin/env python3
"""align.py — sample-accurate audio/video sync for the cleaner.

The camera video carries its own scratch audio. That audio is the anchor: we
find where the separate high-quality recording sits on the video's timeline,
down to the sample, and measure the clock drift between the two devices so one
offset holds from the first frame to the last.

The core works on decoded mono float arrays (`align_arrays`), so it can be
unit-tested without ffmpeg. The CLI decodes two media files with the same
settings the final output will use, then prints JSON to stdout.

Usage:
  python align.py --video data/vid1/vid1.mp4 --audio data/vid1/vid1-rec.mpeg
"""
import argparse
import json
import subprocess
import sys

import numpy as np

FS = 48000           # decode rate; the output audio uses the same rate
ENV_RATE = 50        # coarse envelope frame rate (Hz)
FINE_WINDOW_S = 6    # seconds of audio per fine-offset measurement
FINE_SEARCH_S = 1.5  # +/- seconds searched around the coarse estimate
DRIFT_POINTS = 6     # number of windows across the clip used to fit drift


def decode(path: str, fs: int = FS) -> np.ndarray:
    """Decode any media file to mono float32 PCM at `fs` via ffmpeg."""
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(fs), "-f", "f32le", "-"]
    res = subprocess.run(cmd, capture_output=True)
    if res.returncode != 0:
        raise RuntimeError("ffmpeg failed: " + res.stderr.decode("utf-8", "replace")[:400])
    return np.frombuffer(res.stdout, dtype="<f4")


def envelope(x: np.ndarray, fs: int = FS, rate: int = ENV_RATE) -> np.ndarray:
    """Root-mean-square energy envelope — robust for aligning speech."""
    step = max(1, fs // rate)
    n = len(x) // step
    if n == 0:
        return np.zeros(0, dtype=np.float64)
    frames = x[: n * step].reshape(n, step).astype(np.float64)
    return np.sqrt(np.mean(frames * frames, axis=1))


def xcorr_lag(a: np.ndarray, b: np.ndarray, guard: int = 0):
    """Normalised cross-correlation of two real signals.

    Match convention: `a[n] ~ b[n - lag]`.
    Returns (lag, peak, ratio): `peak` is the correlation coefficient (0..1) at
    the best lag; `ratio` compares it to the next-best peak outside `guard`
    samples around the winner.
    """
    a = a - a.mean()
    b = b - b.mean()
    a = a / (np.linalg.norm(a) + 1e-12)
    b = b / (np.linalg.norm(b) + 1e-12)
    n = len(a) + len(b) - 1
    size = 1 << (n - 1).bit_length()
    cc = np.fft.irfft(np.fft.rfft(a, size) * np.conj(np.fft.rfft(b, size)), size)
    m = int(np.argmax(cc))
    lag = m if m <= size // 2 else m - size
    peak = float(cc[m])
    lo, hi = max(0, m - guard), min(size, m + guard + 1)
    cc[lo:hi] = -np.inf
    cc[size // 2 + 1:] = -np.inf
    second = float(np.max(cc)) if np.isfinite(cc).any() else 0.0
    ratio = peak / second if second > 1e-9 else float("inf")
    return lag, peak, ratio


def _window_offset(rec, vid, rstart, approx, fs=FS):
    """Fine offset for one recorder window at `rstart`, searched near `approx`.

    Returns (offset_seconds, peak, ratio). offset is video_time - rec_time.
    """
    win = int(FINE_WINDOW_S * fs)
    half = int(FINE_SEARCH_S * fs)
    r = np.asarray(rec[rstart:rstart + win], dtype=np.float64)
    if len(r) < fs:
        return None
    vstart = rstart + int(approx * fs) - half
    vstart = max(0, min(vstart, len(vid) - (win + 2 * half)))
    v = np.asarray(vid[vstart:vstart + win + 2 * half], dtype=np.float64)
    if len(v) < win + 1:
        v = np.pad(v, (0, win + 2 * half - len(v)))
    lag, peak, ratio = xcorr_lag(r, v, guard=int(0.05 * fs))
    # a[n] ~ b[n - lag]  =>  offset = vstart - rstart - lag   (samples)
    return (vstart - rstart - lag) / fs, peak, ratio


def _robust_line(times, offs):
    """Fit offset = intercept + slope*time, dropping outlier windows.

    Returns (slope, intercept, keep_mask). Iterative sigma-clipping: silent or
    wrongly-locked windows sit far off the line and get dropped.
    """
    t = np.asarray(times, dtype=np.float64)
    o = np.asarray(offs, dtype=np.float64)
    keep = np.ones(len(t), dtype=bool)
    for _ in range(8):
        slope, intercept = np.polyfit(t[keep], o[keep], 1)
        resid = o - (intercept + slope * t)
        med = np.median(resid[keep])
        mad = np.median(np.abs(resid[keep] - med))
        sigma = 1.4826 * mad
        thr = max(4.0 * sigma, 0.0015)  # 1.5 ms floor
        new = np.abs(resid - med) <= thr
        if new.sum() < 4 or np.array_equal(new, keep):
            break
        keep = new
    slope, intercept = np.polyfit(t[keep], o[keep], 1)
    return float(slope), float(intercept), keep


def align_arrays(vid: np.ndarray, rec: np.ndarray, fs: int = FS) -> dict:
    """Measure offset and clock drift between a video and a recording.

    offset (seconds): video_time = offset + (1 + drift) * rec_time.
    ratio: 1 + drift, the resample factor for the recording.
    """
    if len(vid) == 0 or len(rec) == 0:
        return {"ok": False, "reason": "empty audio"}

    # 1. coarse: envelope correlation over the whole clip
    lag, _, _ = xcorr_lag(envelope(rec, fs), envelope(vid, fs), guard=2)
    coarse = -lag / ENV_RATE  # seconds

    # 2. dense fine windows across the clip, keeping only confident ones
    win = int(FINE_WINDOW_S * fs)
    span = max(0, len(rec) - win)
    step = max(int(10 * fs), min(int(30 * fs), span // 40 or 1))
    raw = []
    rstart = 0
    while rstart + win <= len(rec):
        got = _window_offset(rec, vid, rstart, coarse, fs)
        if got:
            off, peak, ratio = got
            if peak >= 0.15 and ratio >= 3.0:
                raw.append((rstart / fs, off, peak, ratio))
        rstart += step

    if len(raw) < 4:
        return {"ok": False, "reason": f"only {len(raw)} confident windows (need 4)"}

    times = np.array([p[0] for p in raw])
    offs = np.array([p[1] for p in raw])
    slope, intercept, keep = _robust_line(times, offs)
    inliers = [p for p, k in zip(raw, keep) if k]
    resid = float(np.max(np.abs(offs[keep] - (intercept + slope * times[keep]))))

    vdur = len(vid) / fs
    span_start = float(intercept)
    span_end = float(intercept + (1.0 + slope) * (len(rec) / fs))
    overlap_start = max(0.0, span_start)
    overlap_end = min(span_end, vdur)

    return {
        "ok": True,
        "offset": float(intercept),
        "ratio": 1.0 + slope,
        "drift_ppm": slope * 1e6,
        "residual_ms": resid * 1000.0,
        "confidence": float(np.min([p[2] for p in inliers])),
        "peak_ratio": float(np.min([p[3] for p in inliers])),
        "windows": len(raw),
        "inliers": len(inliers),
        "points": [
            {"t": round(float(t), 3), "offset": round(float(o), 6), "peak": round(float(pk), 3)}
            for t, o, pk, _ in inliers
        ],
        "span_start": span_start,
        "span_end": span_end,
        "overlap_start": overlap_start,
        "overlap_end": overlap_end,
        "overlap_duration": max(0.0, overlap_end - overlap_start),
        "lead_trim": overlap_start,
        "tail_trim": max(0.0, vdur - overlap_end),
        "rec_duration": len(rec) / fs,
        "vid_duration": vdur,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="sample-accurate audio/video alignment")
    ap.add_argument("--video", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--fs", type=int, default=FS)
    args = ap.parse_args()

    vid = decode(args.video, args.fs)
    rec = decode(args.audio, args.fs)
    result = align_arrays(vid, rec, args.fs)

    if result.get("ok"):
        print(
            f"[align] offset {result['offset']:+.4f}s  drift {result['drift_ppm']:+.1f}ppm  "
            f"residual {result['residual_ms']:.2f}ms  confidence {result['confidence']:.2f}  "
            f"span {result['span_start']:.3f}..{result['span_end']:.3f}s",
            file=sys.stderr,
        )
    else:
        print(f"[align] failed: {result.get('reason')}", file=sys.stderr)

    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
