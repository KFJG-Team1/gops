from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from alfaka.analytics.czardas.data import CzardasCandleLoader, CzardasCandleWindow
from alfaka.analytics.analysis_repair import (
    AlpacaClickHouseRepairRunner,
    BackfillUnavailable,
    ProviderConfirmedEmpty,
)


@dataclass(frozen=True, slots=True)
class StrictRepairResult:
    window: CzardasCandleWindow
    checked: bool
    attempted: bool
    repaired: bool
    unavailable: bool
    missing_before: int
    missing_after: int
    materialized_rows: int
    rounds: int
    reason: str

    def metrics(self) -> dict[str, Any]:
        reason_codes = {} if self.reason in {"coverage_complete", "repaired"} else {self.reason: 1}
        return {
            "checkedSymbols": int(self.checked),
            "attemptedSymbols": int(self.attempted),
            "repairedSymbols": int(self.repaired),
            "unavailableSymbols": int(self.unavailable),
            "missingBarsBefore": self.missing_before,
            "missingBarsAfter": self.missing_after,
            "materializedRows": self.materialized_rows,
            "rounds": self.rounds,
            "reasonCodes": reason_codes,
        }


class StrictCzardasRepairCoordinator:
    """Repair no more than eight contiguous gaps per round, for two rounds."""

    def __init__(
        self,
        loader: CzardasCandleLoader,
        *,
        runner_factory: Callable[[], Any] | None = None,
        max_ranges: int = 8,
        max_rounds: int = 2,
    ) -> None:
        self.loader = loader
        self.runner_factory = runner_factory or (
            lambda: AlpacaClickHouseRepairRunner(calendar=self.loader.calendar)
        )
        self.max_ranges = min(8, max(1, int(max_ranges)))
        self.max_rounds = min(2, max(1, int(max_rounds)))

    def ensure_exact(
        self,
        symbol: str,
        interval: str,
        *,
        request_id: str,
        is_cancel_requested: Callable[[], bool] | None = None,
    ) -> StrictRepairResult:
        cancel = is_cancel_requested or (lambda: False)
        before = self.loader.load(symbol, interval)
        if before.ready:
            return StrictRepairResult(before, True, False, False, False, 0, 0, 0, 0, "coverage_complete")
        missing_before = len(before.missing_keys)
        current = before
        materialized = 0
        attempted = False
        failed = False
        rounds = 0
        for round_index in range(self.max_rounds):
            if cancel() or current.ready or not current.repair_gaps:
                break
            rounds += 1
            attempted = True
            runner = self.runner_factory()
            for gap_index, gap in enumerate(current.repair_gaps[: self.max_ranges]):
                if cancel():
                    break
                try:
                    outcome = runner.run({
                        "schemaVersion": 1,
                        "requestId": f"{request_id}-{round_index + 1}-{gap_index + 1}",
                        "symbol": symbol,
                        "interval": gap.interval,
                        "range": {"start": gap.start, "end": gap.end},
                        "jobType": "gapfill",
                        "sourcePreference": "alpaca-only",
                        "mode": "inline",
                        "force": False,
                        "analysisMissingCandleKeys": list(gap.missing_keys),
                    })
                    result = outcome.get("result") if isinstance(outcome, dict) else None
                    materialized += int((result or {}).get("materializedRowCount") or 0)
                except (ProviderConfirmedEmpty, BackfillUnavailable):
                    failed = True
                except Exception:
                    failed = True
            # The canonical re-read is mandatory; runner return values never
            # become inference input directly.
            current = self.loader.load(symbol, interval)
        missing_after = len(current.missing_keys)
        if cancel():
            reason = "canceled"
        elif current.ready:
            reason = "repaired"
        elif not current.repair_gaps:
            reason = "exact_240_unavailable"
        elif failed:
            reason = "repair_incomplete"
        else:
            reason = "repair_round_limit"
        return StrictRepairResult(
            current,
            True,
            attempted,
            current.ready and not before.ready,
            not current.ready,
            missing_before,
            missing_after,
            materialized,
            rounds,
            reason,
        )
