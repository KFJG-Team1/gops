from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Callable

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from alfaka.analytics.czardas.data import SUPPORTED_INTERVALS
from gops_agents.chart_assets.storage import _database_conninfo


LATEST_TABLE = "chart_assets.czardas_latest"
JOBS_TABLE = "chart_assets.czardas_build_jobs"
ITEMS_TABLE = "chart_assets.czardas_build_items"
MAX_PACK_BYTES = 64 * 1024
MAX_FIELD_BYTES = 32 * 1024


class DeterminismConflict(RuntimeError):
    pass


class PostgresCzardasAssetStorage:
    def __init__(self, conninfo: str | None = None, *, connect: Callable[..., Any] | None = None) -> None:
        self.conninfo = conninfo or _database_conninfo()
        self._connector = connect or psycopg.connect

    def get(self, symbol: str, interval: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT pack, generated_at, input_digest, content_digest,
                       last_candle_key, algorithm_version, config_version
                FROM {LATEST_TABLE}
                WHERE symbol = %s AND "interval" = %s
                """,
                (symbol.upper(), interval),
            ).fetchone()
        return _record(row) if row else None

    def get_symbol_records(self, symbol: str) -> dict[str, dict[str, Any] | None]:
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT "interval", pack, generated_at, input_digest, content_digest,
                       last_candle_key, algorithm_version, config_version
                FROM {LATEST_TABLE}
                WHERE symbol = %s
                ORDER BY "interval"
                """,
                (symbol.upper(),),
            ).fetchall()
        result: dict[str, dict[str, Any] | None] = {interval: None for interval in SUPPORTED_INTERVALS}
        for row in rows:
            interval = str(row.get("interval") or "")
            if interval in result:
                result[interval] = _record(row)
        return result

    def save_if_active(self, pack: dict[str, Any], *, job_id: str, generated_at: str) -> str:
        projection = _pack_projection(pack, generated_at)
        with self._connect() as conn:
            job = conn.execute(
                f"SELECT cancel_requested FROM {JOBS_TABLE} WHERE job_id = %s FOR UPDATE",
                (job_id,),
            ).fetchone()
            if job is None or bool(job["cancel_requested"]):
                conn.rollback()
                return "canceled"
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (f"{projection['symbol']}:{projection['interval']}",),
            )
            current = conn.execute(
                f"""
                SELECT input_digest, content_digest, last_candle_key, as_of,
                       algorithm_version, config_version, time_contract_version,
                       calendar_version
                FROM {LATEST_TABLE}
                WHERE symbol = %s AND "interval" = %s
                FOR UPDATE
                """,
                (projection["symbol"], projection["interval"]),
            ).fetchone()
            same_identity = bool(current) and all((
                current.get("input_digest") == projection["input_digest"],
                str(current.get("last_candle_key")) == projection["last_candle_key"],
                current.get("algorithm_version") == projection["algorithm_version"],
                current.get("config_version") == projection["config_version"],
                current.get("time_contract_version") == projection["time_contract_version"],
                current.get("calendar_version") == projection["calendar_version"],
                current.get("as_of") is None or _timestamp(current.get("as_of")) == projection["as_of"],
            ))
            if same_identity:
                if current["content_digest"] != projection["content_digest"]:
                    raise DeterminismConflict("same Czardas input produced different deterministic content")
                conn.commit()
                return "unchanged"
            current_as_of = _timestamp(current.get("as_of")) if current and current.get("as_of") is not None else None
            if current and (
                (current_as_of is not None and current_as_of > projection["as_of"])
                or (current_as_of is None and str(current["last_candle_key"]) > projection["last_candle_key"])
            ):
                conn.commit()
                return "older"
            conn.execute(
                f"""
                INSERT INTO {LATEST_TABLE} (
                    symbol, "interval", last_candle_key, as_of, generated_at,
                    algorithm_version, config_version, time_contract_version,
                    calendar_version, input_digest, content_digest, drawing_count,
                    field_bytes, payload_bytes, pack, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, now()
                )
                ON CONFLICT (symbol, "interval") DO UPDATE SET
                    last_candle_key = EXCLUDED.last_candle_key,
                    as_of = EXCLUDED.as_of,
                    generated_at = EXCLUDED.generated_at,
                    algorithm_version = EXCLUDED.algorithm_version,
                    config_version = EXCLUDED.config_version,
                    time_contract_version = EXCLUDED.time_contract_version,
                    calendar_version = EXCLUDED.calendar_version,
                    input_digest = EXCLUDED.input_digest,
                    content_digest = EXCLUDED.content_digest,
                    drawing_count = EXCLUDED.drawing_count,
                    field_bytes = EXCLUDED.field_bytes,
                    payload_bytes = EXCLUDED.payload_bytes,
                    pack = EXCLUDED.pack,
                    updated_at = now()
                """,
                (
                    projection["symbol"], projection["interval"], projection["last_candle_key"],
                    projection["as_of"], projection["generated_at"], projection["algorithm_version"],
                    projection["config_version"], projection["time_contract_version"],
                    projection["calendar_version"], projection["input_digest"],
                    projection["content_digest"], projection["drawing_count"], projection["field_bytes"],
                    projection["payload_bytes"], Jsonb(pack),
                ),
            )
            conn.commit()
        return "saved"

    def coverage(self, symbols: list[str] | None = None) -> list[dict[str, Any]]:
        where = ""
        params: tuple[Any, ...] = ()
        if symbols:
            where = "WHERE symbol = ANY(%s)"
            params = ([symbol.upper() for symbol in symbols],)
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT symbol, "interval", generated_at, algorithm_version,
                       drawing_count, field_bytes, payload_bytes
                FROM {LATEST_TABLE} {where}
                ORDER BY symbol, "interval"
                """,
                params,
            ).fetchall()
        return [{
            "symbol": row["symbol"],
            "interval": row["interval"],
            "generatedAt": _iso(row["generated_at"]),
            "status": "ready",
            "assetKind": "czardas",
            "algorithmVersion": row["algorithm_version"],
            "drawingCount": int(row["drawing_count"]),
            "fieldBytes": int(row["field_bytes"]),
            "payloadBytes": int(row["payload_bytes"]),
            "freshness": "unknown",
        } for row in rows]

    def delete(self, symbols: list[str], intervals: list[str]) -> int:
        if not symbols or not intervals:
            return 0
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                DELETE FROM {LATEST_TABLE}
                WHERE symbol = ANY(%s) AND "interval" = ANY(%s)
                RETURNING symbol
                """,
                ([symbol.upper() for symbol in symbols], intervals),
            ).fetchall()
            conn.commit()
        return len(rows)

    def _connect(self):
        return self._connector(self.conninfo, row_factory=dict_row)


