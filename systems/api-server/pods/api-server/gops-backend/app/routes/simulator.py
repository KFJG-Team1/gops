from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.auth.dependencies import require_current_user
from app.auth.models import AuthenticatedUser
from app.services.simulator_gateway import SimulatorGateway, SimulatorUnavailable
from app.services.simulator_rollback import (
    SimulationRollbackUnavailable,
    create_simulator_rollback_service,
)


router = APIRouter(prefix="/api/simulator", tags=["simulator"])


class SimulatorModeRequest(BaseModel):
    mode: Literal["live", "simulation"]


class SimulatorActionRequest(BaseModel):
    action: Literal["pause", "resume", "restart"]


class SimulatorBasketOrderRequest(BaseModel):
    basket: Literal["semiconductor", "energy"]
    side: Literal["buy", "sell"]


@router.get("/status")
def simulator_status(request: Request) -> dict[str, Any]:
    try:
        status_payload = simulator_gateway_from_app(request.app).status()
        rollback_service = simulator_rollback_service_from_app(request.app)
        enrich_status = getattr(rollback_service, "enrich_status", None)
        enriched = enrich_status(status_payload) if callable(enrich_status) else status_payload
        return {"available": True, **enriched}
    except SimulatorUnavailable as exc:
        return {
            "available": False,
            "mode": "live",
            "state": "idle",
            "detail": str(exc),
            "elapsedSeconds": 0,
            "durationSeconds": 300,
            "breakingNewsAtSeconds": 5,
            "breakingNewsReleased": False,
            "symbols": [],
        }


@router.put("/mode")
def simulator_mode(payload: SimulatorModeRequest, request: Request) -> dict[str, Any]:
    gateway = simulator_gateway_from_app(request.app)
    rollback_service = simulator_rollback_service_from_app(request.app)
    try:
        before = gateway.status()
        result = gateway.set_mode(payload.mode)
        if payload.mode == "simulation":
            start_run = getattr(rollback_service, "start_run", None)
            if not callable(start_run):
                return result
            try:
                return start_run(result)
            except Exception as exc:
                try:
                    gateway.set_mode("live")
                except SimulatorUnavailable:
                    pass
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"시뮬레이션 데이터 경로 전환 실패: {exc}",
                ) from exc
        finish_run = getattr(rollback_service, "finish_run", None)
        if callable(finish_run):
            finish_run(before)
        enrich_status = getattr(rollback_service, "enrich_status", None)
        return enrich_status(result) if callable(enrich_status) else result
    except SimulatorUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.post("/action")
def simulator_action(payload: SimulatorActionRequest, request: Request) -> dict[str, Any]:
    gateway = simulator_gateway_from_app(request.app)
    rollback_service = simulator_rollback_service_from_app(request.app)
    try:
        before = gateway.status()
        result = gateway.action(payload.action)
        if payload.action == "restart":
            finish_run = getattr(rollback_service, "finish_run", None)
            if callable(finish_run):
                finish_run(before)
            start_run = getattr(rollback_service, "start_run", None)
            return start_run(result) if callable(start_run) else result
        enrich_status = getattr(rollback_service, "enrich_status", None)
        return enrich_status(result) if callable(enrich_status) else result
    except SimulatorUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.post("/rollback")
def simulator_rollback(
    request: Request,
    current_user: AuthenticatedUser = Depends(require_current_user),
) -> dict[str, Any]:
    try:
        current = simulator_gateway_from_app(request.app).status()
        if current.get("mode") == "simulation" and current.get("state") in {"running", "paused"}:
            raise HTTPException(status_code=409, detail="시뮬레이션 실행 중에는 원복할 수 없습니다")
        return simulator_rollback_service_from_app(request.app).rollback_latest(current_user.sub)
    except SimulationRollbackUnavailable as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SimulatorUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.get("/news")
def simulator_news(request: Request) -> dict[str, Any]:
    return _call_simulator(lambda gateway: gateway.news(), request)


@router.post("/orders/basket")
def simulator_basket_order(
    payload: SimulatorBasketOrderRequest,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_current_user),
) -> dict[str, Any]:
    idempotency_key = request.headers.get("Idempotency-Key", "").strip()
    if not idempotency_key:
        raise HTTPException(status_code=400, detail="Idempotency-Key header is required")
    if not simulator_mode_active(request.app):
        raise HTTPException(status_code=409, detail="simulation mode is not active")
    key = (current_user.sub, idempotency_key)
    cache = _simulation_idempotency_cache(request.app)
    if key in cache:
        return cache[key]
    result = _call_simulator(
        lambda gateway: gateway.basket_order(
            user_id=current_user.sub,
            basket=payload.basket,
            side=payload.side,
        ),
        request,
    )
    cache[key] = result
    return result


def simulator_gateway_from_app(app: Any) -> SimulatorGateway:
    existing = getattr(app.state, "simulator_gateway", None)
    if existing is not None:
        return existing
    gateway = SimulatorGateway()
    app.state.simulator_gateway = gateway
    return gateway


def simulator_rollback_service_from_app(app: Any):
    existing = getattr(app.state, "simulator_rollback_service", None)
    if existing is not None:
        return existing
    service = create_simulator_rollback_service(simulator_gateway_from_app(app))
    app.state.simulator_rollback_service = service
    return service


def simulator_mode_active(app: Any) -> bool:
    try:
        return simulator_gateway_from_app(app).status().get("mode") == "simulation"
    except SimulatorUnavailable:
        return False


def _simulation_idempotency_cache(app: Any) -> dict[tuple[str, str], dict[str, Any]]:
    cache = getattr(app.state, "simulation_idempotency_cache", None)
    if not isinstance(cache, dict):
        cache = {}
        app.state.simulation_idempotency_cache = cache
    return cache


def _call_simulator(callback, request: Request) -> dict[str, Any]:
    try:
        return callback(simulator_gateway_from_app(request.app))
    except SimulatorUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
