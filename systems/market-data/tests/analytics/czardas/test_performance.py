from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[5]


def test_full_kernel_does_not_show_abnormal_computation_growth():
    completed = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "local" / "benchmark-czardas.py"),
            "--iterations", "200",
            "--warmup", "20",
        ],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert completed.stdout, completed.stderr
    report = json.loads(completed.stdout)
    assert completed.returncode == 0, report
    assert report["comparisonMode"] == "absolute_safety_limits_only"
    assert report["p95SafetyLimitMs"] == 250.0
    assert report["p99SafetyLimitMs"] == 400.0
    assert report["p95Ms"] <= 250.0
    assert report["p99Ms"] <= 400.0
    assert report["fieldBytes"] <= 80 * 1024
    assert report["payloadBytes"] <= 96 * 1024
