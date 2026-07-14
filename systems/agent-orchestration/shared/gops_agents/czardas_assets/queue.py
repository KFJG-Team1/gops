from __future__ import annotations

from collections import deque
import threading

from .job_store import PostgresCzardasJobStore


class InMemoryCzardasBuildQueue:
    def __init__(self) -> None:
        self.items = deque()
        self._lock = threading.RLock()

    def submit_once(self, envelope, progress_store=None):
        if progress_store is None:
            raise RuntimeError("in-memory submit_once requires its progress store")
        with self._lock:
            existing = progress_store.get(envelope.job_id)
            if existing is not None:
                requested = existing["requested"]
                if requested != {"symbol": envelope.symbol, "interval": envelope.interval, "force": envelope.force}:
                    from .job_store import CzardasIdempotencyConflict
                    raise CzardasIdempotencyConflict("idempotency_key_reused")
                return {"state": existing, "coalesced": True}
            for job_id, state in list(progress_store._states.items()):
                requested = state["requested"]
                if (
                    requested["symbol"] == envelope.symbol
                    and requested["interval"] == envelope.interval
                    and state["status"] in {"queued", "running"}
                ):
                    if state.get("_requestedBy") == envelope.requested_by and requested["force"] == envelope.force:
                        return {"state": progress_store.get(job_id), "coalesced": True}
                    from .job_store import CzardasPairBusy
                    raise CzardasPairBusy("czardas_pair_busy")
            state = progress_store._initialize_for_submit(envelope)
            self.items.append(envelope.to_dict())
            return {"state": state, "coalesced": False}


class PostgresCzardasBuildQueue:
    def __init__(self, store: PostgresCzardasJobStore | None = None) -> None:
        self.store = store or PostgresCzardasJobStore()

    def submit_once(self, envelope, progress_store=None):
        return self.store.submit_once(envelope)

    def claim_next(self, worker_id: str, *, lease_seconds: int = 120):
        return self.store.claim_next(worker_id, lease_seconds=lease_seconds)

    def heartbeat(self, job_id: str, worker_id: str, *, lease_seconds: int = 120):
        return self.store.heartbeat(job_id, worker_id, lease_seconds=lease_seconds)

    def record_outer_failure(self, job_id: str, worker_id: str):
        return self.store.record_outer_failure(job_id, worker_id)


def build_czardas_queue_from_env():
    return PostgresCzardasBuildQueue()
