from __future__ import annotations

from datetime import datetime, timezone

from alfaka.analytics.czardas.data import CzardasCandleLoader
from alfaka.backfill.gapfill import TradingCalendar


NOW = datetime(2026, 7, 13, 20, 0, tzinfo=timezone.utc)


class Provider:
    def __init__(self) -> None:
        self.rows = []
        self.calls = []

    def canonical_completed_rows(self, symbol, interval, limit=240, before=None):
        self.calls.append((symbol, interval, limit, before))
        return list(self.rows[-limit:])


def _row(timestamp: str, interval: str = "5m") -> dict:
    return {
        "symbol": "NVDA",
        "interval": interval,
        "timestamp": timestamp,
        "candleKey": timestamp,
        "open": 100.0,
        "high": 101.0,
        "low": 99.0,
        "close": 100.25,
        "volume": 1_000_000.0,
        "isClosed": True,
        "canonicalVersion": "v2",
        "priceAdjustment": "split",
        "marketSession": "regular",
    }


def test_exact_expected_window_is_ready_and_identity_is_reproducible():
    provider = Provider()
    loader = CzardasCandleLoader(
        provider,
        now_provider=lambda: NOW,
        calendar=TradingCalendar(),
    )
    expected = loader._expected_keys("5m", NOW)
    provider.rows = [_row(key) for key in expected]

    window = loader.load("nvda", "5m")

    assert window.ready
    assert len(window.rows) == 240
    assert window.missing_keys == ()
    assert loader.current_identity("NVDA", "5m") == {
        "inputDigest": window.input_digest,
        "lastCandleKey": window.last_candle_key,
        "actualCompleted": 240,
    }


def test_interior_gap_is_not_hidden_by_an_older_241st_row():
    provider = Provider()
    loader = CzardasCandleLoader(provider, now_provider=lambda: NOW, calendar=TradingCalendar())
    expected = loader._expected_keys("5m", NOW)
    provider.rows = [_row("2026-07-01T13:30:00.000Z"), *[_row(key) for key in expected if key != expected[100]]]

    window = loader.load("NVDA", "5m")

    assert not window.ready
    assert window.missing_keys == (expected[100],)
    assert len(window.repair_gaps) == 1
    assert window.repair_gaps[0].missing_keys == (expected[100],)


def test_calendar_contract_ignores_environment_configuration(monkeypatch):
    monkeypatch.setenv("MARKET_TIMEZONE", "Asia/Seoul")
    monkeypatch.setenv("MARKET_OPEN_TIME", "01:00")
    loader = CzardasCandleLoader(Provider(), now_provider=lambda: NOW)

    assert loader.calendar.timezone_name == "America/New_York"
    assert loader.calendar.open_time.isoformat() == "09:30:00"


def test_nyse_dst_and_early_close_bucket_starts_are_code_owned():
    provider = Provider()
    loader = CzardasCandleLoader(provider, now_provider=lambda: NOW, calendar=TradingCalendar())
    before_dst = loader._expected_keys("1m", datetime(2026, 3, 6, 21, 1, tzinfo=timezone.utc))[-1]
    after_dst = loader._expected_keys("1m", datetime(2026, 3, 9, 20, 1, tzinfo=timezone.utc))[-1]
    early_close = loader._expected_keys("4h", datetime(2026, 11, 27, 19, 0, tzinfo=timezone.utc))[-1]

    assert before_dst.startswith("2026-03-06T20:59")
    assert after_dst.startswith("2026-03-09T19:59")
    assert early_close == "2026-11-27T14:30:00.000Z"
