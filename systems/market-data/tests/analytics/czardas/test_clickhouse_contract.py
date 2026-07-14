from __future__ import annotations

from alfaka.analytics.czardas.data import CzardasCandleLoader
from alfaka.serving.clickhouse_provider import ClickHouseMarketDataProvider


class RecordingProvider(ClickHouseMarketDataProvider):
    def __init__(self):
        super().__init__(url="http://unused", database="market_data", user="test", password="test")
        self.query = ""
        self.params = {}

    def query_json_each_row(self, query, params=None):
        self.query = query
        self.params = params or {}
        return []


def test_czardas_sql_eligibility_is_explicit_when_serving_flag_is_disabled(monkeypatch):
    monkeypatch.setenv("CLICKHOUSE_REQUIRE_CANONICAL_CANDLES", "false")
    provider = RecordingProvider()

    provider.canonical_completed_rows("NVDA", "5m", limit=240)

    assert "canonical_version = 'v2'" in provider.query
    assert "price_adjustment = 'split'" in provider.query
    assert "market_session = 'regular'" in provider.query
    assert "is_closed = 1" in provider.query
    assert "bucket_policy = {bucketPolicy:String}" in provider.query
    assert provider.params["limit"] == 240
    assert provider.params["bucketPolicy"] == "us_equity_regular_session"


def test_czardas_identity_reader_never_runs_schema_ddl(monkeypatch):
    monkeypatch.setenv("CLICKHOUSE_PROVIDER_ENSURE_SESSION_COLUMNS", "true")
    calls = []
    monkeypatch.setattr(
        ClickHouseMarketDataProvider,
        "ensure_market_data_schema",
        lambda self: calls.append(self),
    )

    loader = CzardasCandleLoader()

    assert isinstance(loader.provider, ClickHouseMarketDataProvider)
    assert calls == []


def test_chart_serving_queries_project_canonical_provenance_for_snapshot_identity():
    provider = RecordingProvider()

    provider.stored_interval_candles("NVDA", "5m", limit=241)

    assert "price_adjustment AS priceAdjustment" in provider.query
    assert "canonical_version AS canonicalVersion" in provider.query

    provider.daily_candles("NVDA", "1D", limit=241)

    assert "price_adjustment AS priceAdjustment" in provider.query
    assert "canonical_version AS canonicalVersion" in provider.query
