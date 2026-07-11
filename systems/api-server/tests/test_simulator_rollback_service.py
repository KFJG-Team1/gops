import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MARKET_SHARED = ROOT / "systems" / "market-data" / "shared"
BACKEND = ROOT / "systems" / "api-server" / "pods" / "api-server" / "gops-backend"
for path in (str(MARKET_SHARED), str(BACKEND), str(ROOT)):
    if path not in sys.path:
        sys.path.insert(0, path)

from alfaka.common.redis_keys import RedisKeyBuilder
from app.services.simulator_rollback import SimulatorRollbackService


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.hashes = {}
        self.sorted_sets = {}
        self.published = []

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value, *args, **kwargs):
        self.values[key] = value
        return True

    def delete(self, *keys):
        removed = 0
        for key in keys:
            removed += int(key in self.values or key in self.hashes or key in self.sorted_sets)
            self.values.pop(key, None)
            self.hashes.pop(key, None)
            self.sorted_sets.pop(key, None)
        return removed

    def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    def zrange(self, key, start, end, withscores=False):
        rows = sorted(self.sorted_sets.get(key, {}).items(), key=lambda item: item[1])
        if end == -1:
            selected = rows[start:]
        else:
            selected = rows[start:end + 1]
        return selected if withscores else [item[0] for item in selected]

    def zrem(self, key, *members):
        values = self.sorted_sets.setdefault(key, {})
        removed = 0
        for member in members:
            removed += int(member in values)
            values.pop(member, None)
        return removed

    def zadd(self, key, values):
        self.sorted_sets.setdefault(key, {}).update(values)
        return len(values)

    def scan_iter(self, match=None):
        prefix = str(match or "").rstrip("*")
        for key in list(self.values):
            if key.startswith(prefix):
                yield key

    def publish(self, channel, payload):
        self.published.append((channel, payload))


class FakeClickHouse:
    def __init__(self):
        self.executed = []
        self.query_rows = {}

    def execute(self, query, parameters=None):
        self.executed.append((query, parameters or {}))

    def query_json_each_row(self, _query, parameters=None):
        parameters = parameters or {}
        return list(self.query_rows.get((parameters.get("symbol"), parameters.get("interval")), []))


class FakeGateway:
    def __init__(self):
        self.contexts = []

    def set_run_context(self, run_id, selected_feed_profile):
        self.contexts.append((run_id, selected_feed_profile))


