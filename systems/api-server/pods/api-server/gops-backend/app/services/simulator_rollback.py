from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime
from typing import Any

from alfaka.common.redis_keys import RedisKeyBuilder
from alfaka.realtime.feed_control import (
    clear_simulation_feed_override,
    select_simulation_feed,
    write_simulation_feed_override,
)
from alfaka.storage.clickhouse_loader import ClickHouseHttpClient


DEFAULT_SIMULATION_INTERVALS = ("1m", "5m", "10m", "1h", "4h", "1D", "1W", "1M")


class SimulationRollbackUnavailable(RuntimeError):
    pass


class SimulatorRollbackService:
    """시뮬레이션 실행 기록, 런타임 feed override, runId 단위 데이터 원복을 관리합니다."""

    def __init__(
        self,
        *,
        redis_client,
        clickhouse_client,
        simulator_gateway,
        keys: RedisKeyBuilder | None = None,
        websocket_base_url: str | None = None,
    ) -> None:
        self.redis = redis_client
        self.clickhouse = clickhouse_client
        self.gateway = simulator_gateway
        self.keys = keys or RedisKeyBuilder()
        self.websocket_base_url = (
            websocket_base_url
            or os.getenv("GOPS_SIMULATOR_WS_BASE_URL")
            or "ws://gops-simulator:8765"
        ).rstrip("/")

    def start_run(self, status: dict[str, Any]) -> dict[str, Any]:
        run_id = str(status.get("runId") or uuid.uuid4())
        symbols = normalize_symbols(status.get("symbols"))
        active_profile = decode_string(self.redis.get(self.keys.feed_active_profile()))
        selected_profile = select_simulation_feed(active_profile)
        self._ensure_clickhouse_simulation_schema()
        override = write_simulation_feed_override(
            self.redis,
            run_id=run_id,
            selected_feed_profile=selected_profile,
            websocket_base_url=self.websocket_base_url,
            symbols=symbols,
            keys=self.keys,
        )
        record = {
            "runId": run_id,
            "scenarioId": status.get("scenarioId"),
            "state": "running",
            "startedAt": status.get("startedAt") or utc_now(),
            "endedAt": None,
            "symbols": symbols,
            "intervals": list(DEFAULT_SIMULATION_INTERVALS),
            "activeFeedProfile": active_profile or "none",
            "selectedFeedProfile": selected_profile,
            "rollbackState": "available",
            "rollbackDetail": None,
        }
        try:
            self.gateway.set_run_context(
                run_id=run_id,
                selected_feed_profile=selected_profile,
            )
        except Exception:
            clear_simulation_feed_override(self.redis, run_id, self.keys)
            raise
        self._write_record(record)
        self.redis.set(self.keys.simulation_last_run(), run_id)
        return {**status, **override, "rollbackState": "available", "rollbackDetail": None}

    def finish_run(self, status: dict[str, Any] | None) -> dict[str, Any] | None:
        run_id = str((status or {}).get("runId") or (status or {}).get("lastRunId") or "")
        if not run_id:
            return None
        clear_simulation_feed_override(self.redis, run_id, self.keys)
        tombstone = self._read_json(self.keys.simulation_rollback(run_id))
        if tombstone and tombstone.get("rollbackState") == "completed":
            return self._read_record(run_id) or tombstone
        record = self._read_record(run_id) or {
            "runId": run_id,
            "symbols": normalize_symbols((status or {}).get("symbols")),
            "intervals": list(DEFAULT_SIMULATION_INTERVALS),
        }
        record.update({
            "state": "completed",
            "endedAt": (status or {}).get("endedAt") or utc_now(),
            "rollbackState": "available",
            "rollbackDetail": None,
        })
        self._write_record(record)
        self.redis.set(self.keys.simulation_last_run(), run_id)
        return record

    def enrich_status(self, status: dict[str, Any]) -> dict[str, Any]:
        if status.get("state") == "completed" and status.get("runId"):
            self.finish_run(status)
        run_id = str(status.get("lastRunId") or status.get("runId") or self._last_run_id() or "")
        record = self._read_record(run_id) if run_id else None
        if not record:
            return status
        return {
            **status,
            "lastRunId": run_id,
            "lastRunStartedAt": record.get("startedAt"),
            "lastRunEndedAt": record.get("endedAt"),
            "lastRunSymbols": record.get("symbols") or [],
            "selectedFeedProfile": record.get("selectedFeedProfile"),
            "rollbackState": record.get("rollbackState") or "available",
            "rollbackDetail": record.get("rollbackDetail"),
        }

    def rollback_latest(self, user_id: str) -> dict[str, Any]:
        run_id = self._last_run_id()
        if not run_id:
            raise SimulationRollbackUnavailable("원복할 완료된 시뮬레이션이 없습니다")
        record = self._read_record(run_id)
        if not record:
            raise SimulationRollbackUnavailable("최근 시뮬레이션 실행 기록을 찾을 수 없습니다")
        tombstone = self._read_json(self.keys.simulation_rollback(run_id))
        if tombstone and tombstone.get("rollbackState") == "completed":
            clear_simulation_feed_override(self.redis, run_id, self.keys)
            self._delete_clickhouse_rows(run_id)
            self._delete_redis_rows(record)
            return tombstone
        if record.get("state") not in {"completed", "live"}:
            raise SimulationRollbackUnavailable("시뮬레이션 실행 중에는 원복할 수 없습니다")

        lock_key = self.keys.key(f"simulation:rollback-lock:{run_id}")
        acquired = self.redis.set(lock_key, user_id, nx=True, ex=300)
        if not acquired:
            current = self._read_record(run_id) or record
            return self._public_result(current)

        record.update({"rollbackState": "running", "rollbackDetail": "원복 중"})
        self._write_record(record)
        try:
            clear_simulation_feed_override(self.redis, run_id, self.keys)
            self.redis.set(self.keys.simulation_rollback(run_id), json_dumps({
                "runId": run_id,
                "rollbackState": "running",
                "requestedBy": user_id,
                "startedAt": utc_now(),
            }))
            self._delete_clickhouse_rows(run_id)
            removed = self._delete_redis_rows(record)
            result = {
                "runId": run_id,
                "selectedFeedProfile": record.get("selectedFeedProfile"),
                "rollbackState": "completed",
                "rollbackDetail": "시뮬레이션 봉 원복 완료",
                "rolledBackAt": utc_now(),
                "requestedBy": user_id,
                "removedRedisEntries": removed,
            }
            self.redis.set(self.keys.simulation_rollback(run_id), json_dumps(result))
            record.update(result)
            record["state"] = "rolled_back"
            self._write_record(record)
            self._publish_rollback_event(record)
            return result
        except Exception as exc:
            record.update({
                "rollbackState": "failed",
                "rollbackDetail": f"원복 실패: {exc}",
            })
            self._write_record(record)
            raise
        finally:
            self.redis.delete(lock_key)

    def _delete_clickhouse_rows(self, run_id: str) -> None:
        database = getattr(self.clickhouse, "database", "market_data")
        for table in ("trade_ticks", "chart_candles"):
            self.clickhouse.execute(
                f"ALTER TABLE {database}.{table} DELETE WHERE simulation_run_id = {{runId:String}} SETTINGS mutations_sync=1",
                {"runId": run_id},
            )

    def _ensure_clickhouse_simulation_schema(self) -> None:
        database = getattr(self.clickhouse, "database", "market_data")
        for table in ("trade_ticks", "chart_candles"):
            self.clickhouse.execute(
                f"ALTER TABLE {database}.{table} "
                "ADD COLUMN IF NOT EXISTS simulation_run_id Nullable(String) AFTER source_event_id, "
                "ADD COLUMN IF NOT EXISTS simulation_scenario_id Nullable(String) AFTER simulation_run_id"
            )

    def _delete_redis_rows(self, record: dict[str, Any]) -> int:
        run_id = str(record["runId"])
        removed = 0
        for symbol in normalize_symbols(record.get("symbols")):
            trade_key = self.keys.live_trade(symbol)
            if run_id_matches(self.redis.hgetall(trade_key), run_id):
                removed += int(bool(self.redis.delete(trade_key)))
            removed += self._delete_matching_json(self.keys.live_quote(symbol), run_id)
            removed += self._delete_matching_json(self.keys.live_event(symbol), run_id)
            removed += int(bool(self.redis.delete(
                self.keys.order_flow_minutes(symbol),
                self.keys.order_flow_live_minute(symbol),
            )))
            for interval in record.get("intervals") or DEFAULT_SIMULATION_INTERVALS:
                removed += self._restore_interval(symbol, str(interval), run_id)
        pending_pattern = self.keys.key("pending:replace:*")
        for key in self.redis.scan_iter(match=pending_pattern):
            removed += self._delete_matching_json(key, run_id)
        return removed

    def _restore_interval(self, symbol: str, interval: str, run_id: str) -> int:
        removed = 0
        series_key = self.keys.recent_candles(symbol, interval)
        for member in list(self.redis.zrange(series_key, 0, -1)):
            if run_id_matches(parse_json(member), run_id):
                removed += int(bool(self.redis.zrem(series_key, member)))
        removed += self._delete_matching_json(self.keys.live_candle(symbol, interval), run_id)
        removed += self._delete_matching_json(self.keys.latest_closed_candle(symbol, interval), run_id)

        remaining = self.redis.zrange(series_key, -1, -1)
        latest_key = self.keys.latest_closed_candle(symbol, interval)
        watermark_key = self.keys.closed_candle_watermark(symbol, interval)
        latest = self._previous_clickhouse_candle(symbol, interval, run_id)
        if latest is None and remaining:
            latest = parse_json(remaining[-1])
        if isinstance(latest, dict):
            latest_raw = json_dumps(latest)
            timestamp = latest.get("timestamp")
            score = latest.pop("_redisScore", None)
            if score is not None:
                latest_raw = json_dumps(latest)
                self.redis.zadd(series_key, {latest_raw: float(score)})
            self.redis.set(latest_key, latest_raw)
            if timestamp:
                self.redis.set(watermark_key, timestamp)
            else:
                self.redis.delete(watermark_key)
        else:
            self.redis.delete(latest_key, watermark_key)
        return removed

    def _previous_clickhouse_candle(self, symbol: str, interval: str, run_id: str) -> dict[str, Any] | None:
        query_rows = getattr(self.clickhouse, "query_json_each_row", None)
        if not callable(query_rows):
            return None
        database = getattr(self.clickhouse, "database", "market_data")
        rows = query_rows(
            f"""
            SELECT
                symbol,
                interval,
                formatDateTime(event_time, '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS timestamp,
                toUnixTimestamp64Milli(event_time) AS _redisScore,
                open,
                high,
                low,
                close,
                volume,
                trade_count AS tradeCount,
                vwap,
                true AS isClosed,
                correction_type AS correctionType,
                source,
                feed,
                feed_profile AS feedProfile,
                market_session AS marketSession,
                source_event_id AS sourceEventId
            FROM {database}.chart_candles FINAL
            WHERE symbol = {{symbol:String}}
              AND interval = {{interval:String}}
              AND (simulation_run_id IS NULL OR simulation_run_id != {{runId:String}})
            ORDER BY event_time DESC
            LIMIT 1
            FORMAT JSONEachRow
            """,
            {"symbol": symbol, "interval": interval, "runId": run_id},
        )
        return rows[0] if rows else None

    def _delete_matching_json(self, key: str, run_id: str) -> int:
        value = self.redis.get(key)
        if not run_id_matches(parse_json(value), run_id):
            return 0
        return int(bool(self.redis.delete(key)))

    def _publish_rollback_event(self, record: dict[str, Any]) -> None:
        event = {
            "type": "SIMULATION_ROLLED_BACK",
            "eventId": f"simulation/rollback/{record['runId']}",
            "runId": record["runId"],
            "symbols": record.get("symbols") or [],
            "intervals": record.get("intervals") or list(DEFAULT_SIMULATION_INTERVALS),
            "timestamp": utc_now(),
        }
        self.redis.publish(self.keys.market_events(), json_dumps(event))

    def _last_run_id(self) -> str | None:
        return decode_string(self.redis.get(self.keys.simulation_last_run()))

    def _read_record(self, run_id: str) -> dict[str, Any] | None:
        return self._read_json(self.keys.simulation_run(run_id))

    def _write_record(self, record: dict[str, Any]) -> None:
        self.redis.set(self.keys.simulation_run(record["runId"]), json_dumps(record))

    def _read_json(self, key: str) -> dict[str, Any] | None:
        parsed = parse_json(self.redis.get(key))
        return parsed if isinstance(parsed, dict) else None

    @staticmethod
    def _public_result(record: dict[str, Any]) -> dict[str, Any]:
        return {
            "runId": record.get("runId"),
            "selectedFeedProfile": record.get("selectedFeedProfile"),
            "rollbackState": record.get("rollbackState") or "available",
            "rollbackDetail": record.get("rollbackDetail"),
        }


