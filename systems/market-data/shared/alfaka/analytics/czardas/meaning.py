from __future__ import annotations

import math
import base64
import struct
from dataclasses import dataclass
from typing import Iterable

from .config import CzardasConfig
from .features import FeatureTape
from .numeric import clamp, median
from .tape import CandleTape
from .types import BoundaryCandidate, RoleBasis


ATR_AVAILABLE = 1
VOLUME_BASELINE_AVAILABLE = 2
RIGHT_CONTEXT_AVAILABLE = 4

GEOMETRY_INPUT = 1
FIT = 2
INTEGRITY = 4
RESPONSE = 8
VISUALIZATION_ONLY = 16
CONFIRMATION_PENDING = 32


REASON_CODEBOOK = (
    (0, "atr_unavailable", "ATR 준비 구간", "visualization_only", "shared"),
    (1, "volume_baseline_unavailable", "거래량 기준선 준비 구간", "visualization_only", "hline"),
    (2, "confirmation_pending", "우측 확인 문맥 대기", "visualization_only", "shared"),
    (3, "shared_range", "ATR 대비 변동폭", "visualization_only", "shared"),
    (4, "shared_return", "ATR 대비 종가 이동", "visualization_only", "shared"),
    (5, "shared_body", "몸통 비율", "visualization_only", "shared"),
    (6, "shared_wick", "꼬리 거부 형태", "visualization_only", "shared"),
    (7, "hline_support", "지지 반응 문맥", "visualization_only", "hline"),
    (8, "hline_resistance", "저항 반응 문맥", "visualization_only", "hline"),
    (9, "trend_lower", "하단 구조 endpoint", "visualization_only", "trend"),
    (10, "trend_upper", "상단 구조 endpoint", "visualization_only", "trend"),
    (11, "hline_alignment", "현재 수평 Field 정렬", "integrity", "hline"),
    (12, "trend_alignment", "현재 추세 Field 정렬", "integrity", "trend"),
    (13, "confirmed_basis", "확인된 구조 근거", "geometry_input", "shared"),
    (14, "fit_evidence", "현재 경계 fitting 근거", "fit", "shared"),
    (15, "response_fact", "독립 반응 근거", "response", "shared"),
    (16, "hline_penetration", "수평 경계 몸통 침투", "integrity", "hline"),
    (17, "trend_residual", "추세 경계 endpoint 잔차", "integrity", "trend"),
    (18, "reclaim", "경계 탐색 후 종가 회복", "integrity", "shared"),
    (19, "support_role_basis_input", "지지 역할값이 RoleBasis 질량에 기여", "geometry_input", "hline"),
    (20, "resistance_role_basis_input", "저항 역할값이 RoleBasis 질량에 기여", "geometry_input", "hline"),
    (21, "lower_role_basis_input", "하단 역할값이 RoleBasis 질량에 기여", "geometry_input", "trend"),
    (22, "upper_role_basis_input", "상단 역할값이 RoleBasis 질량에 기여", "geometry_input", "trend"),
    (23, "support_boundary_unavailable", "선택된 지지 H-Line 경계 없음", "visualization_only", "hline"),
    (24, "resistance_boundary_unavailable", "선택된 저항 H-Line 경계 없음", "visualization_only", "hline"),
    (25, "lower_boundary_unavailable", "선택된 하단 Trend 경계 없음", "visualization_only", "trend"),
    (26, "upper_boundary_unavailable", "선택된 상단 Trend 경계 없음", "visualization_only", "trend"),
)

ROLE_BASIS_REASON = {
    "support": 19,
    "resistance": 20,
    "lower": 21,
    "upper": 22,
}

BOUNDARY_UNAVAILABLE_REASON = {
    ("hline", "support"): 23,
    ("hline", "resistance"): 24,
    ("trend", "lower"): 25,
    ("trend", "upper"): 26,
}

