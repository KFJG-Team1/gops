from __future__ import annotations

import time
from typing import Any

from alfaka.analytics.czardas import DEFAULT_CONFIG, analyze_czardas
from alfaka.analytics.czardas.data import CzardasCandleLoader
from alfaka.analytics.czardas.types import AnalysisUnavailable, Ready

from .contract import FIELD_SCHEMA_VERSION, is_valid_czardas_pack
from .envelope import CzardasBuildEnvelope, utc_now_iso
from .progress import build_czardas_progress_store_from_env
from .repair import StrictCzardasRepairCoordinator
from .storage import build_czardas_storage_from_env


class CzardasAssetBuilder:
    def __init__(self, *, loader=None, repair=None, storage=None, progress=None) -> None:
        self.loader = loader or CzardasCandleLoader()
        self.repair = repair or StrictCzardasRepairCoordinator(self.loader)
        self.storage = storage or build_czardas_storage_from_env()
        self.progress = progress or build_czardas_progress_store_from_env()

    def run_item(self, envelope: CzardasBuildEnvelope, symbol: str, interval: str) -> dict[str, Any]:
        started = time.monotonic()
        symbol = str(symbol).upper()
        if symbol != envelope.symbol or interval != envelope.interval:
            item = _item(symbol, interval, "failed", "contract", started, error="claim/envelope identity mismatch")
            self.progress.record_item(envelope.job_id, item)
            return item
        if self.progress.is_cancel_requested(envelope.job_id):
            item = _item(symbol, interval, "skipped", "cancel", started, reason="cancel_requested")
            self.progress.record_item(envelope.job_id, item)
            return item
        try:
            repair = self.repair.ensure_exact(
                symbol,
                interval,
                request_id=f"{envelope.job_id}-snapshot",
                is_cancel_requested=lambda: self.progress.is_cancel_requested(envelope.job_id),
            )
            self.progress.record_repair(envelope.job_id, repair.metrics())
            if not repair.window.ready:
                item = _item(
                    symbol, interval, "failed", "coverage", started,
                    reason=repair.reason,
                    error=getattr(repair, "error", None)
                    or f"{len(repair.window.rows)} of 240 canonical completed candles available",
                )
                self.progress.record_item(envelope.job_id, item)
                return item

            existing = self.storage.get(symbol, interval)
            unchanged = not envelope.force and _is_same_current_pack(
                existing, symbol, interval, repair.window.input_digest, repair.window.last_candle_key
            )
            result: Ready | None = None if unchanged else analyze_czardas(repair.window.rows)
            if isinstance(result, AnalysisUnavailable):
                item = _item(symbol, interval, "failed", "kernel", started, reason=result.reason)
                self.progress.record_item(envelope.job_id, item)
                return item
            if result is not None and not isinstance(result, Ready):
                raise TypeError("Czardas kernel returned an unknown result")

            current = self.loader.load(symbol, interval)
            if not _same_snapshot(repair.window, current):
                item = _item(
                    symbol, interval, "failed", "snapshot", started,
                    reason="snapshot_changed_during_build",
                )
                self.progress.record_item(envelope.job_id, item)
                return item
            if unchanged:
                item = _item(symbol, interval, "unchanged", "digest", started, reason="input_unchanged")
                self.progress.record_item(envelope.job_id, item)
                return item
            if self.progress.is_cancel_requested(envelope.job_id):
                item = _item(symbol, interval, "skipped", "cancel", started, reason="cancel_requested")
                self.progress.record_item(envelope.job_id, item)
                return item
            assert result is not None
            save_state = self.storage.save_if_active(
                result.content,
                job_id=envelope.job_id,
                generated_at=utc_now_iso(),
            )
            if save_state == "canceled":
                item = _item(symbol, interval, "skipped", "storage", started, reason="cancel_requested")
            elif save_state in {"unchanged", "older"}:
                item = _item(symbol, interval, "unchanged", "storage", started, reason=save_state)
            else:
                item = _item(
                    symbol,
                    interval,
                    "saved",
                    "storage",
                    started,
                    created_entities=len(result.content.get("drawings") or []),
                )
        except Exception:
            item = _item(
                symbol, interval, "failed", "build", started,
                reason="unexpected_build_failure",
                error="Czardas build failed unexpectedly.",
            )
        self.progress.record_item(envelope.job_id, item)
        return item


def _is_same_current_pack(existing, symbol: str, interval: str, input_digest: str, last_candle_key: str) -> bool:
    if not isinstance(existing, dict):
        return False
    pack = existing.get("pack")
    return bool(
        existing.get("inputDigest") == input_digest
        and existing.get("lastCandleKey") == last_candle_key
        and existing.get("algorithmVersion") == DEFAULT_CONFIG.algorithm_version
        and existing.get("configVersion") == DEFAULT_CONFIG.config_version
        and existing.get("inputContractVersion") == DEFAULT_CONFIG.input_contract_version
        and existing.get("inferenceConfigDigest") == DEFAULT_CONFIG.inference_digest
        and existing.get("sightProjectionId") == (pack or {}).get("sightProjectionId")
        and existing.get("timeContractVersion") == DEFAULT_CONFIG.time_contract_version
        and existing.get("calendarVersion") == DEFAULT_CONFIG.calendar_version
        and existing.get("fieldSchemaVersion") == FIELD_SCHEMA_VERSION
        and is_valid_czardas_pack(pack, expected_symbol=symbol, expected_interval=interval)
    )


def _same_snapshot(expected, current) -> bool:
    return bool(
        current.ready
        and current.input_digest == expected.input_digest
        and current.last_candle_key == expected.last_candle_key
        and len(current.rows) == len(expected.rows) == DEFAULT_CONFIG.target_completed_bars
    )


def _item(
    symbol: str,
    interval: str,
    status: str,
    stage: str,
    started: float,
    *,
    error: str | None = None,
    reason: str | None = None,
    created_entities: int = 0,
) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "interval": interval,
        "status": status,
        "stage": stage,
        "error": error,
        "reason": reason,
        "elapsedMs": int(round((time.monotonic() - started) * 1000)),
        "createdEntities": created_entities,
    }
