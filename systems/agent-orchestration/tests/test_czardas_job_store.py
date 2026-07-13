from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
for path in (ROOT / "systems" / "market-data" / "shared", ROOT / "systems" / "agent-orchestration" / "shared"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from gops_agents.czardas_assets.job_store import (  # noqa: E402
    CLAIM_NEXT_SQL,
    REAP_EXHAUSTED_CLAIMS_SQL,
    PostgresCzardasJobStore,
)


def test_claim_serializes_same_pair_before_running_transition():
    assert "candidate AS MATERIALIZED" in CLAIM_NEXT_SQL
    assert "FOR UPDATE OF item SKIP LOCKED" in CLAIM_NEXT_SQL
    assert "pg_try_advisory_xact_lock" in CLAIM_NEXT_SQL
    assert 'candidate.symbol || \':\' || candidate."interval"' in CLAIM_NEXT_SQL
    assert "active.status = 'running'" in CLAIM_NEXT_SQL


def test_expired_second_attempt_is_reaped_before_claim():
    connection = Connection(fetches=[])
    store = PostgresCzardasJobStore("postgresql://test", connect=lambda *_args, **_kwargs: connection)

    assert store.claim_next("worker-1") is None
    assert connection.executions[0][0] == REAP_EXHAUSTED_CLAIMS_SQL
    assert "item.attempts >= 2" in connection.executions[0][0]
    assert "status = 'completed_with_errors'" in connection.executions[0][0]
    assert "COALESCE(item.error" in connection.executions[0][0]
    assert "COALESCE(job.error" in connection.executions[0][0]


def test_claim_returns_one_envelope_and_commits_after_pair_lock():
    connection = Connection(fetches=[
        {"job_id": "cza-12345678", "symbol": "AAPL", "interval": "1D", "attempts": 1},
        {"requested_by": "tester", "submitted_at": datetime(2026, 7, 10, tzinfo=timezone.utc), "force_build": False},
    ])
    store = PostgresCzardasJobStore("postgresql://test", connect=lambda *_args, **_kwargs: connection)

    claim = store.claim_next("worker-1")

    assert claim["symbol"] == "AAPL"
    assert claim["interval"] == "1D"
    assert claim["attempts"] == 1
    assert connection.commits == 1


def test_outer_failure_retries_once_then_can_be_terminal():
    retry_connection = Connection(fetches=[{"status": "pending"}])
    retry_store = PostgresCzardasJobStore("postgresql://test", connect=lambda *_args, **_kwargs: retry_connection)
    assert retry_store.record_outer_failure("cza-12345678", "worker-1") == "pending"
    assert "SET status = 'queued'" in retry_connection.executions[1][0]

    failed_connection = Connection(fetches=[{"status": "failed"}])
    failed_store = PostgresCzardasJobStore("postgresql://test", connect=lambda *_args, **_kwargs: failed_connection)
    assert failed_store.record_outer_failure("cza-12345678", "worker-1") == "failed"
    assert "completed_with_errors" in failed_connection.executions[1][0]


class Connection:
    def __init__(self, fetches):
        self.fetches = list(fetches)
        self.executions = []
        self.commits = 0

    def __enter__(self): return self
    def __exit__(self, *_args): return False
    def execute(self, query, parameters=()):
        self.executions.append((query, parameters))
        return self
    def fetchone(self): return self.fetches.pop(0) if self.fetches else None
    def commit(self): self.commits += 1
