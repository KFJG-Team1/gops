import sys
import unittest
from pathlib import Path


SIMULATOR_ROOT = Path(__file__).resolve().parents[1]
if str(SIMULATOR_ROOT) not in sys.path:
    sys.path.insert(0, str(SIMULATOR_ROOT))

from gops_simul.demo import DemoScenario, DemoScenarioController


class FakeClock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


class SimulatorRollbackStateTests(unittest.TestCase):
    def test_last_run_survives_live_transition_and_becomes_rollback_available(self):
        clock = FakeClock()
        controller = DemoScenarioController(DemoScenario(scenario_id="demo", title="Demo"), clock=clock)

        started = controller.set_mode("simulation")
        run_id = started["runId"]
        clock.now += 6
        finished = controller.set_mode("live")

        self.assertEqual(finished["mode"], "live")
        self.assertIsNone(finished["runId"])
        self.assertEqual(finished["lastRunId"], run_id)
        self.assertEqual(finished["rollbackState"], "available")
        self.assertEqual(finished["lastRunSymbols"], ["NVDA", "AMD", "AVGO", "MU", "TSM", "XOM", "CVX", "COP"])

    def test_completed_simulation_exposes_rollback_without_switching_live(self):
        clock = FakeClock()
        controller = DemoScenarioController(
            DemoScenario(scenario_id="demo", title="Demo", duration_seconds=5),
            clock=clock,
        )
        run_id = controller.set_mode("simulation")["runId"]

        clock.now += 5
        status = controller.status()

        self.assertEqual(status["state"], "completed")
        self.assertEqual(status["lastRunId"], run_id)
        self.assertEqual(status["rollbackState"], "available")


if __name__ == "__main__":
    unittest.main()
