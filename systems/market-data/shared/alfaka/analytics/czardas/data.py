from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from alfaka.analytics.analysis_candles import (
    _expected_intraday_keys,
    _expected_keys_ending,
    _last_expected_key,
    aggregate_analysis_candles,
    canonicalize_candle_identity,
)
from alfaka.backfill.gapfill import TradingCalendar
from alfaka.serving.clickhouse_provider import ClickHouseMarketDataProvider
from alfaka.serving.intervals import INTRADAY_INTERVAL_MINUTES

from .config import CzardasConfig, DEFAULT_CONFIG
from .tape import CandleTape


SUPPORTED_INTERVALS = ("1m", "5m", "10m", "1h", "4h", "1D", "1W")


@dataclass(frozen=True, slots=True)
class RepairGap:
    interval: str
    start: str
    end: str
    missing_keys: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CzardasCandleWindow:
    symbol: str
    interval: str
    rows: tuple[dict[str, Any], ...]
    expected_keys: tuple[str, ...]
    missing_keys: tuple[str, ...]
    repair_gaps: tuple[RepairGap, ...]
    input_digest: str | None
    last_candle_key: str | None

    @property
    def ready(self) -> bool:
        return (
            len(self.rows) == DEFAULT_CONFIG.target_completed_bars
            and not self.missing_keys
            and not self.repair_gaps
            and self.input_digest is not None
        )


class CzardasCandleLoader:
    """Read and normalize the exact latest 240 completed NYSE candles."""

    def __init__(
        self,
        provider: Any | None = None,
        *,
        now_provider: Callable[[], datetime] | None = None,
        calendar: TradingCalendar | None = None,
        config: CzardasConfig = DEFAULT_CONFIG,
    ) -> None:
        self.provider = provider or ClickHouseMarketDataProvider()
        self.now_provider = now_provider or (lambda: datetime.now(timezone.utc))
        # The inference calendar is intentionally not created from environment.
        self.calendar = calendar or TradingCalendar()
        self.config = config

    def load(self, symbol: str, interval: str) -> CzardasCandleWindow:
        symbol = str(symbol).strip().upper()
        interval = str(interval).strip()
        if not symbol or interval not in SUPPORTED_INTERVALS:
            raise ValueError("Unsupported Czardas symbol or interval")
        now = self.now_provider().astimezone(timezone.utc)
        expected = self._expected_keys(interval, now)

        if interval == "1W":
            daily = list(self.provider.canonical_completed_rows(symbol, "1D", limit=1300))
            rows = aggregate_analysis_candles(daily, "1W", now=now, calendar=self.calendar)
            source_expected = self._weekly_source_keys(expected)
            source_actual = {
                str(identity["candleKey"])
                for row in daily
                if (identity := canonicalize_candle_identity(row, "1D")) is not None
            }
            source_missing = tuple(key for key in source_expected if key not in source_actual)
            repair_gaps = self._coalesce(source_expected, source_missing, "1D")
        else:
            rows = list(self.provider.canonical_completed_rows(symbol, interval, limit=self.config.target_completed_bars + 16))
            source_missing = ()
            repair_gaps = ()

        normalized_by_key: dict[str, dict[str, Any]] = {}
        for row in rows:
            identity = canonicalize_candle_identity(row, interval)
            if identity is None:
                continue
            key = str(identity["candleKey"])
            normalized_by_key[key] = {
                **identity,
                "symbol": symbol,
                "interval": interval,
                "isClosed": True,
                "marketSession": "regular",
                "priceAdjustment": "split",
                "canonicalVersion": "v2",
            }
        selected = tuple(normalized_by_key[key] for key in expected if key in normalized_by_key)
        missing = tuple(key for key in expected if key not in normalized_by_key)
        if interval != "1W":
            repair_gaps = self._coalesce(expected, missing, interval)
        elif missing and not source_missing:
            # A weekly aggregate can only be absent when its daily source is
            # absent. Keep a conservative daily repair range for that week.
            source_expected = self._weekly_source_keys(missing)
            source_actual = {
                str(identity["candleKey"])
                for row in daily
                if (identity := canonicalize_candle_identity(row, "1D")) is not None
            }
            source_missing = tuple(key for key in source_expected if key not in source_actual)
            repair_gaps = self._coalesce(source_expected, source_missing, "1D")

        digest = last_key = None
        if len(selected) == self.config.target_completed_bars and not missing:
            try:
                tape = CandleTape.from_rows(selected, self.config)
            except (TypeError, ValueError):
                pass
            else:
                digest = tape.input_digest
                last_key = tape.last_candle_key
        return CzardasCandleWindow(
            symbol=symbol,
            interval=interval,
            rows=selected,
            expected_keys=expected,
            missing_keys=missing,
            repair_gaps=repair_gaps,
            input_digest=digest,
            last_candle_key=last_key,
        )

    def current_identity(self, symbol: str, interval: str) -> dict[str, Any] | None:
        window = self.load(symbol, interval)
        if not window.ready:
            return None
        return {
            "inputDigest": window.input_digest,
            "lastCandleKey": window.last_candle_key,
            "actualCompleted": len(window.rows),
        }

    def _expected_keys(self, interval: str, now: datetime) -> tuple[str, ...]:
        count = self.config.target_completed_bars
        if interval in INTRADAY_INTERVAL_MINUTES:
            return tuple(_expected_intraday_keys(now, count, interval, self.calendar))
        last = _last_expected_key(interval, now, calendar=self.calendar)
        if last is None:
            return ()
        return tuple(_expected_keys_ending(interval, last, count, calendar=self.calendar))

    def _weekly_source_keys(self, weekly_keys: tuple[str, ...]) -> tuple[str, ...]:
        if not weekly_keys:
            return ()
        start = date.fromisoformat(weekly_keys[0])
        end = date.fromisoformat(weekly_keys[-1]) + timedelta(days=7)
        result: list[str] = []
        cursor = start
        while cursor < end:
            if self.calendar.is_session_date(cursor):
                result.append(cursor.isoformat())
            cursor += timedelta(days=1)
        return tuple(result)

    def _coalesce(
        self,
        expected: tuple[str, ...],
        missing: tuple[str, ...],
        interval: str,
    ) -> tuple[RepairGap, ...]:
        missing_set = set(missing)
        groups: list[list[str]] = []
        last_missing_index: int | None = None
        for index, key in enumerate(expected):
            if key not in missing_set:
                continue
            if groups and last_missing_index == index - 1:
                groups[-1].append(key)
            else:
                groups.append([key])
            last_missing_index = index
        return tuple(self._gap(interval, group) for group in groups[:8])

    def _gap(self, interval: str, keys: list[str]) -> RepairGap:
        if interval in INTRADAY_INTERVAL_MINUTES:
            step = timedelta(minutes=INTRADAY_INTERVAL_MINUTES[interval])
            start = datetime.fromisoformat(keys[0].replace("Z", "+00:00"))
            end = datetime.fromisoformat(keys[-1].replace("Z", "+00:00")) + step
        else:
            start_day = date.fromisoformat(keys[0])
            end_day = date.fromisoformat(keys[-1]) + timedelta(days=1)
            start = datetime.combine(start_day, datetime.min.time(), self.calendar.timezone).astimezone(timezone.utc)
            end = datetime.combine(end_day, datetime.min.time(), self.calendar.timezone).astimezone(timezone.utc)
        return RepairGap(
            interval=interval,
            start=start.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            end=end.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            missing_keys=tuple(keys),
        )
