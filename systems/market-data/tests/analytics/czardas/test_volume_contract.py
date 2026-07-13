from __future__ import annotations

from alfaka.analytics.czardas import Ready, analyze_czardas

from .fixtures import flat_rows, oscillating_rows


def test_volume_scaling_does_not_change_trend_geometry_rank_or_field():
    normal = analyze_czardas(oscillating_rows(volume_scale=1.0))
    scaled = analyze_czardas(oscillating_rows(volume_scale=10.0))
    assert isinstance(normal, Ready) and isinstance(scaled, Ready)
    normal_trends = [item for item in normal.content["boundaries"] if item["kind"] == "trend"]
    scaled_trends = [item for item in scaled.content["boundaries"] if item["kind"] == "trend"]
    assert normal_trends == scaled_trends
    assert normal.content["czardasField"]["trendModes"] == scaled.content["czardasField"]["trendModes"]


def test_volume_alone_cannot_create_a_boundary():
    result = analyze_czardas(flat_rows(volume=1_000_000_000.0))
    assert isinstance(result, Ready)
    assert result.content["boundaries"] == []
