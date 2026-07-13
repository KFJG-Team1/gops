from __future__ import annotations

import itertools

from .features import FeatureTape
from .numeric import clamp, harmonic_mean, median, stable_hash
from .tape import CandleTape
from .types import BoundaryCandidate


def select_triangle_relation(
    tape: CandleTape,
    features: FeatureTape,
    trends: tuple[BoundaryCandidate, ...],
) -> dict | None:
    lower = [item for item in trends if item.role == "lower"]
    upper = [item for item in trends if item.role == "upper"]
    relations = []
    for bottom, top in itertools.product(lower, upper):
        relation = _classify(tape, features, top, bottom)
        if relation:
            relations.append(relation)
    if not relations:
        return None
    return max(relations, key=lambda item: (item["relationQuality"], item["relationBars"], -_string_rank(item["triangleId"])))


def _classify(tape, features, upper, lower):
    start = max(upper.observed_from_index, lower.observed_from_index)
    end = len(tape.candles) - 1
    bars = end - start + 1
    if bars < 24:
        return None
    atrs = [features.atr[index] for index in range(start, end + 1) if features.atr[index] is not None]
    relation_atr = median(atrs) if atrs else features.atr_scale(end, tape.candles[-1].close)
    widths = []
    close_inside = body_inside = 0
    for index in range(start, end + 1):
        upper_y = _price(upper, index)
        lower_y = _price(lower, index)
        width = upper_y - lower_y
        if width <= 0:
            return None
        widths.append(width)
        candle = tape.candles[index]
        if lower_y - lower.zone_half_width <= candle.close <= upper_y + upper.zone_half_width:
            close_inside += 1
        body_low, body_high = min(candle.open, candle.close), max(candle.open, candle.close)
        if lower_y - lower.zone_half_width <= body_low and body_high <= upper_y + upper.zone_half_width:
            body_inside += 1
    contraction = widths[-1] / widths[0]
    close_containment = close_inside / bars
    body_containment = body_inside / bars
    if not (
        close_containment >= 0.90
        and body_containment >= 0.85
        and widths[0] >= relation_atr
        and 0.20 <= contraction <= 0.85
    ):
        return None
    slope_difference = lower.slope_per_bar - upper.slope_per_bar
    if slope_difference <= 0:
        return None
    apex = widths[-1] / slope_difference
    if not 0 <= apex <= bars:
        return None
    upper_norm = upper.slope_per_bar / max(relation_atr, 1e-12)
    lower_norm = lower.slope_per_bar / max(relation_atr, 1e-12)
    if abs(upper_norm) <= 0.02 and lower_norm >= 0.02:
        kind, display = "ascending_triangle", "상승 삼각형"
    elif upper_norm <= -0.02 and abs(lower_norm) <= 0.02:
        kind, display = "descending_triangle", "하락 삼각형"
    elif upper_norm <= -0.02 and lower_norm >= 0.02:
        kind, display = "symmetrical_triangle", "대칭 삼각형"
    else:
        return None
    quality = (
        0.70 * harmonic_mean((upper.rank_score, lower.rank_score))
        + 0.20 * clamp((0.85 - contraction) / 0.65)
        + 0.10 * (0.5 * close_containment + 0.5 * body_containment)
    )
    triangle_id = stable_hash(tape.symbol, tape.interval, kind, upper.candidate_id, lower.candidate_id)
    return {
        "triangleId": triangle_id,
        "kind": kind,
        "displayName": display,
        "upperCandidateId": upper.candidate_id,
        "lowerCandidateId": lower.candidate_id,
        "upperDrawingId": f"czardas:{upper.candidate_id}:line",
        "lowerDrawingId": f"czardas:{lower.candidate_id}:line",
        "relationFrom": tape.candles[start].timestamp,
        "relationBars": bars,
        "apexBarsFromAsOf": apex,
        "contractionRatio": contraction,
        "closeContainment": close_containment,
        "bodyContainment": body_containment,
        "relationQuality": quality,
        "lineWidth": 3,
    }


def _price(candidate, index):
    return candidate.intercept_at_origin + candidate.slope_per_bar * (index - candidate.index_origin)


def _string_rank(value: str) -> int:
    return int((value[7:] if value.startswith("sha256:") else value)[:12], 16)
