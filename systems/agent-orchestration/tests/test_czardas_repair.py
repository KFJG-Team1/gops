from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[3]
for path in (ROOT / "systems" / "market-data" / "shared", ROOT / "systems" / "agent-orchestration" / "shared"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from gops_agents.czardas_assets.repair import StrictCzardasRepairCoordinator  # noqa: E402
from alfaka.backfill.gapfill import TradingCalendar  # noqa: E402
from alfaka.candles.repair import (  # noqa: E402
    RepairCredentialsMissing,
    RepairProviderEmpty,
    RepairProviderFailed,
)


def _gap(index):
    return SimpleNamespace(
        interval="1m",
        start=f"2026-07-10T14:{index:02d}:00.000Z",
        end=f"2026-07-10T14:{index + 1:02d}:00.000Z",
        missing_keys=(f"key-{index}",),
    )


class Loader:
    def __init__(self):
        self.windows = [
            SimpleNamespace(ready=False, missing_keys=tuple(range(9)), repair_gaps=tuple(_gap(i) for i in range(9))),
            SimpleNamespace(ready=False, missing_keys=(8,), repair_gaps=(_gap(8),)),
            SimpleNamespace(ready=True, missing_keys=(), repair_gaps=()),
        ]
        self.calls = 0
    def load(self, *_args):
        value = self.windows[min(self.calls, len(self.windows) - 1)]
        self.calls += 1
        return value


class Runner:
    def __init__(self, calls): self.calls = calls
    def run(self, record):
        self.calls.append(record)
        return {"result": {"materializedRowCount": 1}}


def test_strict_repair_caps_each_round_at_eight_and_rereads_canonical_rows():
    loader = Loader()
    calls = []
    coordinator = StrictCzardasRepairCoordinator(loader, runner_factory=lambda: Runner(calls))

    result = coordinator.ensure_exact("NVDA", "1m", request_id="cza-test")

    assert result.repaired
    assert result.rounds == 2
    assert len(calls) == 9
    assert loader.calls == 3
    assert all(call["sourcePreference"] == "alpaca-only" for call in calls)
    assert all("missingCandleKeys" in call for call in calls)
    assert all("analysisMissingCandleKeys" not in call for call in calls)


def test_default_repair_runner_uses_the_loaders_code_owned_calendar():
    calendar = TradingCalendar()
    coordinator = StrictCzardasRepairCoordinator(SimpleNamespace(calendar=calendar))

    assert coordinator.runner_factory().calendar is calendar


class StaticLoader:
    def __init__(self):
        self.calendar = TradingCalendar()
        self.calls = 0

    def load(self, *_args):
        self.calls += 1
        return SimpleNamespace(ready=False, missing_keys=("missing",), repair_gaps=(_gap(0),), rows=())


class RaisingRunner:
    def __init__(self, error):
        self.error = error
        self.calls = 0

    def run(self, _record):
        self.calls += 1
        raise self.error


class SequenceRunner:
    def __init__(self, errors):
        self.errors = list(errors)

    def run(self, _record):
        raise self.errors.pop(0)


def test_repair_failure_reasons_are_specific_and_sanitized():
    cases = (
        (RepairCredentialsMissing(), "credentials_missing", 1),
        (RepairProviderEmpty(), "provider_empty", 2),
        (RepairProviderFailed(), "provider_failed", 2),
    )
    for error, reason, expected_calls in cases:
        loader = StaticLoader()
        runner = RaisingRunner(error)
        result = StrictCzardasRepairCoordinator(loader, runner_factory=lambda: runner).ensure_exact(
            "NVDA", "1m", request_id="cza-reason"
        )
        assert result.reason == reason
        assert result.error == error.public_message
        assert result.metrics()["reasonCodes"] == {reason: 1}
        assert runner.calls == expected_calls


def test_successful_materialization_without_exact_reread_is_distinct():
    loader = StaticLoader()
    runner = Runner([])
    result = StrictCzardasRepairCoordinator(loader, runner_factory=lambda: runner).ensure_exact(
        "NVDA", "1m", request_id="cza-reread"
    )

    assert result.reason == "canonical_reread_incomplete"
    assert result.materialized_rows == 2


def test_provider_failure_takes_precedence_over_empty_with_matching_public_error():
    runner = SequenceRunner([RepairProviderEmpty(), RepairProviderFailed()])
    result = StrictCzardasRepairCoordinator(
        StaticLoader(), runner_factory=lambda: runner
    ).ensure_exact("NVDA", "1m", request_id="cza-precedence")

    assert result.reason == "provider_failed"
    assert result.error == RepairProviderFailed.public_message