RAW_FACTOR_SCALES = {
    "rangeAtr": 1000,
    "absoluteReturnAtr": 1000,
    "bodyFraction": 1000,
    "lowerWickFraction": 1000,
    "upperWickFraction": 1000,
    "volumeRank": 1000,
    "volumeZ": 1000,
    "participation": 1000,
    "localHighR2": 1000,
    "localLowR2": 1000,
    "localHighR5": 1000,
    "localLowR5": 1000,
    "localHighR13": 1000,
    "localLowR13": 1000,
    "supportProximity": 1000,
    "resistanceProximity": 1000,
    "lowerResidualAtr": 1000,
    "upperResidualAtr": 1000,
    "hlinePenetrationAtr": 1000,
    "trendPenetrationAtr": 1000,
    "reclaimStrength": 1000,
}

RAW_FACTOR_TRANSFORMS = {
    key: "log1p" if key in {
        "rangeAtr", "absoluteReturnAtr", "lowerResidualAtr", "upperResidualAtr",
        "hlinePenetrationAtr", "trendPenetrationAtr",
    } else "linear"
    for key in RAW_FACTOR_SCALES
}

FACTOR_CODEBOOK_VERSION = "czardas-factor-codebook-v4"
_FACTOR_PRESENTATION = {
    "rangeAtr": ("변동폭 / ATR", "shared"),
    "absoluteReturnAtr": ("절대 등락 / ATR", "shared"),
    "bodyFraction": ("몸통 비율", "shared"),
    "lowerWickFraction": ("아래꼬리 비율", "shared"),
    "upperWickFraction": ("위꼬리 비율", "shared"),
    "localHighR2": ("주변 고점 관계 · R2", "shared"),
    "localLowR2": ("주변 저점 관계 · R2", "shared"),
    "localHighR5": ("주변 고점 관계 · R5", "shared"),
    "localLowR5": ("주변 저점 관계 · R5", "shared"),
    "localHighR13": ("주변 고점 관계 · R13", "shared"),
    "localLowR13": ("주변 저점 관계 · R13", "shared"),
    "volumeRank": ("거래량 순위", "hline"),
    "volumeZ": ("거래량 편차", "hline"),
    "participation": ("거래 참여도", "hline"),
    "supportProximity": ("지지 Field 근접도", "hline"),
    "resistanceProximity": ("저항 Field 근접도", "hline"),
    "hlinePenetrationAtr": ("H-Line 관통 / ATR", "hline"),
    "reclaimStrength": ("돌파 후 회복 강도", "hline"),
    "lowerResidualAtr": ("하단 Trend 잔차 / ATR", "trend"),
    "upperResidualAtr": ("상단 Trend 잔차 / ATR", "trend"),
    "trendPenetrationAtr": ("Trend 관통 / ATR", "trend"),
}
FACTOR_CODEBOOK = tuple(
    {
        "key": key,
        "label": _FACTOR_PRESENTATION[key][0],
        "channel": _FACTOR_PRESENTATION[key][1],
        "scale": RAW_FACTOR_SCALES[key],
        "transform": RAW_FACTOR_TRANSFORMS[key],
    }
    for key in RAW_FACTOR_SCALES
)


