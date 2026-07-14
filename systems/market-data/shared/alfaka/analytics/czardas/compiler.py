from __future__ import annotations

from .features import FeatureTape
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
    ("support", "baseline_memory"): "기준 가격 기억",
    ("resistance", "baseline_memory"): "기준 가격 기억",
}


def compile_boundary(
    tape: CandleTape,
    features: FeatureTape,
    candidate: BoundaryCandidate,
    _inference_id: str,
    regression_flows=(),
) -> dict:
    responses = [item for item in candidate.interactions if item.outcome == "supported_response"]
    current_index = len(tape.candles) - 1
    current_atr = features.atr_scale(current_index, tape.candles[-1].close)
    current_distance_atr = abs(candidate.price_at_as_of - tape.candles[-1].close) / current_atr
    recent_contact = any(current_index - item.contact_index <= 8 for item in candidate.interactions)
    return {
        "candidateId": candidate.candidate_id,
        "kind": candidate.kind,
        "role": candidate.role,
        "evidenceState": candidate.evidence_state,
        "isRelevantNow": current_distance_atr <= 1.0 or recent_contact,
        "line": {
            "slopePerBar": candidate.slope_per_bar,
            "priceAtAsOf": candidate.price_at_as_of,
            "zoneHalfWidth": candidate.zone_half_width,
        },
        "formation": {
            "initialFormationCount": len(candidate.initial_episode_ids),
            "fitCount": len(candidate.fit_episode_ids),
            "lastFitObservedAt": tape.candles[candidate.observed_to_index].timestamp,
            "fitEvidenceConfirmedAt": tape.candles[candidate.fit_evidence_confirmed_index].timestamp,
            "seedQuality": candidate.seed_quality,
        },
        "responses": {
            "completedCount": len(responses),
            "pendingCount": sum(item.outcome == "response_pending" for item in candidate.interactions),
            "responseMass": sum(item.response_score for item in responses),
        },
        "rank": {
            "responseBonus": min(0.10, 0.05 * sum(item.response_score for item in responses)),
            "profileBonus": 0.05 * (candidate.profile_confluence or 0.0),
            "rankScore": candidate.rank_score,
            "integrityFactCount": candidate.integrity_fact_count,
            "integrityEffectiveFactCount": candidate.integrity_effective_fact_count,
            "integrityCoverage": candidate.integrity_coverage,
            "bodyPenetrationCount": candidate.body_penetration_count,
            "closePenetrationCount": candidate.close_penetration_count,
        },
        "explanation": _explanation(candidate, _ols_relation(candidate, regression_flows)),
    }


def compile_drawing(
    tape: CandleTape,
    candidate: BoundaryCandidate,
    inference_id: str,
) -> dict:
    drawing_id = f"czardas:{candidate.candidate_id}:line"
    width = 2
    start = 0 if candidate.kind == "hline" else candidate.observed_from_index
    end = len(tape.candles) - 1
    start_price = candidate.intercept_at_origin + candidate.slope_per_bar * (start - candidate.index_origin)
    end_price = candidate.intercept_at_origin + candidate.slope_per_bar * (end - candidate.index_origin)
    return {
        "id": drawing_id,
        "type": "horizontalLine" if candidate.kind == "hline" else "trendLine",
        "anchors": [
            {"timestamp": tape.candles[start].timestamp, "price": start_price},
            {"timestamp": tape.candles[end].timestamp, "price": end_price},
        ],
        "sourceInterval": tape.interval,
        "style": {"colorToken": "drawing", "lineWidth": width, "extension": "ray" if candidate.kind == "trend" else "line"},
        "visible": True,
        "createdBy": "system",
        "ownership": "czardas-managed",
        "czardasLayer": candidate.kind,
        "sourceCandidateId": candidate.candidate_id,
        "sourceInferenceId": inference_id,
        "sourceFieldModeId": candidate.source_field_mode_id,
        "sourceFieldDerivationDigest": candidate.source_field_derivation_digest,
        "createdAt": tape.as_of,
        "updatedAt": tape.as_of,
    }


def compile_pattern_drawing(tape: CandleTape, relation: dict, inference_id: str) -> dict:
    relation_id = relation["relationId"]
    return {
        "id": f"czardas:{relation_id}:pattern",
        "type": "polyline",
        "anchors": [
            {"timestamp": tape.candles[item["index"]].timestamp, "price": item["price"]}
            for item in relation["trace"]["anchors"]
        ],
        "sourceInterval": tape.interval,
        "style": {"colorToken": "drawing", "lineWidth": 3, "extension": "none"},
        "label": relation["displayName"],
        "visible": True,
        "createdBy": "system",
        "ownership": "czardas-managed",
        "czardasLayer": "pattern",
        "sourceRelationId": relation_id,
        "sourceRelationDerivationDigest": stable_relation_digest(relation),
        "sourceInferenceId": inference_id,
        "createdAt": tape.as_of,
        "updatedAt": tape.as_of,
    }


def stable_relation_digest(relation: dict) -> str:
    from .numeric import stable_hash
    return stable_hash(
        "pattern-relation-derivation",
        relation["relationId"],
        relation["boundaryCandidateIds"],
        relation["trace"]["contributingEpisodeIds"],
        relation["trace"]["anchors"],
    )


def _explanation(candidate, ols_relation=None):
    responses = [item for item in candidate.interactions if item.outcome == "supported_response"]
    because = [f"독립 형성 {len(candidate.fit_episode_ids)}회"]
    if responses:
        because.append(f"형성 이후 반응 {len(responses)}회")
    if candidate.kind == "hline" and (candidate.profile_confluence or 0) > 0:
        because.append(f"OHLCV 추정 거래량 밀집도 {candidate.profile_confluence:.2f}")
    if candidate.evidence_state == "baseline_memory":
        because = ["exact-240의 가격 점유와 endpoint 반응이 가장 강하게 겹친 구간"]
    against = []
    if candidate.kind == "trend" and ols_relation:
        description = (
            f"OLS 중심 흐름과 기울기 합의 ({ols_relation['flowId'][-8:]})"
            if ols_relation["state"] == "consensus"
            else f"OLS 중심 흐름과 robust 경계의 기울기 충돌 ({ols_relation['flowId'][-8:]})"
        )
        (because if ols_relation["state"] == "consensus" else against).append(description)
    return {
        "claim": CLAIMS[(candidate.role, candidate.evidence_state)],
        "because": because,
        "against": against,
        "state": candidate.evidence_state,
        "invalidationCondition": "반대편 0.25 ATR 초과 종가 이탈 2봉",
        "dataQualifier": (
            "거래량 없이도 성립하는 기준 가격 기억; 확정 지지·저항으로 과장하지 않음"
            if candidate.evidence_state == "baseline_memory"
            else "OHLCV 기반 추정 volume-at-price" if candidate.kind == "hline"
            else "OHLCV 구조적 endpoint"
        ),
    }


def _ols_relation(candidate, flows):
    covering = [
        item for item in flows
        if item.start_index <= candidate.observed_from_index
        and item.end_index >= candidate.observed_to_index
    ]
    if not covering:
        return None
    flow = min(covering, key=lambda item: (
        item.end_index - item.start_index, item.domain_id,
    ))
    span = max(1, candidate.observed_to_index - candidate.observed_from_index)
    drift = abs(candidate.slope_per_bar - flow.slope_per_bar) * span
    tolerance = max(candidate.zone_half_width, flow.corridor_half_width)
    return {
        "flowId": flow.flow_id,
        "state": "consensus" if drift <= tolerance else "conflict",
    }
