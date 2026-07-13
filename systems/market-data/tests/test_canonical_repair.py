from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
SHARED = ROOT / "systems" / "market-data" / "shared"
if str(SHARED) not in sys.path:
    sys.path.insert(0, str(SHARED))

from alfaka.backfill.runner import BackfillUnavailable  # noqa: E402
from alfaka.candles.repair import (  # noqa: E402
    CanonicalCandleRepairRunner,
    RepairCredentialsMissing,
    RepairProviderEmpty,
    RepairProviderFailed,
)


class ClickHouseClient:
    def __init__(self):
        self.inserts = []

    def insert_json_each_row(self, table, rows):
        self.inserts.append((table, rows))


def _record():
    return {
        "requestId": "cza-repair",
        "symbol": "AAPL",
        "interval": "1h",
        "range": {
            "start": "2026-07-10T13:30:00.000Z",
            "end": "2026-07-10T14:30:00.000Z",
        },
        "missingCandleKeys": ["2026-07-10T13:30:00.000Z"],
    }


def test_runner_materializes_source_and_requested_canonical_interval():
    client = ClickHouseClient()
    calls = []

    def fetcher(symbol, start, end, feed, timeframe, *, adjustment):
        calls.append((symbol, start, end, feed, timeframe, adjustment))
        return [
            {"t": "2026-07-10T13:30:00.000Z", "o": 100, "h": 102, "l": 99, "c": 101, "v": 10},
            {"t": "2026-07-10T14:29:00.000Z", "o": 101, "h": 104, "l": 100, "c": 103, "v": 20},
        ]

    outcome = CanonicalCandleRepairRunner(clickhouse_client=client, fetcher=fetcher).run(_record())

    assert calls[0][-2:] == ("1Min", "split")
    assert [table for table, _rows in client.inserts] == ["chart_candles", "chart_candles"]
    assert {row["interval"] for row in client.inserts[0][1]} == {"1m"}
    assert client.inserts[1][1][0]["interval"] == "1h"
    assert client.inserts[1][1][0]["price_adjustment"] == "split"
    assert client.inserts[1][1][0]["feed_profile"] == "sip-canonical-split-repair"
    assert outcome["result"]["materializedRowCount"] == 1


def test_runner_uses_injected_fetcher_and_split_for_daily_outlier_repair(monkeypatch):
    monkeypatch.setenv("DAILY_BAR_1M_REPAIR_ENABLED", "true")
    client = ClickHouseClient()
    calls = []

    def fetcher(symbol, start, end, feed, timeframe, *, adjustment):
        calls.append((symbol, start, end, feed, timeframe, adjustment))
        if timeframe == "1Day":
            return [{"t": "2026-07-10T04:00:00.000Z", "o": 100, "h": 1000, "l": 99, "c": 101, "v": 10, "vw": 101}]
        return [{"t": "2026-07-10T13:30:00.000Z", "o": 100, "h": 103, "l": 99, "c": 101, "v": 10}]

    record = {
        "symbol": "AAPL",
        "interval": "1D",
        "range": {"start": "2026-07-10T00:00:00.000Z", "end": "2026-07-11T00:00:00.000Z"},
        "missingCandleKeys": ["2026-07-10"],
    }
    CanonicalCandleRepairRunner(clickhouse_client=client, fetcher=fetcher).run(record)

    assert [call[-2:] for call in calls] == [("1Day", "split"), ("1Min", "split")]
    assert client.inserts[0][1][0]["feed_profile"] == "sip-canonical-split-repair"


def test_runner_uses_code_owned_nyse_session_instead_of_raw_env_label(monkeypatch):
    monkeypatch.setattr("alfaka.backfill.runner.market_session_for_timestamp", lambda _value: "after")
    client = ClickHouseClient()
    record = {
        "symbol": "AAPL",
        "interval": "1m",
        "range": {"start": "2026-07-10T13:30:00.000Z", "end": "2026-07-10T13:31:00.000Z"},
        "missingCandleKeys": ["2026-07-10T13:30:00.000Z"],
    }
    runner = CanonicalCandleRepairRunner(
        clickhouse_client=client,
        fetcher=lambda *_args, **_kwargs: [
            {"t": "2026-07-10T13:30:00.000Z", "o": 100, "h": 102, "l": 99, "c": 101, "v": 10}
        ],
    )

    runner.run(record)

    assert client.inserts[0][1][0]["market_session"] == "regular"


def test_runner_classifies_missing_credentials_without_exposing_values():
    def fetcher(*_args, **_kwargs):
        raise BackfillUnavailable("Alpaca credentials are not configured: SECRET")

    runner = CanonicalCandleRepairRunner(clickhouse_client=ClickHouseClient(), fetcher=fetcher)
    with pytest.raises(RepairCredentialsMissing) as caught:
        runner.run(_record())
    assert caught.value.reason_code == "credentials_missing"
    assert "SECRET" not in str(caught.value)


def test_runner_classifies_empty_and_provider_failure():
    empty = CanonicalCandleRepairRunner(
        clickhouse_client=ClickHouseClient(),
        fetcher=lambda *_args, **_kwargs: [],
    )
    with pytest.raises(RepairProviderEmpty) as caught:
        empty.run(_record())
    assert caught.value.reason_code == "provider_empty"

    def failed(*_args, **_kwargs):
        raise RuntimeError("https://provider.invalid?secret=do-not-leak")

    unavailable = CanonicalCandleRepairRunner(
        clickhouse_client=ClickHouseClient(),
        fetcher=failed,
    )
    with pytest.raises(RepairProviderFailed) as caught:
        unavailable.run(_record())
    assert caught.value.reason_code == "provider_failed"
    assert "do-not-leak" not in str(caught.value)
