import json
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
MARKET_SHARED = REPO_ROOT / "systems" / "market-data" / "shared"
if str(MARKET_SHARED) not in sys.path:
    sys.path.insert(0, str(MARKET_SHARED))

from alfaka.common.market_messages import build_raw_envelope
from alfaka.realtime import feed_control
from alfaka.storage.clickhouse_loader import candle_to_clickhouse_row, trade_to_clickhouse_row
from alfaka.streaming.transforms import CandleAggregator, LiveCandleBuilder, normalize_trade


SIMULATOR_PAYLOAD = {
    "T": "t",
    "S": "NVDA",
    "i": 1_000_000_000_000_001,
    "p": 200.0,
    "s": 3,
    "t": "2026-07-11T03:00:01.000Z",
    "simulator": {
        "runId": "sim-run-1",
        "scenarioId": "iran-ceasefire-collapse-2026-07-08",
        "phase": "market-impact",
    },
}


class SimulationFeedSelectionTests(unittest.TestCase):
    def test_active_profile_selects_same_transport_and_closed_uses_sip(self):
        self.assertEqual(feed_control.select_simulation_feed("sip"), "sip")
        self.assertEqual(feed_control.select_simulation_feed("boats"), "boats")
        self.assertEqual(feed_control.select_simulation_feed("none"), "sip")
        self.assertEqual(feed_control.select_simulation_feed(None), "sip")


class SimulationMetadataPropagationTests(unittest.TestCase):
    def test_run_metadata_reaches_trade_live_and_derived_candles_and_clickhouse_rows(self):
        envelope = build_raw_envelope(SIMULATOR_PAYLOAD, "sip", feed_profile="sip", market_session="closed")
        trade = normalize_trade(envelope)
        live = LiveCandleBuilder().update(trade)
        aggregator = CandleAggregator()
        derived = None
        for minute in range(5):
            candle = {
                **live,
                "eventType": "CANDLE",
                "timestamp": f"2026-07-11T03:0{minute}:00.000Z",
                "isClosed": True,
            }
            derived = aggregator.update(candle, 5) or derived

        self.assertEqual(envelope["simulationRunId"], "sim-run-1")
        self.assertEqual(trade["simulationRunId"], "sim-run-1")
        self.assertEqual(live["simulationRunId"], "sim-run-1")
        self.assertEqual(derived["simulationRunId"], "sim-run-1")
        self.assertEqual(trade_to_clickhouse_row(trade)["simulation_run_id"], "sim-run-1")
        self.assertEqual(candle_to_clickhouse_row(derived)["simulation_run_id"], "sim-run-1")

    def test_clickhouse_schema_can_selectively_delete_one_simulation_run(self):
        for relative in (
            "infra/clickhouse/initdb/01-market-data.sql",
            "infra/k8s/base/platform/clickhouse-initdb/01-market-data.sql",
        ):
            schema = (REPO_ROOT / relative).read_text(encoding="utf-8")
            self.assertGreaterEqual(schema.count("simulation_run_id Nullable(String)"), 2)

    def test_redis_payload_keeps_run_id_for_selective_cleanup(self):
        envelope = build_raw_envelope(SIMULATOR_PAYLOAD, "sip", feed_profile="sip", market_session="closed")
        trade = normalize_trade(envelope)
        live = LiveCandleBuilder().update(trade)

        self.assertEqual(json.loads(json.dumps(live))["simulationRunId"], "sim-run-1")


if __name__ == "__main__":
    unittest.main()
