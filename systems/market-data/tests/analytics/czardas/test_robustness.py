from __future__ import annotations

from types import SimpleNamespace

import pytest

from alfaka.analytics.czardas import Ready, analyze_czardas
from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas.features import build_features
from alfaka.analytics.czardas.interactions import LineProbe, has_open_break
from alfaka.analytics.czardas.tape import CandleTape
from alfaka.analytics.czardas.trend import _stratified_anchors

from .fixtures import flat_rows, oscillating_rows


def _boundaries(result: Ready):
    return {
        (item["kind"], item["role"]): item
        for item in result.content["boundaries"]
    }


def _transform(rows, *, shift: float = 0.0, scale: float = 1.0):
    transformed = []
    for row in rows:
        item = dict(row)
        for key in ("open", "high", "low", "close"):
            item[key] = (item[key] + shift) * scale
        transformed.append(item)
    return transformed


def test_price_translation_and_positive_scale_preserve_geometry_structure():
    base = analyze_czardas(oscillating_rows())
    shifted = analyze_czardas(_transform(oscillating_rows(), shift=50.0))
    scaled = analyze_czardas(_transform(oscillating_rows(), scale=2.0))
    assert isinstance(base, Ready) and isinstance(shifted, Ready) and isinstance(scaled, Ready)

    base_lines = _boundaries(base)
    shifted_lines = _boundaries(shifted)
    scaled_lines = _boundaries(scaled)
    assert base_lines.keys() == shifted_lines.keys() == scaled_lines.keys()
    for key, line in base_lines.items():
        shifted_line = shifted_lines[key]
        scaled_line = scaled_lines[key]
        assert shifted_line["line"]["priceAtAsOf"] == pytest.approx(line["line"]["priceAtAsOf"] + 50.0)
        assert shifted_line["line"]["slopePerBar"] == pytest.approx(line["line"]["slopePerBar"])
        assert shifted_line["line"]["zoneHalfWidth"] == pytest.approx(line["line"]["zoneHalfWidth"])
        assert shifted_line["rank"]["rankScore"] == pytest.approx(line["rank"]["rankScore"])

        # The market's one-cent effective-tick floor intentionally does not
        # scale with price; its bounded quantization can shift a refined center
        # by at most a few ticks.
        assert scaled_line["line"]["priceAtAsOf"] == pytest.approx(
            2.0 * line["line"]["priceAtAsOf"], abs=0.03
        )
        assert scaled_line["line"]["slopePerBar"] == pytest.approx(2.0 * line["line"]["slopePerBar"])
        assert scaled_line["line"]["zoneHalfWidth"] == pytest.approx(2.0 * line["line"]["zoneHalfWidth"])
        # The 48-bin OHLCV profile is a bounded H-Line rank boost, so decimal
        # bin-edge quantization may move only that score by a few thousandths.
        assert scaled_line["rank"]["rankScore"] == pytest.approx(line["rank"]["rankScore"], abs=0.003)


def test_one_isolated_long_wick_does_not_erase_the_large_scale_structure():
    base_rows = oscillating_rows()
    outlier_rows = [dict(item) for item in base_rows]
    outlier_rows[105]["high"] += 25.0
    base = analyze_czardas(base_rows)
    outlier = analyze_czardas(outlier_rows)
    assert isinstance(base, Ready) and isinstance(outlier, Ready)

    base_lines = _boundaries(base)
    outlier_lines = _boundaries(outlier)
    assert base_lines.keys() == outlier_lines.keys()
    for key in (("hline", "support"), ("hline", "resistance")):
        assert outlier_lines[key]["line"]["priceAtAsOf"] == pytest.approx(
            base_lines[key]["line"]["priceAtAsOf"], abs=0.05
        )
    for key in (("trend", "lower"), ("trend", "upper")):
        assert outlier_lines[key]["line"]["priceAtAsOf"] == pytest.approx(
            base_lines[key]["line"]["priceAtAsOf"], abs=1.0
        )


def test_zero_range_and_zero_volume_remain_available_as_an_honest_no_draw_snapshot():
    rows = flat_rows(volume=0.0)
    for item in rows:
        item.update(open=100.0, high=100.0, low=100.0, close=100.0)
    result = analyze_czardas(rows)
    assert isinstance(result, Ready)
    assert result.content["drawings"] == []
    meanings = result.content["czardasField"]["candleMeanings"]
    atr_bit = meanings["availabilityCodebook"]["atr"]
    assert all(not (mask & atr_bit) for mask in meanings["availabilityMasks"])


def test_persistent_current_close_penetration_rejects_the_existing_boundary():
    rows = oscillating_rows()
    base = analyze_czardas(rows)
    assert isinstance(base, Ready)
    support = next(item for item in base.content["boundaries"] if item["kind"] == "hline" and item["role"] == "support")
    y = support["line"]["priceAtAsOf"]
    broken = [dict(item) for item in rows]
    for index in (238, 239):
        broken[index].update(open=y - 1.0, high=y - 0.5, low=y - 2.0, close=y - 1.5)
    current = analyze_czardas(broken)
    assert isinstance(current, Ready)
    assert all(item["candidateId"] != support["candidateId"] for item in current.content["boundaries"])


def test_past_break_followed_by_reclaim_is_not_an_open_break_forever():
    rows = oscillating_rows()
    for index in (180, 181):
        rows[index].update(open=98.5, high=99.0, low=98.0, close=98.5)
    tape = CandleTape.from_rows(rows, DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    probe = LineProbe("support", 0.0, 100.0, 0, 0.2)
    assert has_open_break(tape, features, probe, 181, DEFAULT_CONFIG)
    assert not has_open_break(tape, features, probe, 239, DEFAULT_CONFIG)


def test_trend_anchor_strata_never_refill_one_time_third_above_four():
    anchors = [
        SimpleNamespace(
            basis_id=f"early-{index}", bar_index=index, geometry_score=1.0 - index / 1000,
            effective_scale=13,
        )
        for index in range(10, 20)
    ] + [
        SimpleNamespace(
            basis_id=f"late-{index}", bar_index=index, geometry_score=1.0 - index / 1000,
            effective_scale=13,
        )
        for index in range(170, 180)
    ]

    selected = _stratified_anchors(anchors, candle_count=240, cap=12)
    counts = [
        sum((third * 80) <= item.bar_index < ((third + 1) * 80) for item in selected)
        for third in range(3)
    ]

    assert counts == [4, 0, 4]
    assert len(selected) == 8