@dataclass(frozen=True, slots=True)
class CandleMeaningTape:
    raw_factors: dict[str, tuple[float | None, ...]]
    normalized_factors: dict[str, tuple[float | None, ...]]
    shared: tuple[float, ...]
    support: tuple[float, ...]
    resistance: tuple[float, ...]
    lower: tuple[float, ...]
    upper: tuple[float, ...]
    hline: tuple[float, ...]
    trend: tuple[float, ...]
    composite_percentile: tuple[float, ...]
    availability_masks: tuple[int, ...]
    phase_masks: tuple[int, ...]
    reason_refs: tuple[tuple[int, ...], ...]

    def to_dto(self, tape: CandleTape) -> dict:
        return {
            "evaluationAsOf": tape.as_of,
            "codebookVersion": FACTOR_CODEBOOK_VERSION,
            "factorCodebook": list(FACTOR_CODEBOOK),
            "rawFactorScales": RAW_FACTOR_SCALES,
            "rawFactorTransforms": RAW_FACTOR_TRANSFORMS,
            "normalizedFactorScale": 1000,
            "scoreScale": 1000,
            "rawFactorEncoding": "int16-base64-be",
            "normalizedFactorEncoding": "int16-base64-be",
            "rawFactorNullSentinel": -32768,
            "normalizedFactorNullSentinel": -32768,
            "rawFactorRanges": {
                key: (
                    [0.0, math.expm1(32767 / scale)]
                    if RAW_FACTOR_TRANSFORMS[key] == "log1p"
                    else [-32767 / scale, 32767 / scale]
                )
                for key, scale in RAW_FACTOR_SCALES.items()
            },
            "rawFactorOverflowPolicy": "reject",
            "candleKeys": [item.candle_key for item in tape.candles],
            "timestamps": [item.timestamp for item in tape.candles],
            "summaries": {
                "shared": _fixed_point(self.shared),
                "hline": _fixed_point(self.hline),
                "trend": _fixed_point(self.trend),
                "compositePercentile": _fixed_point(self.composite_percentile),
            },
            "roles": {
                "support": _fixed_point(self.support),
                "resistance": _fixed_point(self.resistance),
                "lower": _fixed_point(self.lower),
                "upper": _fixed_point(self.upper),
            },
            "factors": {
                key: _packed_fixed_point(
                    values, key, RAW_FACTOR_SCALES[key], RAW_FACTOR_TRANSFORMS[key]
                )
                for key, values in self.raw_factors.items()
            },
            "normalizedFactors": {key: _packed_fixed_point(values, key) for key, values in self.normalized_factors.items()},
            "availabilityMasks": list(self.availability_masks),
            "availabilityCodebook": {
                "atr": ATR_AVAILABLE,
                "volumeBaseline": VOLUME_BASELINE_AVAILABLE,
                "rightContext": RIGHT_CONTEXT_AVAILABLE,
            },
            "phaseMasks": list(self.phase_masks),
            "phaseCodebook": {
                "geometryInput": GEOMETRY_INPUT,
                "fit": FIT,
                "integrity": INTEGRITY,
                "response": RESPONSE,
                "visualizationOnly": VISUALIZATION_ONLY,
                "confirmationPending": CONFIRMATION_PENDING,
            },
            "reasonCodebook": [
                {"code": code, "key": key, "label": label, "usage": usage, "channel": channel}
                for code, key, label, usage, channel in REASON_CODEBOOK
            ],
            "reasonEncoding": "uint32-bitmask-base64-be",
            "reasonMasks": _packed_reason_masks(self.reason_refs),
        }