def create_simulator_rollback_service(simulator_gateway) -> SimulatorRollbackService:
    import redis

    redis_client = redis.from_url(
        os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        decode_responses=True,
    )
    clickhouse = ClickHouseHttpClient(
        url=os.getenv("CLICKHOUSE_HTTP_URL", "http://localhost:8123"),
        database=os.getenv("CLICKHOUSE_DATABASE", "market_data"),
        user=os.getenv("CLICKHOUSE_USER", "alfaka"),
        password=os.getenv("CLICKHOUSE_PASSWORD", "alfaka"),
    )
    return SimulatorRollbackService(
        redis_client=redis_client,
        clickhouse_client=clickhouse,
        simulator_gateway=simulator_gateway,
    )


def normalize_symbols(values: Any) -> list[str]:
    symbols = []
    for value in values or []:
        raw = value.get("symbol") if isinstance(value, dict) else value
        symbol = str(raw or "").strip().upper()
        if symbol and symbol not in symbols:
            symbols.append(symbol)
    return symbols


def parse_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    try:
        return json.loads(decode_string(value) or "null")
    except (TypeError, ValueError):
        return None


def decode_string(value: Any) -> str | None:
    if value is None:
        return None
    return value.decode("utf-8") if isinstance(value, bytes) else str(value)


def run_id_matches(payload: Any, run_id: str) -> bool:
    if not isinstance(payload, dict):
        return False
    value = payload.get("simulationRunId") or payload.get("simulation_run_id")
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    return str(value or "") == str(run_id)


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
