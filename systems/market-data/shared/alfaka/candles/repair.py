"""Canonical Alpaca-to-ClickHouse candle repair.

The runner only materializes requested canonical candle identities.  It has no
knowledge of Czardas candidates or any previous chart-analysis engine.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Callable

from alfaka.backfill.gapfill import TradingCalendar
from alfaka.backfill.runner import (
    BackfillUnavailable,
    fetch_alpaca_bars,
    historical_feed_for_symbol,
    raw_bars_to_processed_candles,
    repair_daily_bar_outliers,
)
from alfaka.candles.canonical import (
    ADJUSTMENT_POLICY,
    INTRADAY_CANDLE_INTERVALS,
    canonicalize_candle_identity,
)
from alfaka.serving.intervals import (
    alpaca_timeframe_for_interval,
    historical_source_interval_for,
)
from alfaka.serving.session_buckets import aggregate_regular_session_candles
from alfaka.serving.time_utils import parse_utc_time
from alfaka.storage.clickhouse_loader import ClickHouseHttpClient, candle_to_clickhouse_row


CANONICAL_REPAIR_FEED_PROFILE_SUFFIX = "canonical-split-repair"


class CanonicalRepairError(RuntimeError):
    reason_code = "provider_failed"
    public_message = "Historical candle provider request failed."

    def __init__(self) -> None:
        super().__init__(self.public_message)


class RepairCredentialsMissing(CanonicalRepairError):
    reason_code = "credentials_missing"
    public_message = "Historical candle provider credentials are not configured."


class RepairProviderEmpty(CanonicalRepairError):
    reason_code = "provider_empty"
    public_message = "Historical candle provider returned no matching completed candles."


class RepairProviderFailed(CanonicalRepairError):
    reason_code = "provider_failed"


class CanonicalCandleRepairRunner:
    """Fetch one bounded range and materialize only its missing candle keys."""

    def __init__(
        self,
        *,
        clickhouse_client: Any | None = None,
        fetcher: Callable[..., list[dict[str, Any]]] | None = None,
        calendar: TradingCalendar | None = None,
    ) -> None:
        self.clickhouse_client = clickhouse_client or ClickHouseHttpClient(
            url=os.getenv("CLICKHOUSE_HTTP_URL", "http://localhost:8123"),
            database=os.getenv("CLICKHOUSE_DATABASE", "market_data"),
            user=os.getenv("CLICKHOUSE_USER", "alfaka"),
            password=os.getenv("CLICKHOUSE_PASSWORD", "alfaka"),
        )
        self.fetcher = fetcher or fetch_alpaca_bars
        # This contract is code-owned. Czardas repair must not change because
        # an API or worker pod happens to carry MARKET_* environment overrides.
        self.calendar = calendar or TradingCalendar()

    def run(self, record: dict[str, Any]) -> dict[str, Any]:
        symbol = str(record["symbol"]).upper()
        interval = str(record["interval"])
        # Exact canonical repair always rebuilds intraday buckets from 1Min.
        # Reusing a coarser display/history source (for example 10Min for 1h)
        # can hide an interior missing minute and makes early-close buckets
        # dependent on the provider's aggregation policy.
        source_interval = (
            "1m"
            if interval in INTRADAY_CANDLE_INTERVALS and interval != "1m"
            else historical_source_interval_for(interval)
        )
        requested_range = record["range"]
        feed = historical_feed_for_symbol(
            symbol,
            os.getenv("HISTORICAL_FEED", os.getenv("ALPACA_FEED", "sip")),
        )
        try:
            raw_bars = self.fetcher(
                symbol,
                requested_range["start"],
                requested_range["end"],
                feed,
                alpaca_timeframe_for_interval(source_interval),
                adjustment=ADJUSTMENT_POLICY,
            )
        except BackfillUnavailable as exc:
            if "credential" in str(exc).lower():
                raise RepairCredentialsMissing() from None
            raise RepairProviderFailed() from None
        except Exception:
            raise RepairProviderFailed() from None
        if not raw_bars:
            raise RepairProviderEmpty()

        try:
            source_bars = (
                repair_daily_bar_outliers(
                    symbol,
                    raw_bars,
                    feed,
                    fetcher=self.fetcher,
                    adjustment=ADJUSTMENT_POLICY,
                )
                if source_interval == "1D"
                else raw_bars
            )
            source_candles = raw_bars_to_processed_candles(
                symbol,
                source_bars,
                feed=feed,
                interval=source_interval,
                # Czardas reads only split-adjusted canonical rows. Repair must
                # not inherit an environment-specific adjustment that its
                # re-read will intentionally reject.
                price_adjustment=ADJUSTMENT_POLICY,
            )
        except BackfillUnavailable as exc:
            if "credential" in str(exc).lower():
                raise RepairCredentialsMissing() from None
            raise RepairProviderFailed() from None
        except Exception:
            raise RepairProviderFailed() from None
        regular_source = _canonical_regular_source(
            source_candles,
            source_interval=source_interval,
            calendar=self.calendar,
        )
        if interval in INTRADAY_CANDLE_INTERVALS and source_interval == "1m" and interval != "1m":
            range_end = datetime.fromisoformat(str(requested_range["end"]).replace("Z", "+00:00"))
            candles = aggregate_regular_session_candles(
                regular_source,
                interval,
                now=range_end,
                calendar=self.calendar,
            )
        else:
            candles = regular_source

        missing_keys = {str(item) for item in record.get("missingCandleKeys") or [] if item}
        selected: list[dict[str, Any]] = []
        for candle in candles:
            identity = canonicalize_candle_identity(candle, interval)
            if identity is None or (missing_keys and identity["candleKey"] not in missing_keys):
                continue
            if candle.get("marketSession") not in {None, "", "regular"}:
                continue
            selected.append(candle_to_clickhouse_row(candle))
        if not selected:
            raise RepairProviderEmpty()

        source_rows = [candle_to_clickhouse_row(candle) for candle in regular_source]
        try:
            if source_interval != interval and source_rows:
                self.clickhouse_client.insert_json_each_row("chart_candles", source_rows)
            self.clickhouse_client.insert_json_each_row("chart_candles", selected)
        except Exception:
            raise RepairProviderFailed() from None
        return {
            **record,
            "status": "succeeded",
            "result": {
                "source": "alpaca-clickhouse-direct",
                "rawRowCount": len(raw_bars),
                "processedRowCount": len(candles),
                "materializedRowCount": len(selected),
                "sourceInterval": source_interval,
                "sourceMaterializedRowCount": len(source_rows) if source_interval != interval else 0,
            },
        }


def _canonical_regular_source(
    candles: list[dict[str, Any]],
    *,
    source_interval: str,
    calendar: TradingCalendar,
) -> list[dict[str, Any]]:
    """Apply the canonical NYSE time contract and durable repair identity.

    The dedicated feed profile keeps split/v2 repair rows physically distinct
    on pre-migration ReplacingMergeTree tables whose sorting key predates the
    canonical version and price-adjustment columns.
    """
    result: list[dict[str, Any]] = []
    for candle in candles:
        if source_interval in INTRADAY_CANDLE_INTERVALS and not _in_regular_session(candle, calendar):
            continue
        profile = str(candle.get("feedProfile") or candle.get("feed") or "unknown")
        result.append(
            {
                **candle,
                "marketSession": "regular",
                "feedProfile": f"{profile}-{CANONICAL_REPAIR_FEED_PROFILE_SUFFIX}",
            }
        )
    return result


def _in_regular_session(candle: dict[str, Any], calendar: TradingCalendar) -> bool:
    parsed = parse_utc_time(candle.get("timestamp") or candle.get("eventTime"))
    if parsed is None:
        return False
    local = parsed.astimezone(calendar.timezone)
    session_day = local.date()
    if not calendar.is_session_date(session_day):
        return False
    return calendar.open_time <= local.time().replace(tzinfo=None) < calendar.session_close_for(session_day)


__all__ = [
    "CANONICAL_REPAIR_FEED_PROFILE_SUFFIX",
    "CanonicalCandleRepairRunner",
    "CanonicalRepairError",
    "RepairCredentialsMissing",
    "RepairProviderEmpty",
    "RepairProviderFailed",
]
