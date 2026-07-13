from __future__ import annotations

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