def build_base_candle_meanings(
    tape: CandleTape,
    features: FeatureTape,
    config: CzardasConfig,
) -> CandleMeaningTape:
    """Evaluate every bar from the one current exact-240 snapshot.

    Values describe how the current snapshot uses and relates to a candle.
    Historical Czardas decision states are not reconstructed here.
    """
    candles = tape.candles
    count = len(candles)
    ranges = [item.high - item.low for item in candles]
    range_atr: list[float | None] = []
    absolute_return_atr: list[float | None] = []
    body_fraction: list[float | None] = []
    lower_wick_fraction: list[float | None] = []
    upper_wick_fraction: list[float | None] = []
    volume_rank: list[float | None] = []
    volume_z: list[float | None] = []
    participation: list[float | None] = []
    local_high = {radius: [] for radius in config.extrema_radii}
    local_low = {radius: [] for radius in config.extrema_radii}
    availability: list[int] = []

    max_radius = max(config.extrema_radii)
    for index, candle in enumerate(candles):
        atr = features.atr[index]
        span = ranges[index]
        has_atr = atr is not None and atr > 0
        has_volume = index >= config.volume_baseline
        has_right = index + max_radius < count
        mask = (ATR_AVAILABLE if has_atr else 0) | (VOLUME_BASELINE_AVAILABLE if has_volume else 0)
        mask |= RIGHT_CONTEXT_AVAILABLE if has_right else 0
        availability.append(mask)
        range_atr.append(span / atr if has_atr else None)
        if index and has_atr:
            absolute_return_atr.append(abs(candle.close - candles[index - 1].close) / atr)
        else:
            absolute_return_atr.append(None)
        denominator = max(span, 1e-12)
        body_fraction.append((features.body_high[index] - features.body_low[index]) / denominator)
        lower_wick_fraction.append(features.lower_wick[index] / denominator)
        upper_wick_fraction.append(features.upper_wick[index] / denominator)
        volume_rank.append(features.volume_rank[index] if has_volume else None)
        volume_z.append(features.volume_z[index] if has_volume else None)
        participation.append(features.participation[index] if has_volume else None)
        for radius in config.extrema_radii:
            start, stop = max(0, index - radius), min(count, index + radius + 1)
            highs = [item.high for item in candles[start:stop]]
            lows = [item.low for item in candles[start:stop]]
            high_span = max(highs) - min(highs)
            low_span = max(lows) - min(lows)
            local_high[radius].append(0.5 if high_span <= 1e-12 else (candle.high - min(highs)) / high_span)
            local_low[radius].append(0.5 if low_span <= 1e-12 else (max(lows) - candle.low) / low_span)

    raw = {
        "rangeAtr": tuple(range_atr),
        "absoluteReturnAtr": tuple(absolute_return_atr),
        "bodyFraction": tuple(body_fraction),
        "lowerWickFraction": tuple(lower_wick_fraction),
        "upperWickFraction": tuple(upper_wick_fraction),
        "volumeRank": tuple(volume_rank),
        "volumeZ": tuple(volume_z),
        "participation": tuple(participation),
        **{f"localHighR{radius}": tuple(local_high[radius]) for radius in config.extrema_radii},
        **{f"localLowR{radius}": tuple(local_low[radius]) for radius in config.extrema_radii},
    }
    normalized = {key: _robust_normalize(values, key) for key, values in raw.items()}

    shared: list[float] = []
    support: list[float] = []
    resistance: list[float] = []
    lower: list[float] = []
    upper: list[float] = []
    phase_masks = [VISUALIZATION_ONLY for _ in range(count)]
    reason_refs: list[list[int]] = [[] for _ in range(count)]
    for index in range(count):
        range_value = _number(normalized["rangeAtr"][index])
        return_value = _number(normalized["absoluteReturnAtr"][index])
        body_value = _number(normalized["bodyFraction"][index])
        lower_wick_value = _number(normalized["lowerWickFraction"][index])
        upper_wick_value = _number(normalized["upperWickFraction"][index])
        local_high_values = [_number(normalized[f"localHighR{radius}"][index]) for radius in config.extrema_radii]
        local_low_values = [_number(normalized[f"localLowR{radius}"][index]) for radius in config.extrema_radii]
        local_high_value = math.sqrt(math.fsum(value * value for value in local_high_values) / len(local_high_values))
        local_low_value = math.sqrt(math.fsum(value * value for value in local_low_values) / len(local_low_values))
        available_shared = [
            value for value in (
                normalized["rangeAtr"][index], normalized["absoluteReturnAtr"][index],
                normalized["bodyFraction"][index], normalized["lowerWickFraction"][index],
                normalized["upperWickFraction"][index],
                *(normalized[f"localHighR{radius}"][index] for radius in config.extrema_radii),
                *(normalized[f"localLowR{radius}"][index] for radius in config.extrema_radii),
            )
            if value is not None
        ]
        shared.append(math.sqrt(math.fsum(value * value for value in available_shared) / len(available_shared)))
        volume_value = normalized["participation"][index]
        support_base = (
            0.40 * local_low_value + 0.20 * lower_wick_value + 0.15 * range_value + 0.15 * return_value
        )
        resistance_base = (
            0.40 * local_high_value + 0.20 * upper_wick_value + 0.15 * range_value + 0.15 * return_value
        )
        if volume_value is None:
            support.append(clamp(support_base / 0.90))
            resistance.append(clamp(resistance_base / 0.90))
        else:
            support.append(clamp(support_base + 0.10 * volume_value))
            resistance.append(clamp(resistance_base + 0.10 * volume_value))
        # Trend meaning is intentionally independent of every volume factor.
        lower.append(clamp(0.55 * local_low_value + 0.20 * lower_wick_value + 0.15 * range_value + 0.10 * return_value))
        upper.append(clamp(0.55 * local_high_value + 0.20 * upper_wick_value + 0.15 * range_value + 0.10 * return_value))
        if range_value >= max(return_value, body_value, lower_wick_value, upper_wick_value):
            reason_refs[index].append(3)
        elif return_value >= max(body_value, lower_wick_value, upper_wick_value):
            reason_refs[index].append(4)
        elif body_value >= max(lower_wick_value, upper_wick_value):
            reason_refs[index].append(5)
        else:
            reason_refs[index].append(6)
        reason_refs[index].append(7 if support[-1] >= resistance[-1] else 8)
        reason_refs[index].append(9 if lower[-1] >= upper[-1] else 10)
        if not (availability[index] & ATR_AVAILABLE):
            reason_refs[index].append(0)
        if not (availability[index] & VOLUME_BASELINE_AVAILABLE):
            reason_refs[index].append(1)
        if _confirmation_pending(tape, index, config):
            phase_masks[index] |= CONFIRMATION_PENDING
            reason_refs[index].append(2)

    hline = tuple(max(support[index], resistance[index]) for index in range(count))
    trend = tuple(max(lower[index], upper[index]) for index in range(count))
    composite = _percentiles([shared[index] + hline[index] + trend[index] for index in range(count)])
    return CandleMeaningTape(
        raw, normalized, tuple(shared), tuple(support), tuple(resistance), tuple(lower), tuple(upper),
        hline, trend, composite, tuple(availability), tuple(phase_masks),
        tuple(tuple(values) for values in reason_refs),
    )


