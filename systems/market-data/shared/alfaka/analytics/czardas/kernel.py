from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Iterable

from .compiler import compile_boundary, compile_drawing, compile_pattern_drawing
from .config import CzardasConfig, DEFAULT_CONFIG
from .evidence import build_evidence
from .features import build_features
from .field_view import build_field_view
from .hline import detect_hlines
from .numeric import canonicalize, identity_digest
from .meaning import CandleMeaningTape, build_base_candle_meanings, finalize_candle_meanings
from .relations import analyze_pattern_relations
from .select import select_boundaries
from .tape import CandleTape
from .trend import detect_trends
from .types import AnalysisUnavailable, BoundaryCandidate, DetectorResult, Ready, RoleBasis
from .structure import (
    PriceMemoryRidge,
    RegressionFlow,
    StructuralFactTape,
    StructuralDomain,
    build_price_memory,
    build_structural_facts,
    build_structural_domains,
    ensure_baseline_hline,
)


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
    domains: tuple[StructuralDomain, ...]
    regression_flows: tuple[RegressionFlow, ...]
    price_memory: tuple[PriceMemoryRidge, ...]
    structural_facts: StructuralFactTape
    relations: tuple[dict[str, Any], ...]
    relation_evidence: tuple[dict[str, Any], ...]
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
    domains, regression_flows = build_structural_domains(tape, features)
    price_memory = build_price_memory(tape, features)
    base_meanings = build_base_candle_meanings(tape, features, config)
    clusters, basis = build_evidence(tape, features, config, base_meanings)
    structural_facts = build_structural_facts(tape, features, basis)
    hline = detect_hlines(tape, features, structural_facts.basis, config, domains)
    trend = detect_trends(tape, features, structural_facts.basis, config, domains)
    hline = ensure_baseline_hline(tape, features, hline, price_memory, config)
    relations, relation_evidence = analyze_pattern_relations(
        tape, features, hline.candidates, trend.candidates,
        domains, regression_flows, structural_facts, limit=config.pattern_max_count,
    )
    selected_hlines, selected_trends, reject_summary = select_boundaries(
        tape, features, hline.candidates, trend.candidates, config
    )
    selected = (*selected_hlines, *selected_trends)
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
        domains=domains,
        regression_flows=regression_flows,
        price_memory=price_memory,
        structural_facts=structural_facts,
        relations=relations,
        relation_evidence=relation_evidence,
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
    boundaries = [
        compile_boundary(
            tape, inference.features, item, inference.inference_id, inference.regression_flows,
        )
        for item in selected
    ]
    drawings = [compile_drawing(tape, item, inference.inference_id) for item in selected]
    drawings.extend(compile_pattern_drawing(tape, item, inference.inference_id) for item in inference.relations)
    try:
        field, field_bytes = build_field_view(
            tape, inference.hline, inference.trend, selected, inference.relations,
            inference.relation_evidence,
            inference.meanings, inference.inference_id, sight_projection_id, config,
            domains=inference.domains,
            regression_flows=inference.regression_flows,
            price_memory=inference.price_memory,
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
            "pattern": {"configuredCount": None, "actualCount": len(inference.relations)},
        },
        "boundaries": boundaries,
        "patternRelations": [_project_relation(item) for item in inference.relations],
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


def _project_relation(relation: dict) -> dict:
    """Public relation metadata; the lossless trace lives once in Field schema 4."""
    return {
        key: value
        for key, value in relation.items()
        if key != "trace"
    } | {
        "traceRef": relation["relationId"],
        "traceAnchorCount": len(relation["trace"]["anchors"]),
        "traceFactCount": len(relation["trace"]["contributingEpisodeIds"]),
    }
