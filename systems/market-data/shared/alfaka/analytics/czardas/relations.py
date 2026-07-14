from __future__ import annotations

import itertools
import math

from .features import FeatureTape
from .numeric import clamp, harmonic_mean, median, stable_hash
from .structure import RegressionFlow, StructuralDomain, StructuralFactTape, impulse_to_dto
from .tape import CandleTape
from .types import BoundaryCandidate


PATTERN_NAMES = {
    "triangle": "삼각형",
    "channel": "채널",
    "rectangle": "직사각형",
    "wedge": "쐐기",
    "flag": "플래그",
    "pennant": "페넌트",
}


def analyze_pattern_relations(
    tape: CandleTape,
    features: FeatureTape,
    hlines: tuple[BoundaryCandidate, ...],
    trends: tuple[BoundaryCandidate, ...],
    domains: tuple[StructuralDomain, ...],
    flows: tuple[RegressionFlow, ...],
    structural_facts: StructuralFactTape,
    *,
    limit: int = 2,
) -> tuple[tuple[dict, ...], tuple[dict, ...]]:
    """Read Pattern as relations among existing Field primitives.

    No boundary is fitted here.  A relation can therefore survive scene
    selection without silently becoming a second Trend/H-Line detector.
    """

    candidates: list[dict] = []
    evidence: list[dict] = []
    hard_trends = [item for item in trends if item.evidence_state != "baseline_memory"]
    hard_hlines = [item for item in hlines if item.evidence_state != "baseline_memory"]
    for lower, upper in itertools.product(
        (item for item in hard_trends if item.role == "lower"),
        (item for item in hard_trends if item.role == "upper"),
    ):
        relation = _classify_boundary_pair(tape, features, lower, upper, domains, flows, structural_facts)
        if relation is not None:
            candidates.append(relation)
        primitive = _relation_evidence(tape, (lower, upper), "trend_pair")
        if primitive is not None:
            evidence.append(primitive)
    for support, resistance in itertools.product(
        (item for item in hard_hlines if item.role == "support"),
        (item for item in hard_hlines if item.role == "resistance"),
    ):
        relation = _classify_rectangle(tape, features, support, resistance, domains, flows)
        if relation is not None:
            candidates.append(relation)
        primitive = _relation_evidence(tape, (support, resistance), "price_memory_pair")
        if primitive is not None:
            evidence.append(primitive)
    ordered = sorted(
        candidates,
        key=lambda item: (
            -item["relationQuality"],
            -item["relationBars"],
            item["kind"],
            item["relationId"],
        ),
    )
    selected: list[dict] = []
    used_boundaries: set[str] = set()
    for item in ordered:
        boundary_ids = set(item["boundaryCandidateIds"])
        if boundary_ids & used_boundaries:
            continue
        selected.append(item)
        used_boundaries.update(boundary_ids)
        if len(selected) >= limit:
            break
    selected_pairs = {tuple(item["boundaryCandidateIds"]) for item in selected}
    evidence = [
        item for item in evidence
        if tuple(item["boundaryCandidateIds"]) not in selected_pairs
    ]
    evidence.sort(key=lambda item: (
        -len(item["trace"]["anchors"]),
        -item["evidenceBars"],
        item["evidenceId"],
    ))
    # One unpromoted representative is enough to explain that the Pattern
    # layer has relational evidence without turning Sight into a search dump.
    return tuple(selected), tuple(evidence[:1])


def _relation_evidence(tape, boundaries, evidence_kind):
    start = max(item.observed_from_index for item in boundaries)
    end = len(tape.candles) - 1
    if end - start + 1 < 12:
        return None
    trace = _trace(tape, boundaries, start, end)
    if len(trace["anchors"]) < 3:
        return None
    boundary_ids = sorted(item.candidate_id for item in boundaries)
    evidence_id = stable_hash(
        "pattern-evidence", tape.symbol, tape.interval, evidence_kind,
        boundary_ids, trace["contributingEpisodeIds"],
    )
    return {
        "evidenceId": evidence_id,
        "kind": evidence_kind,
        "boundaryCandidateIds": boundary_ids,
        "evidenceBars": end - start + 1,
        "trace": trace,
    }


def _classify_boundary_pair(tape, features, lower, upper, domains, flows, structural_facts):
    start = max(lower.observed_from_index, upper.observed_from_index)
    end = min(len(tape.candles) - 1, max(lower.observed_to_index, upper.observed_to_index, len(tape.candles) - 1))
    if end - start + 1 < 12:
        return None
    metrics = _pair_metrics(tape, features, lower, upper, start, end)
    if metrics is None:
        return None
    atr, widths, close_containment, body_containment = metrics
    if close_containment < 0.82 or body_containment < 0.72 or widths[0] < 0.75 * atr:
        return None
    contraction = widths[-1] / widths[0]
    upper_norm = upper.slope_per_bar / max(atr, 1e-12)
    lower_norm = lower.slope_per_bar / max(atr, 1e-12)
    impulse = impulse_to_dto(tape, structural_facts.preceding_impulse(start))
    classification = _classify_trend_relation(
        upper_norm=upper_norm,
        lower_norm=lower_norm,
        contraction=contraction,
        relation_bars=end - start + 1,
        impulse_direction=None if impulse is None else impulse["direction"],
    )
    if classification is None:
        return None
    kind, legacy_kind = classification
    trace = _trace(tape, (lower, upper), start, end)
    if len(trace["anchors"]) < 3:
        return None
    relation_quality = clamp(
        0.58 * harmonic_mean((lower.rank_score, upper.rank_score))
        + 0.24 * (0.5 * close_containment + 0.5 * body_containment)
        + 0.18 * (clamp((1.0 - contraction) / 0.82) if contraction < 1 else clamp(1.28 - contraction))
    )
    return _relation(
        tape, kind, (lower, upper), start, end, trace, relation_quality,
        contraction, close_containment, body_containment, domains, flows,
        impulse=impulse, legacy_kind=legacy_kind,
    )


