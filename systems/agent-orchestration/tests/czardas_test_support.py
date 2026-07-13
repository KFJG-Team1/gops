from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from alfaka.analytics.czardas import Ready, analyze_czardas


ROOT = Path(__file__).resolve().parents[3]


def valid_flat_pack(*, symbol: str = "NVDA", interval: str = "1D") -> dict:
    return deepcopy(_valid_flat_pack(symbol.upper(), interval))


def valid_flat_rows(*, symbol: str = "NVDA", interval: str = "1D") -> list[dict]:
    return deepcopy(list(_valid_flat_rows(symbol.upper(), interval)))


def valid_market_pack(*, fixture: str = "msft-1d.json") -> dict:
    """Return a non-flat frozen market pack for authoritative contract mutants."""

    return deepcopy(_valid_market_pack(fixture))


@lru_cache(maxsize=8)
def _valid_market_pack(fixture: str) -> dict:
    path = ROOT / "systems" / "market-data" / "tests" / "fixtures" / "czardas_v2" / "market" / fixture
    rows = json.loads(path.read_text(encoding="utf-8"))[-240:]
    for row in rows:
        row["interval"] = "1D"
        row["candleKey"] = row["timestamp"][:10]
    result = analyze_czardas(rows)
    assert isinstance(result, Ready)
    return result.content


@lru_cache(maxsize=4)
def _valid_flat_pack(symbol: str, interval: str) -> dict:
    result = analyze_czardas(_valid_flat_rows(symbol, interval))
    assert isinstance(result, Ready)
    return result.content


@lru_cache(maxsize=4)
def _valid_flat_rows(symbol: str, interval: str) -> tuple[dict, ...]:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    rows = []
    for index in range(240):
        timestamp = start + timedelta(days=index)
        rows.append({
            "symbol": symbol,
            "interval": interval,
            "timestamp": timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "candleKey": timestamp.date().isoformat(),
            "open": 100.0,
            "high": 100.5,
            "low": 99.5,
            "close": 100.0,
            "volume": 1_000.0,
            "isClosed": True,
            "canonicalVersion": "v2",
            "priceAdjustment": "split",
            "marketSession": "regular",
        })
    return tuple(rows)


def stored_record(pack: dict) -> dict:
    return {
        "pack": pack,
        "generatedAt": "2026-07-11T00:00:00.000Z",
        "inputDigest": pack["inputDigest"],
        "lastCandleKey": pack["lastCandleKey"],
        "algorithmVersion": pack["algorithmVersion"],
        "configVersion": pack["configVersion"],
        "timeContractVersion": pack["timeContractVersion"],
        "calendarVersion": pack["calendarVersion"],
        "fieldSchemaVersion": pack["czardasField"]["schemaVersion"],
    }
