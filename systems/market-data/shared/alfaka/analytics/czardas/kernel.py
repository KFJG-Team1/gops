from __future__ import annotations

import time
from typing import Any, Iterable

from .compiler import compile_boundary, compile_drawing
from .config import CzardasConfig, DEFAULT_CONFIG
from .evidence import build_evidence
from .features import build_features
from .field import field_snapshot_at
from .field_view import build_field_view
from .hline import detect_hlines
from .numeric import canonical_digest, canonical_json, canonicalize
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
    if not (1 <= config.hline_display_count <= 4 and 1 <= config.trend_display_count <= 3):
        return AnalysisUnavailable("invalid_config")
    try:
        tape = CandleTape.from_rows(rows, config)
    except (TypeError, ValueError) as exc:
        return AnalysisUnavailable(_unavailable_reason(str(exc)), {"message": str(exc)})
    features = build_features(tape, config)
    clusters, basis = build_evidence(tape, features, config)
    hline = detect_hlines(tape, features, basis, config)
    trend = detect_trends(tape, features, basis, config)
    selected_hlines, selected_trends, reject_summary = select_boundaries(
        tape, features, hline.candidates, trend.candidates, config
    )
    selected = (*selected_hlines, *selected_trends)
    relation = select_triangle_relation(tape, features, selected_trends)
    boundaries = [compile_boundary(tape, features, item) for item in selected]
    drawings = [compile_drawing(tape, item, relation) for item in selected]
    try:
        field = build_field_view(tape, hline, trend, selected, relation, config)
    except ValueError as exc:
        return AnalysisUnavailable(str(exc))
    field_snapshot_at(len(tape.candles) - 1, basis, hline.modes, trend.modes)
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
    payload_bytes = len(canonical_json(canonical_content).encode("utf-8"))
    if payload_bytes > config.max_payload_bytes:
        return AnalysisUnavailable("payload_limit_exceeded", {"payloadBytes": payload_bytes})
    return Ready(canonical_content, {
        "contentDigest": canonical_digest(canonical_content),
        "payloadBytes": payload_bytes,
        "fieldBytes": len(canonical_json(canonical_content["czardasField"]).encode("utf-8")),
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
