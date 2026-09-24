#!/usr/bin/env python3
"""Self-test for place.py — the aligned recording lands at the right spot.

Covers the two cases that matter: the recording starting after the video
(positive offset) and before it (negative offset).
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from place import place  # noqa: E402

FS = 48000


def flat(n, value):
    return np.full(n, value, dtype=np.float32)


def test_positive_offset():
    vid = np.zeros(FS * 10, dtype=np.float32)
    rec = flat(FS * 3, 0.5)
    out = place(vid, rec, 2.0, 1.0, FS)
    assert out.shape == vid.shape
    assert np.allclose(out[: FS * 2 - 1], 0), "silence before the offset"
    assert np.allclose(out[FS * 2 + 10: FS * 5 - 10], 0.5), "tone across the recording"
    assert np.allclose(out[FS * 5 + 10:], 0), "silence after the recording"


def test_negative_offset():
    vid = np.zeros(FS * 10, dtype=np.float32)
    rec = flat(FS * 3, 0.5)
    out = place(vid, rec, -1.0, 1.0, FS)
    # the first second of the recording predates the video; the rest lands at 0
    assert np.allclose(out[: FS - 10], 0.5), "video starts mid-recording"
    assert np.allclose(out[FS * 2 + 10:], 0), "tail after the recording is silent"


def test_drift_stretch():
    rec = flat(FS * 2, 0.5)
    vid = np.zeros(FS * 10, dtype=np.float32)
    out = place(vid, rec, 0.0, 1.001, FS)
    nz = np.nonzero(out)[0]
    assert len(nz) > 0
    assert abs(int(nz[-1]) - int(FS * 2 * 1.001)) < 5, "recording stretched by the ratio"


def test_no_overlap():
    rec = flat(FS * 2, 0.5)
    vid = np.zeros(FS * 10, dtype=np.float32)
    out = place(vid, rec, 100.0, 1.0, FS)  # far past the end
    assert np.allclose(out, 0), "nothing lands when there is no overlap"


if __name__ == "__main__":
    test_positive_offset()
    test_negative_offset()
    test_drift_stretch()
    test_no_overlap()
    print("all place tests passed")