def _classify_trend_relation(
    *,
    upper_norm: float,
    lower_norm: float,
    contraction: float,
    relation_bars: int,
    impulse_direction: int | None,
) -> tuple[str, str | None] | None:
    """Name an already-fitted pair without creating another detector.

    Keeping this grammar pure makes family boundaries testable while all
    price fits, contacts and impulse facts remain owned by the common Field.
    """

    slope_gap = lower_norm - upper_norm
    center_slope = (lower_norm + upper_norm) / 2.0
    if slope_gap > 0.015 and 0.18 <= contraction <= 0.88:
        if upper_norm * lower_norm > 0 and min(abs(upper_norm), abs(lower_norm)) >= 0.01:
            return "wedge", None
        kind = "pennant" if impulse_direction is not None and relation_bars <= 72 else "triangle"
        if abs(upper_norm) <= 0.02 and lower_norm >= 0.02:
            legacy_kind = "ascending_triangle"
        elif upper_norm <= -0.02 and abs(lower_norm) <= 0.02:
            legacy_kind = "descending_triangle"
        else:
            legacy_kind = "symmetrical_triangle"
        return kind, legacy_kind
    if abs(slope_gap) <= 0.025 and 0.72 <= contraction <= 1.28:
        is_flag = impulse_direction is not None and center_slope * impulse_direction <= 0.01
        return ("flag" if is_flag else "channel"), None
    return None


def _classify_rectangle(tape, features, support, resistance, domains, flows):
    start = max(support.observed_from_index, resistance.observed_from_index)
    end = len(tape.candles) - 1
    if end - start + 1 < 12 or support.price_at_as_of >= resistance.price_at_as_of:
        return None
    metrics = _pair_metrics(tape, features, support, resistance, start, end)
    if metrics is None:
        return None
    atr, widths, close_containment, body_containment = metrics
    if widths[0] < atr or close_containment < 0.84 or body_containment < 0.74:
        return None
    trace = _trace(tape, (support, resistance), start, end)
    roles = {item["role"] for item in trace["anchors"]}
    if len(trace["anchors"]) < 3 or roles != {"support", "resistance"}:
        return None
    quality = clamp(
        0.62 * harmonic_mean((support.rank_score, resistance.rank_score))
        + 0.38 * (0.5 * close_containment + 0.5 * body_containment)
    )
    return _relation(
        tape, "rectangle", (support, resistance), start, end, trace, quality,
        1.0, close_containment, body_containment, domains, flows,
    )


def _relation(
    tape, kind, boundaries, start, end, trace, quality, contraction,
    close_containment, body_containment, domains, flows, *, impulse=None, legacy_kind=None,
):
    boundary_ids = tuple(sorted(item.candidate_id for item in boundaries))
    relation_id = stable_hash(
        "pattern-relation", tape.symbol, tape.interval, kind,
        boundary_ids, trace["contributingEpisodeIds"],
    )
    relevant_domains = [item.domain_id for item in domains if item.active and item.start_index <= start and item.end_index >= end]
    relevant_flows = _representative_flow_relations(flows, boundaries, start, end)
    flow_because = [
        "OLS 중심 흐름과 관계 경계가 합의함"
        for item in relevant_flows if item["state"] == "consensus"
    ]
    flow_against = [
        "OLS 중심 흐름과 관계 경계가 충돌함"
        for item in relevant_flows if item["state"] == "conflict"
    ]
    result = {
        "relationId": relation_id,
        "kind": kind,
        "displayName": PATTERN_NAMES[kind],
        "boundaryCandidateIds": list(boundary_ids),
        "upperCandidateId": next((item.candidate_id for item in boundaries if item.role in {"upper", "resistance"}), None),
        "lowerCandidateId": next((item.candidate_id for item in boundaries if item.role in {"lower", "support"}), None),
        "domain": {
            "fromTimestamp": tape.candles[start].timestamp,
            "toTimestamp": tape.candles[end].timestamp,
            "fromIndex": start,
            "toIndex": end,
            "domainIds": sorted(relevant_domains),
        },
        "flowRelations": relevant_flows,
        "relationBars": end - start + 1,
        "contractionRatio": contraction,
        "closeContainment": close_containment,
        "bodyContainment": body_containment,
        "relationQuality": quality,
        "trace": trace,
        "explanation": {
            "claim": f"{PATTERN_NAMES[kind]} 구조 관계",
            "because": ["동일 Field의 경계와 접촉 순서가 관계를 이룸", *flow_because],
            "against": flow_against,
            "dataQualifier": "exact-240 현재 관점의 구조 관계이며 매매 신호가 아님",
        },
    }
    if impulse is not None:
        result["impulse"] = impulse
    if legacy_kind is not None:
        result["legacyKind"] = legacy_kind
    if kind in {"triangle", "pennant", "wedge"}:
        lower, upper = sorted(boundaries, key=lambda item: item.role in {"upper", "resistance"})
        denominator = lower.slope_per_bar - upper.slope_per_bar
        result["apexBarsFromAsOf"] = None if denominator <= 0 else max(0.0, (
            _price(upper, end) - _price(lower, end)
        ) / denominator)
    return result