def finalize_candle_meanings(
    base: CandleMeaningTape,
    tape: CandleTape,
    features: FeatureTape,
    basis: tuple[RoleBasis, ...],
    selected: tuple[BoundaryCandidate, ...],
) -> CandleMeaningTape:
    count = len(tape.candles)
    support = list(base.support)
    resistance = list(base.resistance)
    lower = list(base.lower)
    upper = list(base.upper)
    phase_masks = list(base.phase_masks)
    reason_refs = [list(values) for values in base.reason_refs]
    relation_raw = {
        "supportProximity": [],
        "resistanceProximity": [],
        "lowerResidualAtr": [],
        "upperResidualAtr": [],
        "hlinePenetrationAtr": [],
        "trendPenetrationAtr": [],
        "reclaimStrength": [],
    }
    basis_roles_by_index: dict[int, set[str]] = {}
    for item in basis:
        basis_roles_by_index.setdefault(item.bar_index, set()).add(item.role)
    selected_roles = {(item.kind, item.role) for item in selected}
    fit_basis_ids = {basis_id for item in selected for episode in item.fit_episodes for basis_id in episode.member_basis_ids}
    basis_by_id = {item.basis_id: item for item in basis}
    fit_indexes = {basis_by_id[item].bar_index for item in fit_basis_ids if item in basis_by_id}
    response_indexes = {
        event.contact_index
        for item in selected
        for event in item.interactions
        if event.outcome == "supported_response"
    }
    for index in range(count):
        h_support, h_resistance, h_penetration, h_reclaim = _hline_relation(
            tape, features, selected, index
        )
        lower_residual, upper_residual, t_penetration, t_reclaim = _trend_relation(
            tape, features, selected, index
        )
        t_lower = None if lower_residual is None else math.exp(-lower_residual)
        t_upper = None if upper_residual is None else math.exp(-upper_residual)
        relation_raw["supportProximity"].append(h_support)
        relation_raw["resistanceProximity"].append(h_resistance)
        relation_raw["lowerResidualAtr"].append(lower_residual)
        relation_raw["upperResidualAtr"].append(upper_residual)
        relation_raw["hlinePenetrationAtr"].append(h_penetration)
        relation_raw["trendPenetrationAtr"].append(t_penetration)
        relation_raw["reclaimStrength"].append(max(h_reclaim or 0.0, t_reclaim or 0.0) if h_reclaim is not None or t_reclaim is not None else None)
        if h_support is not None or h_resistance is not None:
            support[index] = clamp(0.65 * support[index] + 0.35 * (h_support or 0.0))
            resistance[index] = clamp(0.65 * resistance[index] + 0.35 * (h_resistance or 0.0))
            phase_masks[index] |= INTEGRITY
            reason_refs[index].append(11)
            if (h_penetration or 0.0) > 0:
                reason_refs[index].append(16)
        if t_lower is not None or t_upper is not None:
            lower[index] = clamp(0.65 * lower[index] + 0.35 * (t_lower or 0.0))
            upper[index] = clamp(0.65 * upper[index] + 0.35 * (t_upper or 0.0))
            phase_masks[index] |= INTEGRITY
            reason_refs[index].append(12)
            reason_refs[index].append(17)
        if (h_reclaim or 0.0) > 0 or (t_reclaim or 0.0) > 0:
            reason_refs[index].append(18)
        basis_roles = basis_roles_by_index.get(index, ())
        if basis_roles:
            phase_masks[index] |= GEOMETRY_INPUT
            reason_refs[index].append(13)
            reason_refs[index].extend(
                ROLE_BASIS_REASON[role]
                for role in sorted(basis_roles)
            )
        if index in fit_indexes:
            phase_masks[index] |= FIT
            reason_refs[index].append(14)
        if index in response_indexes:
            phase_masks[index] |= RESPONSE
            reason_refs[index].append(15)
        reason_refs[index].extend(
            reason_code
            for role_key, reason_code in BOUNDARY_UNAVAILABLE_REASON.items()
            if role_key not in selected_roles
        )
        reason_refs[index] = list(dict.fromkeys(reason_refs[index]))

    hline = tuple(max(support[index], resistance[index]) for index in range(count))
    trend = tuple(max(lower[index], upper[index]) for index in range(count))
    composite = _percentiles([base.shared[index] + hline[index] + trend[index] for index in range(count)])
    raw_factors = {**base.raw_factors, **{key: tuple(values) for key, values in relation_raw.items()}}
    normalized_factors = {
        **base.normalized_factors,
        **{key: _robust_normalize(values, key) for key, values in relation_raw.items()},
    }
    return CandleMeaningTape(
        raw_factors,
        normalized_factors,
        base.shared,
        tuple(support),
        tuple(resistance),
        tuple(lower),
        tuple(upper),
        hline,
        trend,
        composite,
        base.availability_masks,
        tuple(phase_masks),
        tuple(tuple(values) for values in reason_refs),
    )


