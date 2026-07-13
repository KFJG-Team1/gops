import json
import unittest

from alfaka.storage.s3_manifest import (
    bounded_v2_processed_candle_keys,
    bounded_v2_raw_keys,
    entry_matches_range,
    select_preferred_manifest_entries,
)
from alfaka.storage.s3_materializer import (
    commit_prepared_s3_processed_objects,
    materialize_s3_processed_objects,
    prepare_s3_processed_objects,
)
from alfaka.storage.s3_realtime_layout import symbol_shard


class S3V2DualReaderTest(unittest.TestCase):
    def test_processed_reader_lists_only_requested_hour_and_symbol_shard(self):
        shard = symbol_shard("AAPL")
        matching = (
            "market-data/rebuild-20260702-lazy-v1/final-v2/candles/interval=1m/"
            f"date=2026-07-08/hour=13/shard={shard}/part-20260708T1330Z-digest.parquet"
        )
        outside = matching.replace("T1330Z", "T1329Z")
        s3 = _S3([matching, outside, matching.replace(f"shard={shard}", "shard=00")])
        metrics = {}

        keys = bounded_v2_processed_candle_keys(
            s3,
            "bucket",
            "market-data/rebuild-20260702-lazy-v1/final",
            "AAPL",
            "1m",
            "2026-07-08T13:30:15.000Z",
            "2026-07-08T13:30:45.000Z",
            metrics=metrics,
        )

        self.assertEqual(keys, [matching])
        self.assertEqual(len(s3.prefixes), 1)
        self.assertEqual(metrics, {"listCalls": 1, "objectsListed": 2, "objectsOutsideRange": 1})

    def test_raw_reader_lists_channel_hour_and_symbol_shard(self):
        shard = symbol_shard("NVDA")
        matching = (
            "market-data/rebuild-20260702-lazy-v1/raw-v2/alpaca/channel=bars/"
            f"date=2026-07-08/hour=13/shard={shard}/part-20260708T1330Z-digest.jsonl"
        )
        s3 = _S3([matching])
        metrics = {}

        keys = bounded_v2_raw_keys(
            s3,
            "bucket",
            "market-data/rebuild-20260702-lazy-v1/raw/alpaca",
            "NVDA",
            ["bars"],
            "2026-07-08T13:00:00.000Z",
            "2026-07-08T14:00:00.000Z",
            metrics=metrics,
        )

        self.assertEqual(keys, [matching])
        self.assertEqual(metrics, {"listCalls": 1, "objectsListed": 1})

    def test_materializer_dedupes_mixed_objects_before_one_insert_and_counts_request_matches(self):
        first_key = "final/candles/aapl-v1.jsonl"
        second_key = "final-v2/candles/aapl-shard.jsonl"
        first = _candle("AAPL", "2026-07-08T13:30:00.000Z", close=100, source_event_id="first")
        second = _candle("AAPL", "2026-07-08T13:30:00.000Z", close=101, source_event_id="second")
        other_symbol = _candle("MSFT", "2026-07-08T13:30:00.000Z", close=200, source_event_id="msft")
        s3 = _ObjectS3({
            first_key: [first],
            second_key: [second, other_symbol],
        })
        client = _RecordingClient()

        result = materialize_s3_processed_objects(
            client,
            s3,
            "bucket",
            [first_key, second_key],
            selection={
                "symbol": "AAPL",
                "interval": "1m",
                "start": "2026-07-08T13:30:00.000Z",
                "end": "2026-07-08T13:31:00.000Z",
            },
        )

        candle_inserts = [rows for table, rows in client.inserts if table == "chart_candles"]
        self.assertEqual(len(candle_inserts), 1)
        self.assertEqual(len(candle_inserts[0]), 2)
        self.assertEqual(next(row for row in candle_inserts[0] if row["symbol"] == "AAPL")["close"], 101)
        self.assertEqual(result["rowCount"], 2)
        self.assertEqual(result["matchedRowCount"], 1)
        self.assertEqual([table for table, _rows in client.inserts][0], "chart_candles")
        self.assertEqual(sum(1 for table, _rows in client.inserts if table == "storage_object_audit"), 2)

    def test_materializer_reports_zero_matches_without_filtering_shared_object_rows(self):
        key = "final-v2/candles/shared-shard.jsonl"
        s3 = _ObjectS3({key: [_candle("MSFT", "2026-07-08T13:30:00.000Z", close=200, source_event_id="msft")]})
        client = _RecordingClient()

        result = materialize_s3_processed_objects(
            client,
            s3,
            "bucket",
            [key],
            selection={
                "symbol": "AAPL",
                "interval": "1m",
                "start": "2026-07-08T13:30:00.000Z",
                "end": "2026-07-08T13:31:00.000Z",
            },
        )

        self.assertEqual(result["rowCount"], 1)
        self.assertEqual(result["matchedRowCount"], 0)
        self.assertEqual(client.inserts[0][1][0]["symbol"], "MSFT")

    def test_canonical_repair_can_rematerialize_an_object_with_a_surviving_load_audit(self):
        key = "final/candles/aapl-v1.jsonl"
        candle = _candle("AAPL", "2026-07-08T13:30:00.000Z", close=101, source_event_id="repair")
        s3 = _ObjectS3({key: [candle]})
        client = _RecordingClient(already_materialized={f"s3://bucket/{key}"})

        result = materialize_s3_processed_objects(
            client,
            s3,
            "bucket",
            [key],
            selection={
                "symbol": "AAPL",
                "interval": "1m",
                "start": "2026-07-08T13:30:00.000Z",
                "end": "2026-07-08T13:31:00.000Z",
            },
            force_rematerialize=True,
        )

        self.assertEqual(result["matchedRowCount"], 1)
        candle_inserts = [rows for table, rows in client.inserts if table == "chart_candles"]
        self.assertEqual(len(candle_inserts), 1)
        self.assertEqual(candle_inserts[0][0]["symbol"], "AAPL")

    def test_canonical_repair_filters_shared_object_to_requested_symbol_and_ranges(self):
        key = "final-v2/candles/shared-shard.jsonl"
        requested = {**_candle("AAPL", "2026-07-08T00:00:00.000Z", close=101, source_event_id="requested"), "interval": "1D", "createdAt": "2026-07-08T20:00:00.000Z"}
        corrected = {**_candle("AAPL", "2026-07-08T04:00:00.000Z", close=103, source_event_id="corrected"), "interval": "1D", "createdAt": "2026-07-09T20:00:00.000Z"}
        outside_range = {**_candle("AAPL", "2026-07-09T00:00:00.000Z", close=102, source_event_id="outside"), "interval": "1D"}
        other_symbol = {**_candle("MSFT", "2026-07-08T00:00:00.000Z", close=200, source_event_id="other"), "interval": "1D"}
        s3 = _ObjectS3({key: [requested, corrected, outside_range, other_symbol]})
        client = _RecordingClient(already_materialized={f"s3://bucket/{key}"})

        prepared = prepare_s3_processed_objects(
            client,
            s3,
            "bucket",
            [key],
            selection={
                "symbol": "AAPL",
                "interval": "1D",
                "start": "2026-07-08T04:00:00.000Z",
                "end": "2026-07-09T04:00:00.000Z",
            },
            force_rematerialize=True,
            filter_to_selection=True,
        )
        result = commit_prepared_s3_processed_objects(
            client,
            prepared,
            source_name="canonical-candle-repair-s3-processed",
            write_object_audits=False,
        )

        candle_inserts = [rows for table, rows in client.inserts if table == "chart_candles"]
        self.assertEqual(result["rowCount"], 1)
        self.assertEqual(result["matchedRowCount"], 1)
        self.assertEqual([(row["symbol"], row["close"]) for row in candle_inserts[0]], [("AAPL", 103.0)])
        self.assertFalse(any(table in {"storage_object_audit", "load_audit"} for table, _rows in client.inserts))

    def test_daily_manifest_range_matches_canonical_candle_key_not_raw_utc_hour(self):
        base = {
            "symbol": "AAPL",
            "interval": "1D",
            "priceAdjustment": "split",
            "canonicalVersion": "v2",
            "availableFrom": "2026-07-08T00:00:00.000Z",
            "availableTo": "2026-07-08T00:00:00.000Z",
        }
        next_day = {
            **base,
            "availableFrom": "2026-07-09T00:00:00.000Z",
            "availableTo": "2026-07-09T00:00:00.000Z",
        }

        self.assertTrue(entry_matches_range(
            base, "AAPL", "1D", "2026-07-08T04:00:00.000Z", "2026-07-09T04:00:00.000Z",
        ))
        self.assertFalse(entry_matches_range(
            next_day, "AAPL", "1D", "2026-07-08T04:00:00.000Z", "2026-07-09T04:00:00.000Z",
        ))

    def test_equal_coverage_prefers_latest_correction_revision(self):
        common = {
            "symbol": "AAPL", "interval": "1D", "priceAdjustment": "split",
            "canonicalVersion": "v2", "objectFormat": "parquet",
            "availableFrom": "2026-07-08T04:00:00.000Z",
            "availableTo": "2026-07-08T04:00:00.000Z",
        }
        base = {**common, "objectKey": "final/candles/AAPL/canonical=v2.parquet", "createdAt": "2026-07-08T21:00:00.000Z"}
        revision = {**common, "objectKey": "final/candles/AAPL/revisions/revision=20260709/canonical=v2.parquet", "createdAt": "2026-07-09T21:00:00.000Z"}

        selected = select_preferred_manifest_entries(
            [base, revision], "2026-07-08T04:00:00.000Z", "2026-07-09T04:00:00.000Z",
        )

        self.assertEqual([item["objectKey"] for item in selected], [revision["objectKey"]])


