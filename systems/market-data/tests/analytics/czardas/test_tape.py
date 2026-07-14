from __future__ import annotations

import pytest

from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas import AnalysisUnavailable, analyze_czardas
from dataclasses import replace
from alfaka.analytics.czardas.tape import CandleTape

from .fixtures import flat_rows


def test_candle_tape_requires_exact_240_completed_rows():
    rows = flat_rows()
    assert len(CandleTape.from_rows(rows, DEFAULT_CONFIG).candles) == 240
    for invalid in (rows[:-1], [*rows, rows[-1]]):
        with pytest.raises(ValueError, match="expected_exactly_240"):
            CandleTape.from_rows(invalid, DEFAULT_CONFIG)


def test_candle_tape_rejects_duplicate_and_live_identity():
    rows = flat_rows()
    duplicate = [dict(item) for item in rows]
    duplicate[-1]["candleKey"] = duplicate[-2]["candleKey"]
    duplicate[-1]["timestamp"] = duplicate[-2]["timestamp"]
    with pytest.raises(ValueError, match="duplicate"):
        CandleTape.from_rows(duplicate, DEFAULT_CONFIG)
    live = [dict(item) for item in rows]
    live[-1]["isClosed"] = False
    with pytest.raises(ValueError, match="live_candle"):
        CandleTape.from_rows(live, DEFAULT_CONFIG)


def test_canonical_provenance_is_explicit_and_production_config_is_fixed_240():
    for key in ("isClosed", "canonicalVersion", "priceAdjustment", "marketSession"):
        rows = flat_rows()
        rows[0].pop(key)
        with pytest.raises(ValueError, match="missing_canonical_provenance"):
            CandleTape.from_rows(rows, DEFAULT_CONFIG)
    result = analyze_czardas(flat_rows()[:-1], replace(DEFAULT_CONFIG, target_completed_bars=239))
    assert isinstance(result, AnalysisUnavailable)
    assert result.reason == "invalid_config"
