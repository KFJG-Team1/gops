from __future__ import annotations

from .features import FeatureTape
from .numeric import clamp
from .tape import CandleTape
from .types import BoundaryCandidate


CLAIMS = {
    ("support", "formed"): "지지 경계 형성",
    ("support", "response_supported"): "지지 경계와 독립 반응",
    ("resistance", "formed"): "저항 경계 형성",
    ("resistance", "response_supported"): "저항 경계와 독립 반응",
    ("lower", "formed"): "하단 추세 경계 형성",
    ("lower", "response_supported"): "하단 추세 경계와 독립 반응",
    ("upper", "formed"): "상단 추세 경계 형성",
    ("upper", "response_supported"): "상단 추세 경계와 독립 반응",
}


def compile_boundary(
    tape: CandleTape,
    features: FeatureTape,
    candidate: BoundaryCandidate,
    inference_id: str,
) -> dict:
    responses = [item for item in candidate.interactions if item.outcome == "supported_response"]
    current_index = len(tape.candles) - 1
    current_atr = features.atr_scale(current_index, tape.candles[-1].close)
    current_distance_atr = abs(candidate.price_at_as_of - tape.candles[-1].close) / current_atr
    normalized_distance = clamp(current_distance_atr / 3.0)
    recent_contact = any(current_index - item.contact_index <= 8 for item in candidate.interactions)
    return {
        "candidateId": candidate.candidate_id,
        "sourceInferenceId": inference_id,
        "sourceFieldModeId": candidate.source_field_mode_id,
        "sourceFieldDerivationDigest": candidate.source_field_derivation_digest,
        "kind": candidate.kind,
        "layer": candidate.kind,
        "role": candidate.role,
        "evidenceState": candidate.evidence_state,
        "isRelevantNow": current_distance_atr <= 1.0 or recent_contact,
        "line": {
            "priceSpace": "linear",
            "indexOriginCandleKey": tape.candles[candidate.index_origin].candle_key,
            "slopePerBar": candidate.slope_per_bar,
            "interceptAtOrigin": candidate.intercept_at_origin,
            "priceAtAsOf": candidate.price_at_as_of,
            "zoneHalfWidth": candidate.zone_half_width,
        },
        "observedDomain": {
            "from": tape.candles[candidate.observed_from_index].timestamp,
            "to": tape.candles[candidate.observed_to_index].timestamp,
            "bars": candidate.observed_to_index - candidate.observed_from_index + 1,
        },
        "formation": {
            "initialFormationEpisodeIds": list(candidate.initial_episode_ids),
            "fitEpisodeIds": list(candidate.fit_episode_ids),
            "fitCount": len(candidate.fit_episode_ids),
            "lastFitObservedAt": tape.candles[candidate.observed_to_index].timestamp,
            "fitEvidenceConfirmedAt": tape.candles[candidate.fit_evidence_confirmed_index].timestamp,
            "seedQuality": candidate.seed_quality,
        },
        "responses": {
            "completedCount": len(responses),
            "pendingCount": sum(item.outcome == "response_pending" for item in candidate.interactions),
            "lastInteractionAt": tape.candles[responses[-1].contact_index].timestamp if responses else None,
            "responseMass": sum(item.response_score for item in responses),
        },
        "normalizedCurrentDistance": normalized_distance,
        "rank": {
            "seedQuality": candidate.seed_quality,
            "integrity": candidate.integrity,
            "persistence": candidate.persistence,
            "responseCount": len(responses),
            "responseMass": sum(item.response_score for item in responses),
            "responseBonus": min(0.10, 0.05 * sum(item.response_score for item in responses)),
            "profileBonus": 0.05 * (candidate.profile_confluence or 0.0),
            "rankScore": candidate.rank_score,
            "integrityFactCount": candidate.integrity_fact_count,
            "integrityEffectiveFactCount": candidate.integrity_effective_fact_count,
            "integrityCoverage": candidate.integrity_coverage,
            "bodyPenetrationCount": candidate.body_penetration_count,
            "closePenetrationCount": candidate.close_penetration_count,
        },
        "confluence": {
            "estimatedProfile": candidate.profile_confluence,
            "volumeParticipation": _volume_participation(candidate),
        },
        "explanation": _explanation(candidate),
    }


def compile_drawing(
    tape: CandleTape,
    candidate: BoundaryCandidate,
    triangle: dict | None,
    inference_id: str,
) -> dict:
    drawing_id = f"czardas:{candidate.candidate_id}:line"
    group_id = triangle["triangleId"] if triangle and candidate.candidate_id in {
        triangle["upperCandidateId"], triangle["lowerCandidateId"]
    } else None
    width = 3 if group_id else 2
    start = 0 if candidate.kind == "hline" else candidate.observed_from_index
    end = len(tape.candles) - 1
    start_price = candidate.intercept_at_origin + candidate.slope_per_bar * (start - candidate.index_origin)
    end_price = candidate.intercept_at_origin + candidate.slope_per_bar * (end - candidate.index_origin)
    return {
        "id": drawing_id,
        "type": "horizontalLine" if candidate.kind == "hline" else "trendLine",
        "symbol": tape.symbol,
        "interval": tape.interval,
        "anchors": [
            {"timestamp": tape.candles[start].timestamp, "price": start_price},
            {"timestamp": tape.candles[end].timestamp, "price": end_price},
        ],
        "sourceInterval": tape.interval,
        "style": {"colorToken": "drawing", "lineWidth": width, "extension": "ray" if candidate.kind == "trend" else "line"},
        "label": "",
        "visible": True,
        "locked": False,
        "createdBy": "system",
        "sourceProposalId": f"czardas:{candidate.candidate_id}",
        "ownership": "czardas-managed",
        "czardasLayer": candidate.kind,
        "sourceCandidateId": candidate.candidate_id,
        "sourceInferenceId": inference_id,
        "sourceFieldModeId": candidate.source_field_mode_id,
        "sourceFieldDerivationDigest": candidate.source_field_derivation_digest,
        "sourceGroupId": group_id,
        "createdAt": tape.as_of,
        "updatedAt": tape.as_of,
    }


def _explanation(candidate):
    responses = [item for item in candidate.interactions if item.outcome == "supported_response"]
    because = [f"독립 형성 {len(candidate.fit_episode_ids)}회"]
    if responses:
        because.append(f"형성 이후 반응 {len(responses)}회")
    if candidate.kind == "hline" and (candidate.profile_confluence or 0) > 0:
        because.append(f"OHLCV 추정 거래량 밀집도 {candidate.profile_confluence:.2f}")
    return {
        "claim": CLAIMS[(candidate.role, candidate.evidence_state)],
        "because": because,
        "against": [],
        "state": candidate.evidence_state,
        "invalidationCondition": "반대편 0.25 ATR 초과 종가 이탈 2봉",
        "dataQualifier": "OHLCV 기반 추정 volume-at-price" if candidate.kind == "hline" else "OHLCV 구조적 endpoint",
    }


def _volume_participation(candidate: BoundaryCandidate) -> float | None:
    values = [item.participation for item in candidate.fit_episodes if item.participation is not None]
    return None if candidate.kind != "hline" or not values else sum(values) / len(values)