def _robust_normalize(values: Iterable[float | None], factor_name: str = "") -> tuple[float | None, ...]:
    source = tuple(values)
    present = [float(value) for value in source if value is not None and math.isfinite(value)]
    if not present:
        return tuple(None for _ in source)
    center = median(present)
    mad = median(abs(value - center) for value in present)
    semantic_floor = 0.025 if factor_name == "volumeRank" else 0.001
    scale = max(1.4826 * mad, semantic_floor)
    return tuple(
        None
        if value is None
        else 0.5
        if abs(float(value) - center) <= semantic_floor
        else clamp(0.5 + (float(value) - center) / (6.0 * scale))
        for value in source
    )


def _percentiles(values: list[float]) -> tuple[float, ...]:
    ordered = sorted((value, index) for index, value in enumerate(values))
    result = [0.0] * len(values)
    cursor = 0
    while cursor < len(ordered):
        end = cursor + 1
        while end < len(ordered) and abs(ordered[end][0] - ordered[cursor][0]) <= 1e-12:
            end += 1
        percentile = 0.5 if len(values) == 1 else ((cursor + end - 1) / 2.0) / (len(values) - 1)
        for _value_at_rank, index in ordered[cursor:end]:
            result[index] = percentile
        cursor = end
    return tuple(result)


