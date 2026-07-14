from __future__ import annotations

import itertools
import math

from .config import CzardasConfig
from .features import FeatureTape
from .numeric import clamp
from .tape import CandleTape
from .types import BoundaryCandidate


def select_boundaries(
    tape: CandleTape,
    features: FeatureTape,
    hlines: tuple[BoundaryCandidate, ...],
    trends: tuple[BoundaryCandidate, ...],
    config: CzardasConfig,
) -> tuple[tuple[BoundaryCandidate, ...], tuple[BoundaryCandidate, ...], dict[str, int]]:
    eligible_hlines = [item for item in hlines if _relevant(tape, features, item, config)]
    eligible_trends = [item for item in trends if _relevant(tape, features, item, config)]
    hline_bank = _role_cap(eligible_hlines, {"support": 4, "resistance": 4})
    trend_bank = _role_cap(eligible_trends, {"lower": 3, "upper": 3})

    selected_hlines = _best_subset(
        tape,
        features,
        hline_bank,
        config.hline_display_count,
        require_both_roles=False,
        config=config,
        kind="hline",
    )
    selected_hlines = _extend_with_exceptionally_distinct(
        tape, features, selected_hlines, hline_bank, config.hline_max_count,
        compare_across_roles=True,
    )
    if not selected_hlines:
        baseline = sorted(
            (item for item in hlines if item.evidence_state == "baseline_memory"),
            key=lambda item: (-item.rank_score, item.candidate_id),
        )
        selected_hlines = tuple(baseline[:1])
    roles = {item.role for item in trend_bank}
    if len(roles) == 1:
        # An honest one-sided Trend remains useful, but the other side is not
        # fabricated and the display target is not filled with duplicates.
        selected_trends = _best_subset(
            tape, features, trend_bank, 1,
            require_both_roles=False, config=config, kind="trend",
        )
    else:
        selected_trends = _best_subset(
            tape,
            features,
            trend_bank,
            config.trend_display_count,
            require_both_roles=config.trend_display_count >= 2,
            config=config,
            kind="trend",
        )
    selected_trends = _extend_with_exceptionally_distinct(
        tape, features, selected_trends, trend_bank, config.trend_max_count,
    )
    reasons = {
        "selection.display_score_below_threshold": sum(
            item.rank_score < config.display_min_rank_score for item in (*hlines, *trends)
        ),
        "selection.output_relevance_failed": sum(
            not _relevant(tape, features, item, config)
            and item.rank_score >= config.display_min_rank_score
            for item in (*hlines, *trends)
        ),
    }
    return selected_hlines, selected_trends, {key: value for key, value in reasons.items() if value}


def _extend_with_exceptionally_distinct(
    tape, features, selected, bank, limit, *, compare_across_roles=False,
):
    """Two boundaries are the visual preference, not a hard production cap.

    Extra boundaries survive only when they are both strong and geometrically
    non-redundant, keeping the configured maximum honest without filling quota.
    """
    result = list(selected)
    selected_ids = {item.candidate_id for item in result}
    for candidate in sorted(bank, key=lambda item: (-item.rank_score, item.candidate_id)):
        if len(result) >= limit:
            break
        if (
            candidate.candidate_id in selected_ids
            or candidate.rank_score < 0.72
            or len(candidate.fit_episode_ids) < 3
        ):
            continue
        if any(
            (compare_across_roles or item.role == candidate.role)
            and _near_duplicate_similarity(tape, features, item, candidate) >= 0.35
            for item in result
        ):
            continue
        result.append(candidate)
        selected_ids.add(candidate.candidate_id)
    return tuple(sorted(result, key=lambda item: (item.kind, item.role, item.candidate_id)))


def _role_cap(candidates: list[BoundaryCandidate], caps: dict[str, int]) -> tuple[BoundaryCandidate, ...]:
    result: list[BoundaryCandidate] = []
    for role, cap in caps.items():
        values = [item for item in candidates if item.role == role]
        values.sort(key=lambda item: (-item.rank_score, item.candidate_id))
        result.extend(values[:cap])
    return tuple(sorted(result, key=lambda item: item.candidate_id))


