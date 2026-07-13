from __future__ import annotations

from alfaka.analytics.czardas import AnalysisUnavailable, Ready, analyze_czardas
from alfaka.analytics.czardas.numeric import canonical_digest

from .fixtures import flat_rows, oscillating_rows


def test_kernel_is_deterministic_and_emits_bounded_editable_lines():
    rows = oscillating_rows()
    results = [analyze_czardas(rows) for _ in range(100)]
    assert all(isinstance(item, Ready) for item in results)
    digests = {canonical_digest(item.content) for item in results if isinstance(item, Ready)}
    assert len(digests) == 1
    content = results[0].content
    assert content["selection"] == {
        "hline": {"actualCount": 2, "configuredCount": 2},
        "trend": {"actualCount": 2, "configuredCount": 2},
    }
    assert len(content["drawings"]) == 4
    assert all(item["ownership"] == "czardas-managed" for item in content["drawings"])
    assert results[0].debug["fieldBytes"] <= 32_768
    assert results[0].debug["payloadBytes"] <= 65_536


def test_mapping_insertion_order_does_not_change_input_or_content_digest():
    rows = oscillating_rows()
    reversed_rows = [dict(reversed(tuple(item.items()))) for item in rows]
    original = analyze_czardas(rows)
    reordered = analyze_czardas(reversed_rows)
    assert isinstance(original, Ready) and isinstance(reordered, Ready)
    assert original.content["inputDigest"] == reordered.content["inputDigest"]
    assert canonical_digest(original.content) == canonical_digest(reordered.content)


def test_ready_no_draw_keeps_a_field_and_is_not_unavailable():
    result = analyze_czardas(flat_rows())
    assert isinstance(result, Ready)
    assert result.content["drawings"] == []
    assert result.content["czardasField"]["sourceBars"] == 240


def test_public_kernel_rejects_non_exact_input():
    rows = flat_rows()
    assert isinstance(analyze_czardas(rows[:-1]), AnalysisUnavailable)
    assert isinstance(analyze_czardas([*rows, rows[-1]]), AnalysisUnavailable)