def _hline_relation(tape, features, candidates, index):
    candle = tape.candles[index]
    atr = features.atr_scale(index, candle.close)
    support = resistance = None
    penetration = reclaim = None
    by_role = {}
    for candidate in candidates:
        if candidate.kind != "hline":
            continue
        price = candidate.intercept_at_origin + candidate.slope_per_bar * (index - candidate.index_origin)
        distance = max(0.0, candle.low - (price + candidate.zone_half_width),
                       (price - candidate.zone_half_width) - candle.high)
        proximity = math.exp(-distance / max(atr, 1e-12))
        current = by_role.get(candidate.role)
        if current is not None and (-proximity, candidate.candidate_id) >= (-current[0], current[1].candidate_id):
            continue
        by_role[candidate.role] = (proximity, candidate, price)
    for role, (proximity, candidate, price) in by_role.items():
        if role == "support":
            support = proximity
            body_depth = max(0.0, price - candidate.zone_half_width - features.body_low[index]) / atr
            wick_depth = max(0.0, price - candidate.zone_half_width - candle.low) / atr
            valid_close = candle.close >= price - candidate.zone_half_width
        else:
            resistance = proximity
            body_depth = max(0.0, features.body_high[index] - price - candidate.zone_half_width) / atr
            wick_depth = max(0.0, candle.high - price - candidate.zone_half_width) / atr
            valid_close = candle.close <= price + candidate.zone_half_width
        penetration = max(penetration or 0.0, body_depth)
        reclaim = max(reclaim or 0.0, clamp(wick_depth) if valid_close else 0.0)
    return support, resistance, penetration, reclaim


def _trend_relation(tape, features, candidates, index):
    candle = tape.candles[index]
    atr = features.atr_scale(index, candle.close)
    lower = upper = None
    penetration = reclaim = None
    by_role = {}
    for candidate in candidates:
        if candidate.kind != "trend":
            continue
        price = candidate.intercept_at_origin + candidate.slope_per_bar * (index - candidate.index_origin)
        endpoint = candle.low if candidate.role == "lower" else candle.high
        residual = max(0.0, abs(endpoint - price) - candidate.zone_half_width) / max(atr, 1e-12)
        current = by_role.get(candidate.role)
        if current is not None and (residual, candidate.candidate_id) >= (current[0], current[1].candidate_id):
            continue
        by_role[candidate.role] = (residual, candidate, price)
    for role, (residual, candidate, price) in by_role.items():
        if role == "lower":
            lower = residual
            body_depth = max(0.0, price - candidate.zone_half_width - features.body_low[index]) / atr
            wick_depth = max(0.0, price - candidate.zone_half_width - candle.low) / atr
            valid_close = candle.close >= price - candidate.zone_half_width
        else:
            upper = residual
            body_depth = max(0.0, features.body_high[index] - price - candidate.zone_half_width) / atr
            wick_depth = max(0.0, candle.high - price - candidate.zone_half_width) / atr
            valid_close = candle.close <= price + candidate.zone_half_width
        penetration = max(penetration or 0.0, body_depth)
        reclaim = max(reclaim or 0.0, clamp(wick_depth) if valid_close else 0.0)
    return lower, upper, penetration, reclaim


def _confirmation_pending(tape, index, config):
    candles = tape.candles
    for radius in config.extrema_radii:
        if index < radius or index + radius < len(candles):
            continue
        left = candles[index - radius:index]
        candle = candles[index]
        if candle.high >= max(item.high for item in left) or candle.low <= min(item.low for item in left):
            return True
    return False


def _number(value: float | None, default: float = 0.0) -> float:
    return default if value is None else value


def _fixed_point(values, scale=1000):
    return [None if value is None else int(round(float(value) * scale)) for value in values]


def _packed_fixed_point(values, factor_name, scale=1000, transform="linear"):
    encoded = []
    for value in values:
        if value is None:
            encoded.append(-32768)
            continue
        transformed = math.log1p(float(value)) if transform == "log1p" else float(value)
        quantized = int(round(transformed * scale))
        if quantized < -32767 or quantized > 32767:
            raise ValueError(f"factor_encoding_overflow:{factor_name}")
        encoded.append(quantized)
    return base64.b64encode(struct.pack(f">{len(encoded)}h", *encoded)).decode("ascii")


def _packed_reason_masks(reason_refs):
    masks = [sum(1 << code for code in codes) for codes in reason_refs]
    return base64.b64encode(struct.pack(f">{len(masks)}I", *masks)).decode("ascii")
