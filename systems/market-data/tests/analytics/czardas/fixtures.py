from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone


def oscillating_rows(*, volume_scale: float = 1.0, count: int = 240):
    rows = []
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    for index in range(count):
        phase = index % 30
        center = 105.0 + 2.5 * math.sin(2 * math.pi * phase / 30)
        open_, close = center - 0.2, center + 0.2
        high, low = max(open_, close) + 0.8, min(open_, close) - 0.8
        if phase == 0:
            low, open_, close, high = 100.0, 102.0, 102.5, 103.0
        if phase == 15:
            high, open_, close, low = 110.0, 108.0, 107.5, 107.0
        timestamp = start + timedelta(days=index)
        rows.append(_row(
            timestamp, open_, high, low, close,
            (1000 + (5000 if phase in {0, 15} else index)) * volume_scale,
        ))
    return rows


def flat_rows(*, volume: float = 1_000.0):
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    return [_row(start + timedelta(days=index), 100.0, 100.5, 99.5, 100.0, volume) for index in range(240)]


def regime_shift_rows():
    """Long quiet structure followed by a distinct current local flow."""

    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    rows = []
    for index in range(240):
        if index < 160:
            close = 100.0 + 0.02 * index + 2.0 * ((index % 16) / 15.0 - 0.5)
        else:
            close = 103.2 + 0.35 * (index - 160) + 1.2 * ((index % 10) / 9.0 - 0.5)
        rows.append(_row(
            start + timedelta(days=index), close - 0.2, close + 0.8,
            close - 0.8, close, 1_000.0,
        ))
    return rows


def _row(timestamp, open_, high, low, close, volume):
    return {
        "symbol": "TEST",
        "interval": "1D",
        "timestamp": timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "candleKey": timestamp.date().isoformat(),
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
        "isClosed": True,
        "canonicalVersion": "v2",
        "priceAdjustment": "split",
        "marketSession": "regular",
    }
