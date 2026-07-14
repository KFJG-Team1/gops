from __future__ import annotations

import hashlib
import os
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from alfaka.analytics.czardas.data import CzardasCandleLoader, SUPPORTED_INTERVALS
from app.auth.dependencies import require_current_user
from app.auth.models import AuthenticatedUser
from app.services.alfaka_market_data import (
    configured_universe_symbols,
    normalize_market_symbol,
    sp500_universe_symbols,
)
from gops_agents.czardas_assets.delivery import symbol_entries
from gops_agents.czardas_assets.envelope import CzardasBuildEnvelope, utc_now_iso
from gops_agents.czardas_assets.job_store import CzardasIdempotencyConflict, CzardasPairBusy
from gops_agents.czardas_assets.progress import build_czardas_progress_store_from_env
from gops_agents.czardas_assets.queue import build_czardas_queue_from_env
from gops_agents.czardas_assets.storage import build_czardas_storage_from_env


router = APIRouter()
JOB_ID_PATTERN = r"^cza-[A-Za-z0-9-]{8,64}$"


class CzardasAssetBuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str = Field(min_length=1, max_length=12)
    interval: str
    force: bool = False

    @field_validator("interval")
    @classmethod
    def validate_interval(cls, value: str) -> str:
        normalized = str(value).strip()
        if normalized not in SUPPORTED_INTERVALS:
            raise ValueError("interval must be a supported Czardas interval")
        return normalized


@router.get("/api/charts/czardas-assets")
def get_czardas_assets(
    symbol: str = Query(min_length=1, max_length=12),
    interval: str | None = Query(default=None),
) -> dict[str, Any]:
    normalized = normalize_market_symbol(symbol)
    normalized_interval = None if interval is None else _supported_interval(interval)
    try:
        storage = czardas_asset_storage()
        records = (
            storage.get_records(normalized, normalized_interval)
            if hasattr(storage, "get_records")
            else storage.get_symbol_records(normalized)
        )
        requested_intervals = None if normalized_interval is None else (normalized_interval,)
        assets = symbol_entries(
            normalized, records, czardas_identity_reader().current_identity, requested_intervals
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Czardas asset storage is unavailable.") from exc
    return {"symbol": normalized, "assets": assets, "meta": {"servedAt": utc_now_iso()}}


@router.delete("/api/charts/czardas-assets")
def delete_czardas_asset(
    symbol: str = Query(min_length=1, max_length=12),
    interval: str = Query(),
    _user: AuthenticatedUser = Depends(require_current_user),
) -> dict[str, Any]:
    if _storage_maintenance_enabled():
        raise HTTPException(status_code=503, detail="Czardas asset storage migration is in progress.")
    normalized_symbol = _registered_symbol(symbol)
    normalized_interval = _supported_interval(interval)
    if czardas_asset_progress_store().pair_active(normalized_symbol, normalized_interval):
        raise HTTPException(status_code=409, detail="czardas_pair_busy")
    try:
        deleted = czardas_asset_storage().delete(normalized_symbol, normalized_interval)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Czardas asset could not be deleted.") from exc
    return {"symbol": normalized_symbol, "interval": normalized_interval, "deleted": deleted}


@router.post("/api/charts/czardas-assets/build", status_code=202)
def build_czardas_asset(
    request: CzardasAssetBuildRequest,
    response: Response,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=128),
    user: AuthenticatedUser = Depends(require_current_user),
) -> dict[str, Any]:
    if _storage_maintenance_enabled():
        raise HTTPException(status_code=503, detail="Czardas asset storage migration is in progress.")
    symbol = _registered_symbol(request.symbol)
    requested_by = _requester_id(user)
    deterministic_job_id = "cza-" + hashlib.sha256(
        f"{requested_by}\0{idempotency_key}".encode("utf-8")
    ).hexdigest()[:40]
    envelope = CzardasBuildEnvelope.create(
        requested_by=requested_by,
        symbol=symbol,
        interval=request.interval,
        force=request.force,
        job_id=deterministic_job_id,
    )
    progress = czardas_asset_progress_store()
    try:
        submitted = czardas_asset_build_queue().submit_once(envelope, progress)
    except CzardasIdempotencyConflict as exc:
        raise HTTPException(status_code=409, detail="czardas_idempotency_conflict") from exc
    except CzardasPairBusy as exc:
        raise HTTPException(status_code=409, detail="czardas_pair_busy") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Czardas build queue is unavailable.") from exc
    state = submitted.get("state") or {}
    job_id = str(state.get("jobId") or envelope.job_id)
    response.status_code = 202
    return {
        "jobId": job_id,
        "status": state.get("status") or "queued",
        "coalesced": bool(submitted.get("coalesced")),
        "status_url": f"/api/charts/czardas-assets/build/{job_id}",
    }


@router.get("/api/charts/czardas-assets/build/{job_id}")
def get_czardas_build_status(
    job_id: str = Path(min_length=12, max_length=80, pattern=JOB_ID_PATTERN),
    user: AuthenticatedUser = Depends(require_current_user),
) -> dict[str, Any]:
    state = czardas_asset_progress_store().get_for_owner(job_id, _requester_id(user))
    if state is None:
        raise HTTPException(status_code=404, detail="Czardas build job not found.")
    return state


@router.post("/api/charts/czardas-assets/build/{job_id}/cancel")
def cancel_czardas_build(
    job_id: str = Path(min_length=12, max_length=80, pattern=JOB_ID_PATTERN),
    user: AuthenticatedUser = Depends(require_current_user),
) -> dict[str, Any]:
    state = czardas_asset_progress_store().request_cancel(job_id, requested_by=_requester_id(user))
    if state is None:
        raise HTTPException(status_code=404, detail="Czardas build job not found.")
    return state


def _registered_symbol(value: str) -> str:
    symbol = normalize_market_symbol(value)
    registry = set(sp500_universe_symbols()) | set(configured_universe_symbols())
    if symbol not in registry:
        raise HTTPException(status_code=400, detail=f"Unsupported chart symbol: {symbol}")
    return symbol


def _supported_interval(value: str) -> str:
    interval = str(value).strip()
    if interval not in SUPPORTED_INTERVALS:
        raise HTTPException(status_code=400, detail="interval must be a supported Czardas interval")
    return interval


@lru_cache(maxsize=1)
def czardas_asset_storage():
    return build_czardas_storage_from_env()


@lru_cache(maxsize=1)
def czardas_asset_progress_store():
    return build_czardas_progress_store_from_env()


@lru_cache(maxsize=1)
def czardas_asset_build_queue():
    return build_czardas_queue_from_env()


@lru_cache(maxsize=1)
def czardas_identity_reader():
    return CzardasCandleLoader()


def _storage_maintenance_enabled() -> bool:
    return os.getenv("CZARDAS_ASSET_STORAGE_MAINTENANCE", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _requester_id(user: AuthenticatedUser) -> str:
    return hashlib.sha256(user.sub.encode("utf-8")).hexdigest()[:24]
