from __future__ import annotations

import pytest

from alfaka.analytics.czardas.config import DEFAULT_CONFIG
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
