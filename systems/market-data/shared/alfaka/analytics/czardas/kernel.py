from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Iterable

from .compiler import compile_boundary, compile_drawing
from .config import CzardasConfig, DEFAULT_CONFIG
from .evidence import build_evidence
from .features import build_features
from .field_view import build_field_view
from .hline import detect_hlines
from .numeric import canonicalize, identity_digest
from .meaning import CandleMeaningTape, build_base_candle_meanings, finalize_candle_meanings
from .relations import select_triangle_relation
from .select import select_boundaries
from .tape import CandleTape
from .trend import detect_trends
from .types import AnalysisUnavailable, BoundaryCandidate, DetectorResult, Ready, RoleBasis


@dataclass(frozen=True, slots=True)
class CzardasInference:
    """Presentation-free result of one sealed exact-240 snapshot inference."""

    tape: CandleTape
    features: Any
    meanings: CandleMeaningTape
    basis: tuple[RoleBasis, ...]
    hline: DetectorResult
    trend: DetectorResult
    selected_hlines: tuple[BoundaryCandidate, ...]
    selected_trends: tuple[BoundaryCandidate, ...]
    relation: dict[str, Any] | None
    reject_summary: dict[str, int]
    inference_id: str
    config: CzardasConfig
    cluster_count: int
    inference_elapsed_ms: float


def analyze_czardas(
    rows: Iterable[dict[str, Any]],
    config: CzardasConfig = DEFAULT_CONFIG,
) -> Ready | AnalysisUnavailable:
    inference = infer_czardas(rows, config)
    if isinstance(inference, AnalysisUnavailable):
        return inference
    return project_czardas_sight(inference)


def infer_czardas(
    rows: Iterable[dict[str, Any]],
    config: CzardasConfig = DEFAULT_CONFIG,
) -> CzardasInference | AnalysisUnavailable:
    started = time.perf_counter()
    try:
        config.validate()
    except (TypeError, ValueError) as exc:
        return AnalysisUnavailable("invalid_config")
    try:
        tape = CandleTape.from_rows(rows, config)
    except (TypeError, ValueError) as exc:
        return AnalysisUnavailable(_unavailable_reason(str(exc)), {"message": str(exc)})
    features = build_features(tape, config)
    base_meanings = build_base_candle_meanings(tape, features, config)
    clusters, basis = build_evidence(tape, features, config, base_meanings)
    hline = detect_hlines(tape, features, basis, config)
    trend = detect_trends(tape, features, basis, config)
    selected_hlines, selected_trends, reject_summary = select_boundaries(
        tape, features, hline.candidates, trend.candidates, config
    )
    selected = (*selected_hlines, *selected_trends)
    relation = select_triangle_relation(tape, features, selected_trends)
    inference_id = identity_digest([
        config.algorithm_version,
        config.config_version,
        config.input_contract_version,
        config.time_contract_version,
        config.calendar_version,
        config.inference_digest,
        tape.symbol,
        tape.interval,
        tape.as_of,
        tape.input_digest,
    ])
    meanings = finalize_candle_meanings(
        base_meanings, tape, features, basis, selected
    )
    return CzardasInference(
        tape=tape,
        features=features,
        meanings=meanings,
        basis=basis,
        hline=hline,
        trend=trend,
        selected_hlines=selected_hlines,
        selected_trends=selected_trends,
        relation=relation,
        reject_summary=reject_summary,
        inference_id=inference_id,
        config=config,
        cluster_count=len(clusters),
        inference_elapsed_ms=(time.perf_counter() - started) * 1000.0,
    )


def project_czardas_sight(inference: CzardasInference) -> Ready | AnalysisUnavailable:
    started = time.perf_counter()
    tape = inference.tape
    config = inference.config
    if not config.production_storable:
        return AnalysisUnavailable("research_config_not_storable")
    selected = (*inference.selected_hlines, *inference.selected_trends)
    sight_projection_id = identity_digest([
        inference.inference_id,
        config.sight_projection_version,
        config.projection_digest,
    ])
    boundaries = [compile_boundary(tape, inference.features, item, inference.inference_id) for item in selected]
    drawings = [compile_drawing(tape, item, inference.relation, inference.inference_id) for item in selected]
    try:
        field, field_bytes = build_field_view(
            tape, inference.hline, inference.trend, selected, inference.relation,
            inference.meanings, inference.inference_id, sight_projection_id, config,
        )
    except ValueError as exc:
        return AnalysisUnavailable(str(exc))
    content = {
        "algorithmVersion": config.algorithm_version,
        "configVersion": config.config_version,
        "inputContractVersion": config.input_contract_version,
        "timeContractVersion": config.time_contract_version,
        "calendarVersion": config.calendar_version,
        "inferenceConfigDigest": config.inference_digest,
        "projectionConfigDigest": config.projection_digest,
        "sightProjectionVersion": config.sight_projection_version,
        "sightProjectionId": sight_projection_id,
        "symbol": tape.symbol,
        "interval": tape.interval,
        "asOf": tape.as_of,
        "lastCandleKey": tape.last_candle_key,
        "inputDigest": tape.input_digest,
        "inferenceId": inference.inference_id,
        "status": "ready",
        "coverage": {
            "state": "exact",
            "targetCompleted": config.target_completed_bars,
            "actualCompleted": len(tape.candles),
            "analysisBars": len(tape.candles),
            "qualityFlags": [],
        },
        "selection": {
            "hline": {"configuredCount": config.hline_display_count, "actualCount": len(inference.selected_hlines)},
            "trend": {"configuredCount": config.trend_display_count, "actualCount": len(inference.selected_trends)},
        },
        "boundaries": boundaries,
        "presentationPattern": inference.relation,
        "drawings": drawings,
        "czardasField": field,
        "rejectSummary": inference.reject_summary,
    }
    canonical_content = canonicalize(content)
    payload_encoded = json.dumps(
        canonical_content, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    payload_bytes = len(payload_encoded)
    if payload_bytes > config.max_payload_bytes:
        return AnalysisUnavailable("payload_limit_exceeded", {"payloadBytes": payload_bytes})
    return Ready(canonical_content, {
        "contentDigest": "sha256:" + hashlib.sha256(payload_encoded).hexdigest(),
        "payloadBytes": payload_bytes,
        "fieldBytes": field_bytes,
        "elapsedMs": inference.inference_elapsed_ms + (time.perf_counter() - started) * 1000.0,
        "inferenceElapsedMs": inference.inference_elapsed_ms,
        "projectionElapsedMs": (time.perf_counter() - started) * 1000.0,
        "clusterCount": inference.cluster_count,
        "basisCount": len(inference.basis),
        "candidateCount": len(inference.hline.candidates) + len(inference.trend.candidates),
        "searchModeCount": len(inference.hline.modes) + len(inference.trend.modes),
        "hlineSearchModeCount": len(inference.hline.modes),
        "trendSearchModeCount": len(inference.trend.modes),
    })


def _unavailable_reason(message: str) -> str:
    if message.startswith("expected_exactly"):
        return "insufficient_canonical_coverage"
    if "duplicate" in message or "identity" in message:
        return "invalid_candle_identity"
    if "ohlcv" in message or "numeric" in message:
        return "invalid_ohlcv"
    if "live" in message:
        return "live_only"
    if "canonical" in message or "adjustment" in message or "session" in message:
        return "calendar_contract_mismatch"
    return "invalid_candle_identity"
