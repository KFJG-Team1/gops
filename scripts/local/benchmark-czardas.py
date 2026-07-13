#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import platform
import statistics
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MARKET_DATA_SHARED = REPOSITORY_ROOT / "systems" / "market-data" / "shared"
if str(MARKET_DATA_SHARED) not in sys.path:
    sys.path.insert(0, str(MARKET_DATA_SHARED))

from alfaka.analytics.czardas import Ready, analyze_czardas


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--iterations", type=int, default=200)
    parser.add_argument("--warmup", type=int, default=20)
    args = parser.parse_args()
    rows = fixture()
    for _ in range(args.warmup):
        analyze_czardas(rows)
    values = []
    last = None
    for _ in range(args.iterations):
        started = time.perf_counter()
        last = analyze_czardas(rows)
        values.append((time.perf_counter() - started) * 1000.0)
    values.sort()
    if not isinstance(last, Ready):
        raise SystemExit(last.reason)
    p95 = values[max(0, math.ceil(len(values) * 0.95) - 1)]
    p99 = values[max(0, math.ceil(len(values) * 0.99) - 1)]
    failures = []
    if p95 > 50.0:
        failures.append("kernel_p95_exceeded")
    if p99 > 80.0:
        failures.append("kernel_p99_exceeded")
    if last.debug["fieldBytes"] > 80 * 1024:
        failures.append("field_bytes_exceeded")
    if last.debug["payloadBytes"] > 96 * 1024:
        failures.append("payload_bytes_exceeded")
    report = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "iterations": args.iterations,
        "p50Ms": statistics.median(values),
        "p95Ms": p95,
        "p99Ms": p99,
        "fieldBytes": last.debug["fieldBytes"],
        "payloadBytes": last.debug["payloadBytes"],
        "contentDigest": last.debug["contentDigest"],
        "passed": not failures,
        "failures": failures,
    }
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if not failures else 1


def fixture():
    rows = []
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    for index in range(240):
        phase = index % 30
        center = 105.0 + 2.5 * math.sin(2 * math.pi * phase / 30)
        open_, close = center - 0.2, center + 0.2
        high, low = max(open_, close) + 0.8, min(open_, close) - 0.8
        if phase == 0:
            low, open_, close, high = 100.0, 102.0, 102.5, 103.0
        if phase == 15:
            high, open_, close, low = 110.0, 108.0, 107.5, 107.0
        stamp = start + timedelta(days=index)
        rows.append({
            "symbol": "TEST", "interval": "1D",
            "timestamp": stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "candleKey": stamp.date().isoformat(),
            "open": open_, "high": high, "low": low, "close": close,
            "volume": 1000 + (5000 if phase in {0, 15} else index),
            "isClosed": True, "canonicalVersion": "v2", "priceAdjustment": "split",
            "marketSession": "regular",
        })
    return rows


if __name__ == "__main__":
    raise SystemExit(main())