class _S3:
    def __init__(self, keys):
        self.keys = keys
        self.prefixes = []

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        del Bucket, ContinuationToken
        self.prefixes.append(Prefix)
        return {
            "Contents": [{"Key": key} for key in self.keys if key.startswith(Prefix)],
            "IsTruncated": False,
        }


class _Body:
    def __init__(self, value):
        self.value = value

    def read(self):
        return self.value


class _ObjectS3:
    def __init__(self, objects):
        self.objects = objects

    def get_object(self, Bucket, Key):
        del Bucket
        body = "\n".join(json.dumps(row, separators=(",", ":")) for row in self.objects[Key]).encode()
        return {"Body": _Body(body), "ContentType": "application/x-ndjson"}


class _RecordingClient:
    def __init__(self, *, already_materialized=None):
        self.inserts = []
        self.already_materialized = set(already_materialized or [])

    def insert_json_each_row(self, table, rows):
        self.inserts.append((table, rows))

    def s3_object_already_materialized(self, object_path):
        return object_path in self.already_materialized


def _candle(symbol, timestamp, *, close, source_event_id):
    return {
        "eventType": "CANDLE",
        "symbol": symbol,
        "interval": "1m",
        "timestamp": timestamp,
        "open": close,
        "high": close + 1,
        "low": close - 1,
        "close": close,
        "volume": 10,
        "isClosed": True,
        "sourceEventId": source_event_id,
        "priceAdjustment": "split",
        "canonicalVersion": "v2",
    }


if __name__ == "__main__":
    unittest.main()