def _pack_projection(pack: dict[str, Any], generated_at: str) -> dict[str, Any]:
    if "generatedAt" in pack:
        raise ValueError("generatedAt belongs to the Czardas DB/API envelope, not deterministic pack content")
    symbol = str(pack.get("symbol") or "").upper()
    interval = str(pack.get("interval") or "")
    if not symbol or interval not in SUPPORTED_INTERVALS:
        raise ValueError("invalid Czardas pack identity")
    if int((pack.get("coverage") or {}).get("actualCompleted") or 0) != 240:
        raise ValueError("Czardas pack must contain exact completed-240 coverage")
    drawings = list(pack.get("drawings") or [])
    if len(drawings) > 7:
        raise ValueError("Czardas drawing limit exceeded")
    if any(
        str(item.get("symbol") or "").upper() != symbol
        or str(item.get("interval") or "") != interval
        for item in drawings
    ):
        raise ValueError("Czardas drawing identity does not match pack")
    hlines = [item for item in drawings if item.get("czardasLayer") == "hline"]
    trends = [item for item in drawings if item.get("czardasLayer") == "trend"]
    if len(hlines) > 4 or len(trends) > 3 or len(hlines) + len(trends) != len(drawings):
        raise ValueError("Czardas layer drawing limit exceeded")
    if any(item.get("ownership") != "czardas-managed" for item in drawings):
        raise ValueError("stored Czardas drawings must remain managed proposals")
    payload = json.dumps(pack, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    payload_bytes = len(payload.encode("utf-8"))
    if payload_bytes > MAX_PACK_BYTES:
        raise ValueError("Czardas pack exceeds 64 KiB")
    field_payload = json.dumps(pack.get("czardasField") or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    field_bytes = len(field_payload.encode("utf-8"))
    if field_bytes > MAX_FIELD_BYTES:
        raise ValueError("Czardas Field exceeds 32 KiB")
    return {
        "symbol": symbol,
        "interval": interval,
        "last_candle_key": str(pack["lastCandleKey"]),
        "as_of": _timestamp(pack["asOf"]),
        "generated_at": _timestamp(generated_at),
        "algorithm_version": str(pack["algorithmVersion"]),
        "config_version": str(pack["configVersion"]),
        "time_contract_version": str(pack["timeContractVersion"]),
        "calendar_version": str(pack["calendarVersion"]),
        "input_digest": str(pack["inputDigest"]),
        "content_digest": "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest(),
        "drawing_count": len(drawings),
        "field_bytes": field_bytes,
        "payload_bytes": payload_bytes,
    }


def _record(row: dict[str, Any]) -> dict[str, Any]:
    pack = row.get("pack")
    if not isinstance(pack, dict):
        pack = json.loads(str(pack))
    return {
        "pack": pack,
        "generatedAt": _iso(row.get("generated_at")),
        "inputDigest": row.get("input_digest"),
        "contentDigest": row.get("content_digest"),
        "lastCandleKey": row.get("last_candle_key"),
        "algorithmVersion": row.get("algorithm_version"),
        "configVersion": row.get("config_version"),
    }


def _timestamp(value: Any) -> Any:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def build_czardas_storage_from_env() -> PostgresCzardasAssetStorage:
    return PostgresCzardasAssetStorage()