def _representative_flow_relations(flows, boundaries, start, end):
    relevant = [item for item in flows if item.start_index <= end and item.end_index >= start]
    if not relevant:
        return []
    global_flow = max(relevant, key=lambda item: (
        item.end_index - item.start_index, -item.start_index, item.flow_id,
    ))
    local_flow = min(relevant, key=lambda item: (
        item.end_index - item.start_index, -item.start_index, item.flow_id,
    ))
    chosen = [global_flow]
    if local_flow.flow_id != global_flow.flow_id:
        chosen.append(local_flow)
    boundary_slope = math.fsum(item.slope_per_bar for item in boundaries) / len(boundaries)
    span = max(1, end - start)
    boundary_zone = max(item.zone_half_width for item in boundaries)
    return [{
        "flowId": item.flow_id,
        "state": "consensus" if abs(boundary_slope - item.slope_per_bar) * span <= max(
            boundary_zone, item.corridor_half_width,
        ) else "conflict",
        "slopeDeltaPerBar": boundary_slope - item.slope_per_bar,
    } for item in chosen]


def _pair_metrics(tape, features, lower, upper, start, end):
    atr_values = [features.effective_atr[index] for index in range(start, end + 1)]
    relation_atr = median(atr_values)
    widths: list[float] = []
    close_inside = body_inside = 0
    for index in range(start, end + 1):
        low_y, high_y = _price(lower, index), _price(upper, index)
        width = high_y - low_y
        if width <= 0:
            return None
        widths.append(width)
        candle = tape.candles[index]
        low_zone = low_y - lower.zone_half_width
        high_zone = high_y + upper.zone_half_width
        close_inside += low_zone <= candle.close <= high_zone
        body_low, body_high = min(candle.open, candle.close), max(candle.open, candle.close)
        body_inside += low_zone <= body_low and body_high <= high_zone
    bars = end - start + 1
    return relation_atr, widths, close_inside / bars, body_inside / bars


def _trace(tape, boundaries, start, end):
    facts: list[dict] = []
    for boundary in boundaries:
        for episode in boundary.fit_episodes:
            if not start <= episode.contribution_index <= end:
                continue
            facts.append({
                "candidateId": boundary.candidate_id,
                "episodeId": episode.episode_id,
                "role": boundary.role,
                "kind": "contact",
                "index": episode.contribution_index,
                "timestamp": tape.candles[episode.contribution_index].timestamp,
                "price": episode.contribution_price,
                "mass": episode.contribution_mass,
            })
    facts.sort(key=lambda item: (item["index"], item["role"], item["episodeId"]))
    # A polyline anchor is a time/price fact. Two boundary contacts can share a
    # candle, but they cannot become two ordered anchors at the same timestamp.
    # Keep one deterministic representative per candle before role alternation.
    by_index: dict[int, dict] = {}
    for fact in facts:
        current = by_index.get(fact["index"])
        if current is None or (fact["mass"], fact["role"], fact["episodeId"]) > (
            current["mass"], current["role"], current["episodeId"]
        ):
            by_index[fact["index"]] = fact
    ordered_facts = [by_index[index] for index in sorted(by_index)]
    compressed: list[dict] = []
    for fact in ordered_facts:
        if compressed and compressed[-1]["role"] == fact["role"]:
            if (fact["mass"], fact["index"], fact["episodeId"]) > (
                compressed[-1]["mass"], compressed[-1]["index"], compressed[-1]["episodeId"]
            ):
                compressed[-1] = fact
        else:
            compressed.append(fact)
    if len(compressed) > 16:
        keep = {0, len(compressed) - 1}
        for ordinal in range(1, 15):
            keep.add(round(ordinal * (len(compressed) - 1) / 15))
        compressed = [item for index, item in enumerate(compressed) if index in keep]
    return {
        "contributingEpisodeIds": [item["episodeId"] for item in facts],
        "anchors": [{
            "episodeId": item["episodeId"],
            "role": item["role"],
            "index": item["index"],
            "price": item["price"],
        } for item in compressed],
    }


def _price(candidate, index):
    return candidate.intercept_at_origin + candidate.slope_per_bar * (index - candidate.index_origin)
