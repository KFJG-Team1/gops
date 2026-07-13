from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from gops_agents.chart_assets.storage import _database_conninfo

from .envelope import CzardasBuildEnvelope
from .storage import ITEMS_TABLE, JOBS_TABLE


TERMINAL_ITEM_STATUSES = {"saved", "unchanged", "failed", "skipped"}


class PostgresCzardasJobStore:
    def __init__(self, conninfo: str | None = None, *, connect: Callable[..., Any] | None = None) -> None:
        self.conninfo = conninfo or _database_conninfo()
        self._connector = connect or psycopg.connect

    def enqueue(self, envelope: CzardasBuildEnvelope) -> dict[str, Any]:
        with self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {JOBS_TABLE} (
                    job_id, requested_by, submitted_at, symbol, "interval",
                    status, force_build
                ) VALUES (%s, %s, %s, %s, %s, 'queued', %s)
                ON CONFLICT (job_id) DO NOTHING
                """,
                (
                    envelope.job_id, envelope.requested_by, _timestamp(envelope.submitted_at),
                    envelope.symbol, envelope.interval, envelope.force,
                ),
            )
            conn.execute(
                f"""
                INSERT INTO {ITEMS_TABLE} (job_id, symbol, "interval", status)
                VALUES (%s, %s, %s, 'pending')
                ON CONFLICT (job_id) DO NOTHING
                """,
                (envelope.job_id, envelope.symbol, envelope.interval),
            )
            conn.commit()
        return self.get(envelope.job_id) or {}

    def claim_next(self, worker_id: str, *, lease_seconds: int = 120) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                f"""
                WITH candidate AS (
                    SELECT item.job_id
                    FROM {ITEMS_TABLE} item
                    JOIN {JOBS_TABLE} job ON job.job_id = item.job_id
                    WHERE job.cancel_requested = false
                      AND job.status IN ('queued', 'running')
                      AND item.attempts < 2
                      AND (
                        item.status = 'pending'
                        OR (item.status = 'running' AND item.lease_expires_at < now())
                      )
                      AND NOT EXISTS (
                        SELECT 1 FROM {ITEMS_TABLE} active
                        WHERE active.symbol = item.symbol
                          AND active."interval" = item."interval"
                          AND active.status = 'running'
                          AND active.lease_expires_at >= now()
                          AND active.job_id <> item.job_id
                      )
                    ORDER BY job.submitted_at, item.job_id
                    FOR UPDATE OF item SKIP LOCKED
                    LIMIT 1
                )
                UPDATE {ITEMS_TABLE} item
                SET status = 'running', stage = 'claimed', attempts = attempts + 1,
                    worker_id = %s,
                    lease_expires_at = now() + make_interval(secs => %s),
                    started_at = COALESCE(started_at, now()), updated_at = now()
                FROM candidate
                WHERE item.job_id = candidate.job_id
                RETURNING item.job_id, item.symbol, item."interval", item.attempts
                """,
                (worker_id, lease_seconds),
            ).fetchone()
            if row is None:
                conn.commit()
                return None
            job = conn.execute(
                f"""
                UPDATE {JOBS_TABLE}
                SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
                WHERE job_id = %s
                RETURNING requested_by, submitted_at, force_build
                """,
                (row["job_id"],),
            ).fetchone()
            conn.commit()
        envelope = CzardasBuildEnvelope.create(
            job_id=row["job_id"],
            requested_by=job["requested_by"],
            submitted_at=_iso(job["submitted_at"]),
            symbol=row["symbol"],
            interval=row["interval"],
            force=job["force_build"],
        )
        return {"envelope": envelope, "symbol": row["symbol"], "interval": row["interval"], "attempts": row["attempts"]}

    def heartbeat(self, job_id: str, worker_id: str, *, lease_seconds: int = 120) -> bool:
        with self._connect() as conn:
            cursor = conn.execute(
                f"""
                UPDATE {ITEMS_TABLE}
                SET lease_expires_at = now() + make_interval(secs => %s), updated_at = now()
                WHERE job_id = %s AND worker_id = %s AND status = 'running'
                """,
                (lease_seconds, job_id, worker_id),
            )
            conn.commit()
        return int(cursor.rowcount) == 1

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            job = conn.execute(f"SELECT * FROM {JOBS_TABLE} WHERE job_id = %s", (job_id,)).fetchone()
            if job is None:
                return None
            item = conn.execute(f"SELECT * FROM {ITEMS_TABLE} WHERE job_id = %s", (job_id,)).fetchone()
        done = bool(item and item["status"] in TERMINAL_ITEM_STATUSES)
        failed = bool(item and item["status"] == "failed")
        skipped = bool(item and item["status"] == "skipped")
        payload = _item_payload(item) if item else None
        repair = {
            "checkedSymbols": 0,
            "attemptedSymbols": 0,
            "repairedSymbols": 0,
            "unavailableSymbols": 0,
            "missingBarsBefore": 0,
            "missingBarsAfter": 0,
            "materializedRows": 0,
            "reasonCodes": {},
        }
        repair.update(dict(job.get("repair") or {}))
        return {
            "jobId": job_id,
            "assetKind": "czardas",
            "status": job["status"],
            "requested": {"symbolCount": 1, "intervals": [job["interval"]], "force": job["force_build"]},
            "progress": {
                "total": 1,
                "done": int(done),
                "failed": int(failed),
                "skipped": int(skipped),
                "warnings": 0,
                "current": f"{job['symbol']}:{job['interval']}" if item and item["status"] == "running" else None,
            },
            "repair": repair,
            "recentItems": [payload] if payload and done else [],
            "failedItems": [payload] if payload and failed else [],
            "cancelRequested": bool(job["cancel_requested"]),
            "createdEntities": int(item.get("created_entities") or 0) if item else 0,
            "error": job.get("error"),
            "startedAt": _iso(job.get("started_at")),
            "finishedAt": _iso(job.get("finished_at")),
        }

    def record_item(self, job_id: str, item: dict[str, Any]) -> dict[str, Any] | None:
        status = str(item.get("status") or "failed")
        if status not in TERMINAL_ITEM_STATUSES:
            raise ValueError("unsupported Czardas item status")
        if status == "failed":
            job_status = "completed_with_errors"
        elif status == "skipped":
            job_status = "canceled"
        else:
            job_status = "completed"
        with self._connect() as conn:
            conn.execute(
                f"""
                UPDATE {ITEMS_TABLE}
                SET status = %s, stage = %s, error = %s, reason = %s,
                    elapsed_ms = %s, created_entities = %s,
                    lease_expires_at = NULL, finished_at = now(), updated_at = now()
                WHERE job_id = %s
                """,
                (
                    status, str(item.get("stage") or "done"), item.get("error"), item.get("reason"),
                    int(item.get("elapsedMs") or 0), int(item.get("createdEntities") or 0), job_id,
                ),
            )
            conn.execute(
                f"""
                UPDATE {JOBS_TABLE}
                SET status = %s, finished_at = now(), updated_at = now()
                WHERE job_id = %s AND status <> 'canceled'
                """,
                (job_status, job_id),
            )
            conn.commit()
        return self.get(job_id)

    def request_cancel(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            conn.execute(
                f"""
                UPDATE {JOBS_TABLE}
                SET cancel_requested = true, status = 'canceled', finished_at = now(), updated_at = now()
                WHERE job_id = %s
                """,
                (job_id,),
            )
            conn.execute(
                f"""
                UPDATE {ITEMS_TABLE}
                SET status = 'skipped', stage = 'cancel', reason = 'cancel_requested',
                    finished_at = now(), updated_at = now()
                WHERE job_id = %s AND status = 'pending'
                """,
                (job_id,),
            )
            conn.commit()
        return self.get(job_id)

    def is_cancel_requested(self, job_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT cancel_requested FROM {JOBS_TABLE} WHERE job_id = %s",
                (job_id,),
            ).fetchone()
        return bool(row and row["cancel_requested"])

    def record_repair(self, job_id: str, result: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                f"UPDATE {JOBS_TABLE} SET repair = %s, updated_at = now() WHERE job_id = %s",
                (Jsonb(result), job_id),
            )
            conn.commit()

    def set_status(self, job_id: str, status: str, **values: Any) -> dict[str, Any] | None:
        allowed = {"queued", "running", "completed", "completed_with_errors", "canceled", "failed"}
        if status not in allowed:
            raise ValueError("unsupported Czardas job status")
        error = values.get("error")
        terminal = status in {"completed", "completed_with_errors", "canceled", "failed"}
        with self._connect() as conn:
            conn.execute(
                f"""
                UPDATE {JOBS_TABLE}
                SET status = %s, error = COALESCE(%s, error),
                    started_at = CASE WHEN %s = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
                    finished_at = CASE WHEN %s THEN now() ELSE finished_at END,
                    updated_at = now()
                WHERE job_id = %s
                """,
                (status, error, status, terminal, job_id),
            )
            if terminal and status in {"failed", "completed_with_errors"}:
                conn.execute(
                    f"""
                    UPDATE {ITEMS_TABLE}
                    SET status = 'failed', stage = 'queue', error = COALESCE(%s, error),
                        lease_expires_at = NULL, finished_at = now(), updated_at = now()
                    WHERE job_id = %s AND status IN ('pending', 'running')
                    """,
                    (error, job_id),
                )
            conn.commit()
        return self.get(job_id)

    def _connect(self):
        return self._connector(self.conninfo, row_factory=dict_row)


def _item_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": item["symbol"],
        "interval": item["interval"],
        "status": item["status"],
        "stage": item["stage"],
        "error": item.get("error"),
        "reason": item.get("reason"),
        "elapsedMs": int(item.get("elapsed_ms") or 0),
    }


def _timestamp(value: Any) -> Any:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