def _best_subset(
    tape: CandleTape,
    features: FeatureTape,
    bank: tuple[BoundaryCandidate, ...],
    limit: int,
    *,
    require_both_roles: bool,
    config: CzardasConfig,
    kind: str,
) -> tuple[BoundaryCandidate, ...]:
    if not bank or limit <= 0:
        return ()
    choices: list[tuple[float, int, tuple[str, ...], tuple[BoundaryCandidate, ...]]] = []
    for size in range(1, min(limit, len(bank)) + 1):
        for subset in itertools.combinations(bank, size):
            if require_both_roles and {item.role for item in subset} != {"lower", "upper"}:
                continue
            utility = math.fsum(
                boundary_selection_utility(tape, features, item, config) for item in subset
            )
            pairs = tuple(itertools.combinations(subset, 2))
            if kind == "hline":
                roles = {item.role for item in subset}
                if roles == {"support", "resistance"}:
                    utility += config.hline_role_diversity_bonus
                current = tape.candles[-1].close
                if (
                    any(item.role == "support" and item.price_at_as_of < current for item in subset)
                    and any(item.role == "resistance" and item.price_at_as_of > current for item in subset)
                ):
                    utility += config.hline_bracketing_bonus
                penalty = config.hline_duplicate_penalty * math.fsum(
                    _near_duplicate_similarity(tape, features, first, second)
                    for first, second in pairs
                )
            else:
                penalty = 0.10 * math.fsum(
                    _near_duplicate_similarity(tape, features, first, second)
                    for first, second in pairs
                    if first.role == second.role
                )
            ids = tuple(sorted(item.candidate_id for item in subset))
            choices.append((utility - penalty, size, ids, subset))
    if not choices:
        return ()
    # Higher utility wins. Exact ties prefer fewer primitives, then canonical IDs.
    winner = min(choices, key=lambda item: (-round(item[0], 12), item[1], item[2]))[3]
    return tuple(sorted(winner, key=lambda item: (item.kind, item.role, item.candidate_id)))


def boundary_present_relevance(
    candidate: BoundaryCandidate,
    current_index: int,
    config: CzardasConfig,
) -> float:
    confirmed_indexes = [candidate.fit_evidence_confirmed_index]
    confirmed_indexes.extend(item.confirmed_index for item in candidate.fit_episodes)
    confirmed_indexes.extend(
        item.terminal_index if item.terminal_index is not None else item.contact_index
        for item in candidate.interactions
        if item.outcome == "supported_response"
    )
    age = max(0, current_index - max(confirmed_indexes))
    return 2.0 ** (-age / config.selection_recency_half_life_bars)


def boundary_selection_utility(
    tape: CandleTape,
    features: FeatureTape,
    candidate: BoundaryCandidate,
    config: CzardasConfig,
) -> float:
    current_index = len(tape.candles) - 1
    distance_atr = abs(candidate.price_at_as_of - tape.candles[-1].close) / features.atr_scale(
        current_index, tape.candles[-1].close
    )
    proximity = 1.0 - clamp(distance_atr / 3.0)
    recency = boundary_present_relevance(candidate, current_index, config)
    return (
        config.selection_rank_weight * candidate.rank_score
        + config.selection_recency_weight * recency
        + config.selection_proximity_weight * proximity
    )


def _near_duplicate_similarity(
    tape: CandleTape,
    features: FeatureTape,
    first: BoundaryCandidate,
    second: BoundaryCandidate,
) -> float:
    start = max(first.observed_from_index, second.observed_from_index)
    end = min(first.observed_to_index, second.observed_to_index)
    if start > end:
        return 0.0
    distances = []
    for index in {start, end}:
        first_price = first.intercept_at_origin + first.slope_per_bar * (index - first.index_origin)
        second_price = second.intercept_at_origin + second.slope_per_bar * (index - second.index_origin)
        atr = features.atr_scale(index, tape.candles[index].close)
        distances.append(abs(first_price - second_price) / atr)
    distance = math.fsum(distances) / len(distances)
    return max(0.0, 1.0 - distance / 0.75)


def _relevant(tape, features, candidate, config):
    if candidate.rank_score < config.display_min_rank_score:
        return False
    recent_facts = [candidate.observed_to_index, candidate.fit_evidence_confirmed_index]
    recent_facts.extend(item.contact_index for item in candidate.interactions)
    recent = max(recent_facts)
    distance = abs(candidate.price_at_as_of - tape.candles[-1].close) / features.atr_scale(
        len(tape.candles) - 1, tape.candles[-1].close
    )
    return len(tape.candles) - 1 - recent <= config.recent_evidence_bars or distance <= config.max_current_distance_atr
