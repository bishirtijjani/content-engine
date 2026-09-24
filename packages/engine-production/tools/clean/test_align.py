#!/usr/bin/env python3
"""Self-test for align.py — recovers a known offset and drift from synthetic audio."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from align import align_arrays  # noqa: E402

FS = 48000


def speech_like(n, seed):
    """Band-limited noise with a slow amplitude envelope — closer to speech than
    white noise, so in-window clock drift does not instantly decorrelate it."""
    rng = np.random.default_rng(seed)
    base = rng.standard_normal(n)
    kernel = np.hanning(24)
    kernel /= kernel.sum()
    base = np.convolve(base, kernel, mode="same")
    k = n // 4800 + 2
    env = np.abs(rng.standard_normal(k))
    env = np.interp(np.arange(n), np.linspace(0, n, k), env)
    return base * env


def build_video(rec, offset, drift, fs=FS):
    dur = len(rec) / fs
    vid_len = int((offset + (1 + drift) * dur + 1.0) * fs)
    j = np.arange(vid_len, dtype=np.float64)
    src = (j - offset * fs) / (1.0 + drift)
    vid = np.zeros(vid_len, dtype=np.float32)
    m = (src >= 0) & (src < len(rec) - 1)
    vid[m] = np.interp(src[m], np.arange(len(rec)), rec)
    return vid


def check(label, offset, drift):
    rec = speech_like(90 * FS, seed=7)
    vid = build_video(rec, offset, drift)
    r = align_arrays(vid, rec)
    assert r["ok"], r
    e_off = abs(r["offset"] - offset)
    e_drift = abs(r["drift_ppm"] - drift * 1e6)
    print(
        f"{label}: offset {r['offset']:+.4f}s (want {offset:+.4f}, err {e_off*1000:.2f}ms)  "
        f"drift {r['drift_ppm']:+.1f}ppm (want {drift*1e6:+.1f}, err {e_drift:.1f})  "
        f"residual {r['residual_ms']:.2f}ms  conf {r['confidence']:.2f}  "
        f"windows {r['inliers']}/{r['windows']}"
    )
    assert e_off < 0.01, f"offset error {e_off*1000:.1f}ms too large"
    assert e_drift < 15, f"drift error {e_drift:.1f}ppm too large"


if __name__ == "__main__":
    check("positive offset, no drift", 3.5, 0.0)
    check("negative offset, no drift", -2.0, 0.0)
    check("large offset, small drift", 25.0, 0.00004)
    check("offset + negative drift", 5.0, -0.00009)
    print("all align tests passed")
