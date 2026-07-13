from __future__ import annotations

from .features import FeatureTape
from .numeric import clamp
from .tape import CandleTape
from .types import BoundaryCandidate


CLAIMS = {
    ("support", "formed"): "최근 가격대에서 지지 경계가 형성됨",
    ("support", "verified"): "최근 가격대에서 지지 경계가 형성되고 이후 반응으로 확인됨",
    ("resistance", "formed"): "최근 가격대에서 저항 경계가 형성됨",
    ("resistance", "verified"): "최근 가격대에서 저항 경계가 형성되고 이후 반응으로 확인됨",
    ("lower", "formed"): "최근 저점들이 하단 추세 경계를 형성함",
    ("lower", "verified"): "최근 저점들이 하단 추세 경계를 형성하고 이후 반응으로 확인됨",
    ("upper", "formed"): "최근 고점들이 상단 추세 경계를 형성함",
    ("upper", "verified"): "최근 고점들이 상단 추세 경계를 형성하고 이후 반응으로 확인됨",
}


def compile_boundary(tape: CandleTape, features: FeatureTape, candidate: BoundaryCandidate) -> dict:
    verified = [item for item in candidate.interactions if item.outcome == "verified_response"]
    current_index = len(tape.candles) - 1
    current_atr = features.atr_scale(current_index, tape.candles[-1].close)
    current_distance_atr = abs(candidate.price_at_as_of - tape.candles[-1].close) / current_atr
    normalized_distance = clamp(current_distance_atr / 3.0)
    recent_contact = any(current_index - item.contact_index <= 8 for item in candidate.interactions)
    return {
        "candidateId": candidate.candidate_id,
        "modelRevision": candidate.model_revision,
        "originFieldModeId": candidate.source_field_mode_id,
        "sourceFieldModeId": candidate.source_field_mode_id,
        "sourceFieldRevision": candidate.source_field_revision,
        "kind": candidate.kind,
        "layer": candidate.kind,
        "role": candidate.role,
        "lifecycle": candidate.lifecycle,
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
            "initialEpisodeIds": list(candidate.initial_episode_ids),
            "fitCount": len(candidate.fit_episode_ids),
            "lastFitObservedAt": tape.candles[candidate.observed_to_index].timestamp,
            "seedQuality": candidate.seed_quality,
        },
        "verification": {
            "completedCount": len(verified),
            "pendingCount": sum(item.outcome == "response_pending" for item in candidate.interactions),
            "lastInteractionAt": tape.candles[verified[-1].contact_index].timestamp if verified else None,
        },
        "lineageFormedAt": tape.candles[candidate.lineage_formed_index].timestamp,
        "revisionFormedAt": tape.candles[candidate.revision_formed_index].timestamp,
        "normalizedCurrentDistance": normalized_distance,
        "rank": {
            "seedQuality": candidate.seed_quality,
            "integrity": candidate.integrity,
            "persistence": candidate.persistence,
            "verificationCount": len(verified),
            "verificationMass": sum(item.response_score for item in verified),
            "verificationBonus": min(0.10, 0.05 * sum(item.response_score for item in verified)),
            "profileBonus": 0.05 * (candidate.profile_confluence or 0.0),
            "rankScore": candidate.rank_score,
        },
        "confluence": {
            "estimatedProfile": candidate.profile_confluence,
            "volumeParticipation": _volume_participation(candidate),
        },
        "explanation": _explanation(candidate),
    }


def compile_drawing(tape: CandleTape, candidate: BoundaryCandidate, triangle: dict | None) -> dict:
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
        "sourceFieldModeId": candidate.source_field_mode_id,
        "sourceFieldRevision": candidate.source_field_revision,
        "sourceGroupId": group_id,
        "engineRevision": candidate.model_revision,
        "createdAt": tape.candles[candidate.lineage_formed_index].timestamp,
        "updatedAt": tape.as_of,
    }


def _explanation(candidate):
    verified = [item for item in candidate.interactions if item.outcome == "verified_response"]
    because = [f"독립 형성 {len(candidate.fit_episode_ids)}회"]
    if verified:
        because.append(f"형성 이후 반응 {len(verified)}회")
    if candidate.kind == "hline" and (candidate.profile_confluence or 0) > 0:
        because.append(f"OHLCV 추정 거래량 밀집도 {candidate.profile_confluence:.2f}")
    return {
        "claim": CLAIMS[(candidate.role, candidate.lifecycle)],
        "because": because,
        "against": [],
        "state": candidate.lifecycle,
        "invalidationCondition": "경계 반대편 0.25 ATR 초과 종가 이탈 2봉",
        "dataQualifier": "OHLCV 기반 추정 volume-at-price" if candidate.kind == "hline" else "OHLCV 구조적 endpoint",
    }


def _volume_participation(candidate: BoundaryCandidate) -> float | None:
    values = [item.participation for item in candidate.fit_episodes if item.participation is not None]
    return None if candidate.kind != "hline" or not values else sum(values) / len(values)
