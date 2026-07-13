from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Iterable

from .compiler import compile_boundary, compile_drawing
from .config import CzardasConfig, DEFAULT_CONFIG
from .evidence import build_evidence
from .features import build_features
from .field_view import build_field_view
from .hline import detect_hlines
from .numeric import canonical_digest, canonicalize
from .meaning import build_base_candle_meanings, finalize_candle_meanings
from .relations import select_triangle_relation
from .select import select_boundaries
from .tape import CandleTape
from .trend import detect_trends
from .types import AnalysisUnavailable, Ready


def analyze_czardas(
    rows: Iterable[dict[str, Any]],
    config: CzardasConfig = DEFAULT_CONFIG,
) -> Ready | AnalysisUnavailable:
    started = time.perf_counter()
    if not (
        1 <= config.hline_display_count <= 4
        and 1 <= config.trend_display_count <= 3
        and 0 < config.target_field_bytes <= config.max_field_bytes
    ):
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
    inference_id = canonical_digest([
        config.algorithm_version,
        config.config_version,
        config.time_contract_version,
        config.calendar_version,
        tape.symbol,
        tape.interval,
        tape.as_of,
        tape.input_digest,
    ])
    meanings = finalize_candle_meanings(
        base_meanings, tape, features, basis, selected
    )
    boundaries = [compile_boundary(tape, features, item, inference_id) for item in selected]
    drawings = [compile_drawing(tape, item, relation, inference_id) for item in selected]
    try:
        field = build_field_view(tape, hline, trend, selected, relation, meanings, inference_id, config)
    except ValueError as exc:
        return AnalysisUnavailable(str(exc))
    content = {
        "algorithmVersion": config.algorithm_version,
        "configVersion": config.config_version,
        "timeContractVersion": config.time_contract_version,
        "calendarVersion": config.calendar_version,
        "symbol": tape.symbol,
        "interval": tape.interval,
        "asOf": tape.as_of,
        "lastCandleKey": tape.last_candle_key,
        "inputDigest": tape.input_digest,
        "inferenceId": inference_id,
        "status": "ready",
        "coverage": {
            "state": "exact",
            "targetCompleted": config.target_completed_bars,
            "actualCompleted": len(tape.candles),
            "analysisBars": len(tape.candles),
            "qualityFlags": [],
        },
        "selection": {
            "hline": {"configuredCount": config.hline_display_count, "actualCount": len(selected_hlines)},
            "trend": {"configuredCount": config.trend_display_count, "actualCount": len(selected_trends)},
        },
        "boundaries": boundaries,
        "presentationPattern": relation,
        "drawings": drawings,
        "czardasField": field,
        "rejectSummary": reject_summary,
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
        "fieldBytes": len(json.dumps(
            canonical_content["czardasField"], ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")),
        "elapsedMs": (time.perf_counter() - started) * 1000.0,
        "clusterCount": len(clusters),
        "basisCount": len(basis),
        "candidateCount": len(hline.candidates) + len(trend.candidates),
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
