from __future__ import annotations

from collections import deque

from .job_store import PostgresCzardasJobStore


class InMemoryCzardasBuildQueue:
    def __init__(self) -> None:
        self.items = deque()

    def submit(self, envelope) -> None:
        self.items.append(envelope.to_dict())


class PostgresCzardasBuildQueue:
    def __init__(self, store: PostgresCzardasJobStore | None = None) -> None:
        self.store = store or PostgresCzardasJobStore()

    def submit(self, envelope) -> None:
        self.store.enqueue(envelope)

    def claim_next(self, worker_id: str, *, lease_seconds: int = 120):
        return self.store.claim_next(worker_id, lease_seconds=lease_seconds)

    def heartbeat(self, job_id: str, worker_id: str, *, lease_seconds: int = 120):
        return self.store.heartbeat(job_id, worker_id, lease_seconds=lease_seconds)

    def record_outer_failure(self, job_id: str, worker_id: str):
        return self.store.record_outer_failure(job_id, worker_id)


def build_czardas_queue_from_env():
    return PostgresCzardasBuildQueue()
