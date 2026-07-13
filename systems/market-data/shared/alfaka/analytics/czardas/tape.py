from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

from .config import CzardasConfig
from .numeric import canonical_digest
from .types import Candle


@dataclass(frozen=True, slots=True)
class CandleTape:
    symbol: str
    interval: str
    candles: tuple[Candle, ...]
    input_digest: str

    @property
    def as_of(self) -> str:
        return self.candles[-1].timestamp

    @property
    def last_candle_key(self) -> str:
        return self.candles[-1].candle_key

    @classmethod
    def from_rows(cls, rows: Iterable[dict[str, Any]], config: CzardasConfig) -> "CandleTape":
        source = list(rows)
        if len(source) != config.target_completed_bars:
            raise ValueError(f"expected_exactly_{config.target_completed_bars}_completed_candles")
        candles: list[Candle] = []
        for index, row in enumerate(source):
            symbol = str(row.get("symbol") or "").strip().upper()
            interval = str(row.get("interval") or "").strip()
            timestamp = _utc_timestamp(row.get("timestamp") or row.get("event_time"))
            candle_key = str(row.get("candleKey") or row.get("candle_key") or timestamp)
            values = tuple(float(row.get(key)) for key in ("open", "high", "low", "close", "volume"))
            if not symbol or not interval or not all(math.isfinite(value) for value in values):
                raise ValueError("invalid_candle_identity_or_numeric")
            open_, high, low, close, volume = values
            if low > min(open_, close) or high < max(open_, close) or low > high or volume < 0:
                raise ValueError("invalid_ohlcv")
            if row.get("isClosed", row.get("is_closed", True)) is not True:
                raise ValueError("live_candle_in_inference")
            if str(row.get("canonicalVersion", row.get("canonical_version", "v2"))) != "v2":
                raise ValueError("incompatible_canonical_version")
            if str(row.get("priceAdjustment", row.get("price_adjustment", "split"))) != "split":
                raise ValueError("incompatible_price_adjustment")
            if str(row.get("marketSession", row.get("market_session", "regular"))) != "regular":
                raise ValueError("incompatible_market_session")
            candles.append(Candle(symbol, interval, candle_key, timestamp, index, open_, high, low, close, volume))
        if len({item.symbol for item in candles}) != 1 or len({item.interval for item in candles}) != 1:
            raise ValueError("mixed_symbol_or_interval")
        identities = [(item.timestamp, item.candle_key) for item in candles]
        if identities != sorted(identities) or len({item.candle_key for item in candles}) != len(candles):
            raise ValueError("noncontiguous_or_duplicate_identity")
        payload = [{
            "symbol": item.symbol,
            "interval": item.interval,
            "candleKey": item.candle_key,
            "timestamp": item.timestamp,
            "open": item.open,
            "high": item.high,
            "low": item.low,
            "close": item.close,
            "volume": item.volume,
        } for item in candles]
        return cls(candles[0].symbol, candles[0].interval, tuple(candles), canonical_digest(payload))


def _utc_timestamp(value: Any) -> str:
    if not value:
        raise ValueError("missing_timestamp")
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("naive_timestamp")
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
