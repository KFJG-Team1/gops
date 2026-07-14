from __future__ import annotations

import time

from alfaka.analytics.czardas import Ready, analyze_czardas

from .fixtures import oscillating_rows


def test_full_kernel_stays_inside_ci_latency_guardrail():
    rows = oscillating_rows()
    for _ in range(5):
        analyze_czardas(rows)
    values = []
    for _ in range(100):
        started = time.perf_counter()
        result = analyze_czardas(rows)
        values.append((time.perf_counter() - started) * 1000.0)
        assert isinstance(result, Ready)
    ordered = sorted(values)
    assert ordered[94] <= 50.0
    assert ordered[98] <= 80.0
