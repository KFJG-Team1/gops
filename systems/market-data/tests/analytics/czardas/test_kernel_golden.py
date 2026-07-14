from __future__ import annotations

from dataclasses import replace

from alfaka.analytics.czardas import AnalysisUnavailable, Ready, analyze_czardas
from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas.numeric import canonical_digest

from .fixtures import flat_rows, oscillating_rows


def test_kernel_is_deterministic_and_emits_bounded_editable_lines():
    rows = oscillating_rows()
    results = [analyze_czardas(rows) for _ in range(100)]
    assert all(isinstance(item, Ready) for item in results)
    digests = {canonical_digest(item.content) for item in results if isinstance(item, Ready)}
    assert len(digests) == 1
    content = results[0].content
    assert 0 <= content["selection"]["hline"]["actualCount"] <= 4
    assert 0 <= content["selection"]["trend"]["actualCount"] <= 3
    assert len(content["drawings"]) <= 7
    assert all(item["ownership"] == "czardas-managed" for item in content["drawings"])
    assert all(item["sourceInferenceId"] == content["inferenceId"] for item in content["drawings"])
    assert results[0].debug["fieldBytes"] <= 81_920
    assert results[0].debug["payloadBytes"] <= 98_304


def test_mapping_insertion_order_does_not_change_input_or_content_digest():
    rows = oscillating_rows()
    reversed_rows = [dict(reversed(tuple(item.items()))) for item in rows]
    original = analyze_czardas(rows)
    reordered = analyze_czardas(reversed_rows)
    assert isinstance(original, Ready) and isinstance(reordered, Ready)
    assert original.content["inputDigest"] == reordered.content["inputDigest"]
    assert canonical_digest(original.content) == canonical_digest(reordered.content)


def test_q8_quantization_seals_input_before_every_inference_stage():
    rows = oscillating_rows()
    same_quantum = [dict(item) for item in rows]
    different_quantum = [dict(item) for item in rows]
    same_quantum[80]["close"] += 4e-9
    different_quantum[80]["close"] += 1.1e-8

    original = analyze_czardas(rows)
    same = analyze_czardas(same_quantum)
    different = analyze_czardas(different_quantum)
    assert isinstance(original, Ready) and isinstance(same, Ready) and isinstance(different, Ready)
    assert original.content == same.content
    assert original.debug["contentDigest"] == same.debug["contentDigest"]
    assert original.content["inputDigest"] != different.content["inputDigest"]


def test_ready_no_draw_keeps_a_field_and_is_not_unavailable():
    result = analyze_czardas(flat_rows())
    assert isinstance(result, Ready)
    assert result.content["drawings"] == []
    assert result.content["czardasField"]["sourceBars"] == 240


def test_public_kernel_rejects_non_exact_input():
    rows = flat_rows()
    assert isinstance(analyze_czardas(rows[:-1]), AnalysisUnavailable)
    assert isinstance(analyze_czardas([*rows, rows[-1]]), AnalysisUnavailable)


def test_production_config_cannot_be_mutated_for_research_or_quota_filling():
    config = replace(DEFAULT_CONFIG, hline_display_count=4, trend_display_count=3)
    result = analyze_czardas(oscillating_rows(), config)
    assert isinstance(result, AnalysisUnavailable)
    assert result.reason == "invalid_config"


def test_sight_v2_changes_projection_identity_without_changing_inference_config_identity():
    sight_v1 = replace(DEFAULT_CONFIG, sight_projection_version="czardas-sight-v1")

    assert DEFAULT_CONFIG.sight_projection_version == "czardas-sight-v2"
    assert DEFAULT_CONFIG.inference_digest == sight_v1.inference_digest
    assert DEFAULT_CONFIG.projection_digest != sight_v1.projection_digest
