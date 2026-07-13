from __future__ import annotations

import statistics
import time

from alfaka.analytics.czardas import Ready, analyze_czardas

from .fixtures import oscillating_rows


def test_full_kernel_stays_inside_ci_latency_guardrail():
    rows = oscillating_rows()
    for _ in range(3):
        analyze_czardas(rows)
    values = []
    for _ in range(20):
        started = time.perf_counter()
        result = analyze_czardas(rows)
        values.append((time.perf_counter() - started) * 1000.0)
        assert isinstance(result, Ready)
    # The production-container benchmark enforces P95<=50/P99<=80. CI keeps a
    # wider guardrail so shared runners do not create false failures.
    assert statistics.quantiles(values, n=20)[18] <= 100.0
