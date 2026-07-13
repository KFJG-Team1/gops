from __future__ import annotations

import pytest

from alfaka.analytics.czardas import Ready, analyze_czardas

from .fixtures import oscillating_rows


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
