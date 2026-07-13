from __future__ import annotations

import sys
import unittest
from datetime import datetime, time, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SHARED = ROOT / "systems" / "market-data" / "shared"
if str(SHARED) not in sys.path:
    sys.path.insert(0, str(SHARED))

from alfaka.backfill.gapfill import TradingCalendar  # noqa: E402
from alfaka.candles import (  # noqa: E402
    CANDLE_CONTRACT_VERSION,
    aggregate_canonical_candle_bundle,
    aggregate_canonical_candles,
    canonicalize_candle_identity,
    choose_canonical_winner,
    is_candle_bucket_complete,
    merge_canonical_candles,
)


class CanonicalCandleContractTest(unittest.TestCase):
    def test_daily_timestamp_is_market_midnight_across_dst(self):
        winter = canonicalize_candle_identity(candle("2026-01-05T00:00:00.000Z"), "1D")
        summer = canonicalize_candle_identity(candle("2026-07-06T00:00:00.000Z"), "1D")
        self.assertEqual(winter["timestamp"], "2026-01-05T05:00:00.000Z")
        self.assertEqual(summer["timestamp"], "2026-07-06T04:00:00.000Z")
        self.assertEqual((winter["candleKey"], summer["candleKey"]), ("2026-01-05", "2026-07-06"))
        self.assertEqual(CANDLE_CONTRACT_VERSION, "regular-session-derived")

    def test_intraday_identity_preserves_exact_utc_bucket_timestamp(self):
        identity = canonicalize_candle_identity(candle("2026-07-10T13:35:00.000Z"), "5m")
        self.assertEqual(identity["candleKey"], "2026-07-10T13:35:00.000Z")
        self.assertEqual(identity["timestamp"], "2026-07-10T13:35:00.000Z")

    def test_intraday_bucket_is_complete_only_after_its_interval_end(self):
        self.assertFalse(is_candle_bucket_complete(
            "2026-07-10T13:35:00.000Z", "5m",
            now=datetime(2026, 7, 10, 13, 39, 59, tzinfo=timezone.utc),
        ))
        self.assertTrue(is_candle_bucket_complete(
            "2026-07-10T13:35:00.000Z", "5m",
            now=datetime(2026, 7, 10, 13, 40, 0, tzinfo=timezone.utc),
        ))

    def test_weekly_and_monthly_identity_use_utc_bucket_midnight(self):
        weekly = canonicalize_candle_identity(candle("2026-07-06T04:00:00.000Z"), "1W")
        monthly = canonicalize_candle_identity(candle("2026-07-01T04:00:00.000Z"), "1M")
        self.assertEqual((weekly["candleKey"], weekly["timestamp"]), ("2026-07-06", "2026-07-06T00:00:00.000Z"))
        self.assertEqual((monthly["candleKey"], monthly["timestamp"]), ("2026-07", "2026-07-01T00:00:00.000Z"))

    def test_winner_is_order_independent(self):
        older = candle("2026-07-06T00:00:00.000Z", close=100, updatedAt="2026-07-06T21:00:00Z")
        newer = candle("2026-07-06T00:00:00.000Z", close=101, updatedAt="2026-07-06T22:00:00Z")
        self.assertEqual(choose_canonical_winner([older, newer]), choose_canonical_winner([newer, older]))
        self.assertEqual(choose_canonical_winner([older, newer])["close"], 101)

    def test_closed_clickhouse_wins_canonical_and_redis_wins_current(self):
        direct = candle("2026-07-06T00:00:00.000Z", close=100, sourceClass="clickhouse_direct")
        redis = candle("2026-07-06T00:00:00.000Z", close=101, sourceClass="redis_closed")
        self.assertEqual(choose_canonical_winner([direct, redis])["close"], 100)
        merged = merge_canonical_candles([direct], [redis], interval="1D", view="chart_current")
        self.assertEqual(merged[0]["close"], 101)

    def test_weekly_uses_daily_source_and_drops_open_bucket(self):
        rows = [
            candle("2026-06-29T00:00:00.000Z", open=100, high=105, low=99, close=104, volume=10),
            candle("2026-06-30T00:00:00.000Z", open=104, high=108, low=103, close=107, volume=20),
            candle("2026-07-06T00:00:00.000Z", open=107, high=110, low=106, close=109, volume=30),
        ]
        weekly = aggregate_canonical_candles(rows, "1W", now=datetime(2026, 7, 8, tzinfo=timezone.utc))
        self.assertEqual(len(weekly), 1)
        self.assertEqual((weekly[0]["candleKey"], weekly[0]["volume"]), ("2026-06-29", 30))

    def test_bundle_matches_individual_derivation(self):
        rows = [
            candle("2026-06-29T00:00:00.000Z", close=100),
            candle("2026-06-30T00:00:00.000Z", close=101),
        ]
        now = datetime(2026, 7, 11, tzinfo=timezone.utc)
        bundle = aggregate_canonical_candle_bundle(rows, ("1W", "1D"), now=now)
        for interval in ("1W", "1D"):
            self.assertEqual(bundle[interval], aggregate_canonical_candles(rows, interval, now=now))

    def test_weekly_completion_obeys_early_close(self):
        rows = [candle("2026-11-23T00:00:00.000Z")]
        calendar = TradingCalendar(
            closed_dates=frozenset({"2026-11-26"}),
            early_closes={"2026-11-27": time(13, 0)},
        )
        before = aggregate_canonical_candles(
            rows, "1W", now=datetime(2026, 11, 27, 17, 59, tzinfo=timezone.utc), calendar=calendar,
        )
        after = aggregate_canonical_candles(
            rows, "1W", now=datetime(2026, 11, 27, 18, 1, tzinfo=timezone.utc), calendar=calendar,
        )
        self.assertEqual(before, [])
        self.assertEqual(after[0]["candleKey"], "2026-11-23")

    def test_invalid_ohlcv_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "open/close"):
            aggregate_canonical_candles([candle("2026-07-06T00:00:00.000Z", close=103, high=102)], "1D")
        with self.assertRaisesRegex(ValueError, "non-negative"):
            aggregate_canonical_candles([candle("2026-07-06T00:00:00.000Z", volume=-1)], "1D")


def candle(timestamp: str, **values) -> dict:
    result = {
        "symbol": "NVDA",
        "timestamp": timestamp,
        "open": 100,
        "high": 102,
        "low": 99,
        "close": 101,
        "volume": 1000,
        "isClosed": True,
        "canonicalVersion": "v2",
        "priceAdjustment": "split",
        "marketSession": "regular",
        "sourceClass": "clickhouse_direct",
    }
    result.update(values)
    return result


if __name__ == "__main__":
    unittest.main()