class SimulatorRollbackServiceTest(unittest.TestCase):
    def setUp(self):
        self.redis = FakeRedis()
        self.clickhouse = FakeClickHouse()
        self.gateway = FakeGateway()
        self.keys = RedisKeyBuilder(prefix="test")
        self.service = SimulatorRollbackService(
            redis_client=self.redis,
            clickhouse_client=self.clickhouse,
            simulator_gateway=self.gateway,
            keys=self.keys,
            websocket_base_url="ws://gops-simulator:8765",
        )

    def test_start_selects_sip_transport_when_market_feed_is_none(self):
        self.redis.set(self.keys.feed_active_profile(), "none")

        result = self.service.start_run({
            "runId": "run-saturday",
            "startedAt": "2026-07-11T00:00:00Z",
            "symbols": ["NVDA", "AMD"],
        })

        override = json.loads(self.redis.get(self.keys.simulation_feed_override()))
        self.assertEqual(result["selectedFeedProfile"], "sip")
        self.assertEqual(override["selectedFeedProfile"], "sip")
        self.assertEqual(override["runId"], "run-saturday")
        self.assertEqual(self.gateway.contexts, [("run-saturday", "sip")])

    def test_start_preserves_an_active_sip_or_boats_transport(self):
        for active_profile in ("sip", "boats"):
            with self.subTest(active_profile=active_profile):
                redis_client = FakeRedis()
                clickhouse = FakeClickHouse()
                gateway = FakeGateway()
                service = SimulatorRollbackService(
                    redis_client=redis_client,
                    clickhouse_client=clickhouse,
                    simulator_gateway=gateway,
                    keys=self.keys,
                    websocket_base_url="ws://gops-simulator:8765",
                )
                redis_client.set(self.keys.feed_active_profile(), active_profile)

                result = service.start_run({
                    "runId": f"run-{active_profile}",
                    "symbols": ["NVDA"],
                })

                self.assertEqual(result["selectedFeedProfile"], active_profile)
                self.assertEqual(gateway.contexts, [(f"run-{active_profile}", active_profile)])

    def test_rollback_deletes_only_run_members_and_restores_latest_normal_candle(self):
        run_id = "run-saturday"
        symbol = "NVDA"
        interval = "1m"
        normal = json.dumps({"symbol": symbol, "interval": interval, "timestamp": "2026-07-10T19:59:00Z", "close": 100})
        simulated = json.dumps({"symbol": symbol, "interval": interval, "timestamp": "2026-07-11T00:01:00Z", "close": 80, "simulationRunId": run_id})
        series_key = self.keys.recent_candles(symbol, interval)
        self.redis.sorted_sets[series_key] = {normal: 1, simulated: 2}
        self.redis.set(self.keys.latest_closed_candle(symbol, interval), simulated)
        self.redis.set(self.keys.closed_candle_watermark(symbol, interval), "2026-07-11T00:01:00Z")
        self.redis.set(self.keys.live_candle(symbol, interval), simulated)
        self.redis.hashes[self.keys.live_trade(symbol)] = {"simulationRunId": run_id}
        record = {
            "runId": run_id,
            "state": "completed",
            "rollbackState": "available",
            "symbols": [symbol],
            "intervals": [interval],
            "selectedFeedProfile": "sip",
        }
        self.redis.set(self.keys.simulation_run(run_id), json.dumps(record))
        self.redis.set(self.keys.simulation_last_run(), run_id)
        self.redis.set(self.keys.simulation_feed_override(), json.dumps({"runId": run_id, "selectedFeedProfile": "sip"}))

        result = self.service.rollback_latest("demo-user")
        repeated = self.service.rollback_latest("demo-user")

        self.assertEqual(result["rollbackState"], "completed")
        self.assertEqual(repeated["rollbackState"], "completed")
        after_poll = self.service.enrich_status({"runId": run_id, "state": "completed"})
        self.assertEqual(after_poll["rollbackState"], "completed")
        self.assertNotIn(simulated, self.redis.sorted_sets[series_key])
        self.assertEqual(
            json.loads(self.redis.get(self.keys.latest_closed_candle(symbol, interval))),
            json.loads(normal),
        )
        self.assertEqual(self.redis.get(self.keys.closed_candle_watermark(symbol, interval)), "2026-07-10T19:59:00Z")
        self.assertIsNone(self.redis.get(self.keys.simulation_feed_override()))
        self.assertTrue(self.redis.get(self.keys.simulation_rollback(run_id)))
        self.assertEqual(len(self.clickhouse.executed), 2)
        self.assertTrue(any("SIMULATION_ROLLED_BACK" in payload for _, payload in self.redis.published))

    def test_rollback_rehydrates_latest_normal_candle_from_clickhouse_when_cache_is_empty(self):
        run_id = "run-cache-empty"
        self.clickhouse.query_rows[("NVDA", "1m")] = [{
            "symbol": "NVDA",
            "interval": "1m",
            "timestamp": "2026-07-10T19:59:00.000Z",
            "_redisScore": 1_783_713_540_000,
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100,
            "volume": 10,
            "isClosed": True,
        }]
        record = {
            "runId": run_id,
            "state": "completed",
            "rollbackState": "available",
            "symbols": ["NVDA"],
            "intervals": ["1m"],
            "selectedFeedProfile": "sip",
        }
        self.redis.set(self.keys.simulation_run(run_id), json.dumps(record))
        self.redis.set(self.keys.simulation_last_run(), run_id)

        self.service.rollback_latest("demo-user")

        latest = json.loads(self.redis.get(self.keys.latest_closed_candle("NVDA", "1m")))
        self.assertEqual(latest["close"], 100)
        self.assertNotIn("_redisScore", latest)
        self.assertEqual(
            self.redis.get(self.keys.closed_candle_watermark("NVDA", "1m")),
            "2026-07-10T19:59:00.000Z",
        )


if __name__ == "__main__":
    unittest.main()
