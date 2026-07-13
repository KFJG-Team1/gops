from __future__ import annotations

import copy
import threading
from typing import Any

from .envelope import CzardasBuildEnvelope
from .job_store import PostgresCzardasJobStore


class InMemoryCzardasProgressStore:
    def __init__(self) -> None:
        self._states: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()

    def initialize(self, envelope: CzardasBuildEnvelope) -> dict[str, Any]:
        state = {
            "jobId": envelope.job_id,
            "assetKind": "czardas",
            "status": "queued",
            "requested": {"symbolCount": 1, "intervals": [envelope.interval], "force": envelope.force},
            "progress": {"total": 1, "done": 0, "failed": 0, "skipped": 0, "warnings": 0, "current": None},
            "repair": {
                "checkedSymbols": 0, "attemptedSymbols": 0, "repairedSymbols": 0,
                "unavailableSymbols": 0, "missingBarsBefore": 0, "missingBarsAfter": 0,
                "materializedRows": 0, "reasonCodes": {},
            },
            "recentItems": [],
            "failedItems": [],
            "cancelRequested": False,
            "startedAt": None,
            "finishedAt": None,
        }
        with self._lock:
            self._states[envelope.job_id] = state
        return copy.deepcopy(state)

    def get(self, job_id: str):
        with self._lock:
            value = self._states.get(job_id)
            return copy.deepcopy(value) if value else None

    def request_cancel(self, job_id: str):
        with self._lock:
            state = self._states.get(job_id)
            if state:
                state["cancelRequested"] = True
                state["status"] = "canceled"
            return copy.deepcopy(state) if state else None

    def is_cancel_requested(self, job_id: str) -> bool:
        state = self.get(job_id)
        return bool(state and state["cancelRequested"])

    def record_item(self, job_id: str, item: dict[str, Any]):
        with self._lock:
            state = self._states[job_id]
            state["recentItems"] = [copy.deepcopy(item)]
            state["progress"]["done"] = 1
            state["progress"]["failed"] = int(item["status"] == "failed")
            state["progress"]["skipped"] = int(item["status"] == "skipped")
            state["status"] = "completed_with_errors" if item["status"] == "failed" else "canceled" if item["status"] == "skipped" else "completed"

    def set_status(self, job_id: str, status: str, **values: Any):
        with self._lock:
            state = self._states.get(job_id)
            if state:
                state["status"] = status
                state.update(values)
            return copy.deepcopy(state) if state else None

    def record_repair(self, job_id: str, result: dict[str, Any]):
        with self._lock:
            if job_id in self._states:
                self._states[job_id]["repair"] = copy.deepcopy(result)


class PostgresCzardasProgressStore:
    def __init__(self, store: PostgresCzardasJobStore | None = None) -> None:
        self.store = store or PostgresCzardasJobStore()

    def initialize(self, envelope): return self.store.enqueue(envelope)
    def get(self, job_id): return self.store.get(job_id)
    def request_cancel(self, job_id): return self.store.request_cancel(job_id)
    def is_cancel_requested(self, job_id): return self.store.is_cancel_requested(job_id)
    def record_item(self, job_id, item): return self.store.record_item(job_id, item)
    def set_status(self, job_id, status, **values): return self.store.set_status(job_id, status, **values)
    def record_repair(self, job_id, result): return self.store.record_repair(job_id, result)


def build_czardas_progress_store_from_env():
    return PostgresCzardasProgressStore()
