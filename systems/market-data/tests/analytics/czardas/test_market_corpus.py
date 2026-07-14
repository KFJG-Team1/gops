from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from alfaka.analytics.czardas import Ready, analyze_czardas
from alfaka.analytics.czardas.numeric import canonical_digest
from alfaka.candles import aggregate_canonical_candles


CORPUS = Path(__file__).parents[2] / "fixtures" / "czardas_v2" / "market"
SYMBOLS = ("AAPL", "MSFT", "NVDA", "TSLA", "SPY", "TLT")


def _daily(symbol: str) -> list[dict]:
    rows = json.loads((CORPUS / f"{symbol.lower()}-1d.json").read_text())
    return [
        {
            **row,
            "symbol": symbol,
            "interval": "1D",
            "candleKey": str(row["timestamp"])[:10],
            "isClosed": True,
            "canonicalVersion": "v2",
            "priceAdjustment": "split",
            "marketSession": "regular",
        }
        for row in rows
        if all(row.get(key) is not None for key in ("open", "high", "low", "close", "volume"))
    ]


def _weekly(symbol: str) -> list[dict]:
    rows = aggregate_canonical_candles(
        _daily(symbol),
        "1W",
        now=datetime(2026, 7, 14, tzinfo=timezone.utc),
    )
    return [
        {
            **row,
            "symbol": symbol,
            "interval": "1W",
            "isClosed": True,
            "canonicalVersion": "v2",
            "priceAdjustment": "split",
            "marketSession": "regular",
        }
        for row in rows
    ]


@pytest.mark.parametrize("symbol", SYMBOLS)
def test_real_daily_corpus_produces_complete_bounded_present_snapshot(symbol: str):
    rows = _daily(symbol)[-240:]
    result = analyze_czardas(rows)

    assert isinstance(result, Ready), getattr(result, "reason", None)
    assert result.content["symbol"] == symbol
    assert result.content["interval"] == "1D"
    assert result.debug["fieldBytes"] <= 80 * 1024
    assert result.debug["payloadBytes"] <= 96 * 1024
    meanings = result.content["czardasField"]["candleMeanings"]
    assert len(meanings["candleKeys"]) == len(meanings["timestamps"]) == 240
    assert meanings["evaluationAsOf"] == result.content["asOf"]
    field = result.content["czardasField"]
    domain_ids = {item["domainId"] for item in field["structuralDomains"]}
    assert all(
        item["parentId"] is None or item["parentId"] in domain_ids
        for item in field["structuralDomains"]
    )
    assert all(
        "corridorLow" in glyph and "corridorHigh" in glyph
        and (glyph["corridorLow"] is None or isinstance(glyph["corridorLow"], (int, float)))
        and (glyph["corridorHigh"] is None or isinstance(glyph["corridorHigh"], (int, float)))
        for glyph in field["validationGlyphs"]
    )


def test_real_daily_corpus_does_not_regress_v4_pattern_coverage():
    detected = 0
    for symbol in SYMBOLS:
        result = analyze_czardas(_daily(symbol)[-240:])
        assert isinstance(result, Ready), getattr(result, "reason", None)
        detected += len(result.content["patternRelations"])

    assert detected >= 4


@pytest.mark.parametrize("symbol", ("AAPL", "NVDA"))
def test_real_weekly_corpus_is_deterministic_without_line_position_oracles(symbol: str):
    rows = _weekly(symbol)[-240:]
    assert len(rows) == 240

    first = analyze_czardas(rows)
    second = analyze_czardas(rows)

    assert isinstance(first, Ready), getattr(first, "reason", None)
    assert isinstance(second, Ready), getattr(second, "reason", None)
    assert first.content["interval"] == "1W"
    assert canonical_digest(first.content) == canonical_digest(second.content)
