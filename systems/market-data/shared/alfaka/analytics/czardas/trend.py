from __future__ import annotations

import itertools
import math

from .config import CzardasConfig
from .features import FeatureTape
from .interactions import (
    LineProbe,
    evaluate_interactions,
    formation_episodes,
    has_open_break,
    integrity_for_domain,
)
from .numeric import clamp, huber, median, stable_hash, weighted_mad, weighted_median, weighted_quantile
from .rank import boundary_rank
from .tape import CandleTape
from .types import BoundaryCandidate, DetectorResult, FieldMode, RoleBasis


def detect_trends(
    tape: CandleTape,
    features: FeatureTape,
    all_basis: tuple[RoleBasis, ...],
    config: CzardasConfig,
) -> DetectorResult:
    modes: list[FieldMode] = []
    candidates: list[BoundaryCandidate] = []
    retained: list[RoleBasis] = []
    for role in ("lower", "upper"):
        anchors = [
            item for item in all_basis
            if item.role == role and (item.effective_scale >= 5 or item.geometry_score >= 0.75)
        ]
        anchors = sorted(anchors, key=lambda item: (-item.bar_index, -item.confirmed_index, item.cluster_id))[
            :config.trend_anchor_cap_per_side
        ]
        anchors.sort(key=lambda item: (item.bar_index, item.basis_id))
        retained.extend(anchors)
        if len(anchors) < 2:
            continue
        dual_scale = _median_atr(tape, features, min(item.bar_index for item in anchors), len(tape.candles) - 1)
        hypotheses = []
        for first, second in itertools.combinations(anchors, 2):
            separation = second.bar_index - first.bar_index
            if separation < config.trend_min_pair_separation:
                continue
            slope = (second.endpoint_price - first.endpoint_price) / separation
            y0 = first.endpoint_price - slope * first.bar_index
            y239 = y0 + slope * (len(tape.candles) - 1)
            hypotheses.append({
                "hypothesisId": stable_hash("thyp", tape.symbol, tape.interval, role, first.basis_id, second.basis_id),
                "sourceBasisIds": (first.basis_id, second.basis_id),
                "confirmedIndex": max(first.confirmed_index, second.confirmed_index),
                "yAtWindowStart": y0,
                "yAtWindowEnd": y239,
                "pairSeparationBars": separation,
                "seedMass": math.sqrt(first.role_mass * second.role_mass) * clamp(
                    separation / config.trend_pair_full_weight_bars, 0.25, 1.0
                ),
            })
        groups = _group_hypotheses(hypotheses, dual_scale, config)
        by_id = {item.basis_id: item for item in anchors}
        for group in groups:
            medoid = _weighted_medoid(group, dual_scale)
            mode_id = stable_hash(
                "tmode", tape.symbol, tape.interval, role,
                tape.candles[medoid["confirmedIndex"]].timestamp, medoid["hypothesisId"],
            )
            medoid_slope = (medoid["yAtWindowEnd"] - medoid["yAtWindowStart"]) / (len(tape.candles) - 1)
            medoid_probe = LineProbe(role, medoid_slope, medoid["yAtWindowStart"], 0, max(0.01, 0.25 * dual_scale))
            compatible = [
                item for item in anchors
                if _basis_corridor_distance(item, medoid_probe.price(item.bar_index))
                <= config.trend_hypothesis_mode_tolerance_atr * features.atr_scale(item.bar_index, tape.candles[item.bar_index].close)
            ]
            episodes = formation_episodes(tape, features, compatible, medoid_probe, mode_id, config)
            separated = any(
                abs(first.observed_from_index - second.observed_from_index) >= config.trend_min_pair_separation
                for first, second in itertools.combinations(episodes, 2)
            )
            if len(episodes) < 2 or not separated:
                modes.append(_trend_mode(tape, mode_id, role, medoid, group, compatible, episodes, "weak", dual_scale))
                continue
            slope_values = []
            for first, second in itertools.combinations(episodes, 2):
                separation = second.observed_from_index - first.observed_from_index
                if separation < config.trend_min_pair_separation:
                    continue
                slope = (second.contribution_price - first.contribution_price) / separation
                weight = math.sqrt(first.contribution_mass * second.contribution_mass) * clamp(
                    separation / config.trend_pair_full_weight_bars, 0.25, 1.0
                )
                slope_values.append((slope, weight, f"{first.episode_id}|{second.episode_id}"))
            if not slope_values:
                modes.append(_trend_mode(tape, mode_id, role, medoid, group, compatible, episodes, "weak", dual_scale))
                continue
            slope = weighted_median(slope_values)
            residuals = [
                (item.contribution_price - slope * item.observed_from_index, item.contribution_mass, item.episode_id)
                for item in episodes
            ]
            seed = weighted_quantile(residuals, 0.20 if role == "lower" else 0.80)
            start = min(item.observed_from_index for item in episodes)
            revision = max(item.confirmed_index for item in episodes)
            candidate_atr = _median_atr(tape, features, start, revision)
            zone = max(2 * max(0.01, tape.candles[revision].close * 1e-6), config.touch_tolerance_atr * candidate_atr)
            lower_bound, upper_bound = seed - config.max_zone_atr * candidate_atr, seed + config.max_zone_atr * candidate_atr
            intercepts = {lower_bound, upper_bound}
            for residual, _weight, _id in residuals:
                intercepts.update((residual, residual - zone, residual + zone))
            intercepts = sorted(clamp(value, lower_bound, upper_bound) for value in intercepts)
            scored = []
            for intercept in sorted(set(intercepts)):
                probe = LineProbe(role, slope, intercept, 0, zone)
                integrity, body_integrity, close_integrity, _, _ = integrity_for_domain(
                    tape, features, probe, start, revision, config
                )
                anchor_loss = math.fsum(
                    item.contribution_mass * huber(
                        abs(item.contribution_price - probe.price(item.observed_from_index))
                        / features.atr_scale(item.observed_from_index, tape.candles[item.observed_from_index].close)
                    )
                    for item in episodes
                ) / math.fsum(item.contribution_mass for item in episodes)
                scored.append((anchor_loss + (1.0 - integrity), abs(intercept - seed), intercept, integrity, body_integrity, close_integrity))
            _loss, _seed_distance, intercept, integrity, body_integrity, close_integrity = min(scored)
            probe = LineProbe(role, slope, intercept, 0, zone)
            corridors_ok = all(
                _basis_corridor_distance(by_id[item.contribution_basis_id], probe.price(item.observed_from_index))
                <= config.trend_hypothesis_mode_tolerance_atr
                * features.atr_scale(item.observed_from_index, tape.candles[item.observed_from_index].close)
                for item in episodes
            )
            residual_atr = [
                (
                    abs(item.contribution_price - probe.price(item.observed_from_index))
                    / features.atr_scale(item.observed_from_index, tape.candles[item.observed_from_index].close),
                    item.contribution_mass,
                    item.episode_id,
                )
                for item in episodes
            ]
            fit_score = math.exp(-weighted_median(residual_atr))
            span = max(item.observed_to_index for item in episodes) - min(item.observed_from_index for item in episodes)
            touch_score = clamp(len(episodes) / 4.0)
            seed_quality = clamp(
                0.45 * (math.fsum(by_id[item.contribution_basis_id].role_mass for item in episodes) / len(episodes))
                + 0.35 * fit_score + 0.20 * touch_score
            )
            geometry_ok = (
                corridors_ok
                and span >= 20
                and seed_quality >= 0.50
                and abs(slope) / max(candidate_atr, 1e-12) <= 0.15
            )
            opposed = (
                body_integrity < 0.75
                or close_integrity < 0.85
                or has_open_break(tape, features, probe, revision, config)
            )
            state = "coherent" if geometry_ok and not opposed else "opposed" if geometry_ok else "weak"
            opposition = clamp(0.5 * (1.0 - body_integrity) + 0.5 * (1.0 - close_integrity))
            modes.append(_trend_mode(
                tape, mode_id, role, medoid, group, compatible, episodes, state, dual_scale,
                probe=probe, opposition=opposition,
            ))
            if state != "coherent":
                continue
            initial = tuple(item.episode_id for item in sorted(episodes, key=lambda item: (item.confirmed_index, item.episode_id))[:2])
            initial_episodes = [item for item in episodes if item.episode_id in initial]
            lineage_formed = max(item.confirmed_index for item in initial_episodes)
            candidate_id = stable_hash(tape.symbol, tape.interval, "trend", role, "initial", initial)
            interactions = evaluate_interactions(tape, features, probe, candidate_id, 1, revision, span, config)
            if any(item.outcome == "confirmed_break" for item in interactions):
                continue
            persistence = clamp(span / 96.0, 0.25, 1.0)
            rank_score, _, _ = boundary_rank(seed_quality, integrity, persistence, interactions)
            lifecycle = "verified" if any(item.outcome == "verified_response" for item in interactions) else "formed"
            candidates.append(BoundaryCandidate(
                candidate_id, 1, "trend", role, lifecycle, mode_id, 1,
                slope, start, probe.price(start), probe.price(len(tape.candles) - 1), zone,
                start, max(item.observed_to_index for item in episodes), initial, tuple(item.episode_id for item in episodes),
                lineage_formed, revision, seed_quality, integrity, body_integrity, close_integrity,
                persistence, interactions, None, rank_score,
                (), tuple(episodes),
            ))
    return DetectorResult(tuple(_dedupe(candidates, tape, features)), tuple(modes), tuple(retained))


def _group_hypotheses(hypotheses, dual_scale, config):
    remaining = sorted(hypotheses, key=lambda item: (-item["seedMass"], item["confirmedIndex"], item["hypothesisId"]))
    groups = []
    while remaining:
        seed = remaining.pop(0)
        members = [seed]
        keep = []
        for item in remaining:
            distance = max(
                abs(item["yAtWindowStart"] - seed["yAtWindowStart"]) / max(dual_scale, 1e-12),
                abs(item["yAtWindowEnd"] - seed["yAtWindowEnd"]) / max(dual_scale, 1e-12),
            )
            (members if distance <= config.trend_hypothesis_mode_tolerance_atr else keep).append(item)
        groups.append(members)
        remaining = keep
    return groups


def _weighted_medoid(group, scale):
    def score(candidate):
        return math.fsum(
            item["seedMass"] * max(
                abs(candidate["yAtWindowStart"] - item["yAtWindowStart"]) / max(scale, 1e-12),
                abs(candidate["yAtWindowEnd"] - item["yAtWindowEnd"]) / max(scale, 1e-12),
            )
            for item in group
        )
    return min(group, key=lambda item: (score(item), item["hypothesisId"]))


def _basis_corridor_distance(item, line_price):
    if item.corridor_low <= line_price <= item.corridor_high:
        return 0.0
    return min(abs(line_price - item.corridor_low), abs(line_price - item.corridor_high))


def _trend_mode(
    tape, mode_id, role, medoid, group, compatible, episodes, state, dual_scale,
    *, probe=None, opposition=0.0,
):
    y0 = probe.price(0) if probe else medoid["yAtWindowStart"]
    y_end = probe.price(len(tape.candles) - 1) if probe else medoid["yAtWindowEnd"]
    start_values = [(item["yAtWindowStart"], item["seedMass"], item["hypothesisId"]) for item in group]
    end_values = [(item["yAtWindowEnd"], item["seedMass"], item["hypothesisId"]) for item in group]
    start_disp = weighted_mad(start_values) / max(dual_scale, 1e-12)
    end_disp = weighted_mad(end_values) / max(dual_scale, 1e-12)
    representative = sorted(group, key=lambda item: (-item["seedMass"], item["hypothesisId"]))[:3]
    return FieldMode(
        mode_id, 1, "trend", role, state, "refined" if episodes else "provisional",
        tape.candles[medoid["confirmedIndex"]].timestamp,
        y0, y_end, probe.zone if probe else 0.25 * dual_scale, None, None,
        math.fsum(item.contribution_mass for item in episodes) if episodes else math.fsum(item.role_mass for item in compatible),
        opposition, start_disp, end_disp,
        tuple(item.basis_id for item in compatible), tuple(item.episode_id for item in episodes),
        tuple({
            "hypothesisId": item["hypothesisId"],
            "sourceBasisIds": list(item["sourceBasisIds"]),
            "yAtWindowStart": item["yAtWindowStart"],
            "yAtWindowEnd": item["yAtWindowEnd"],
            "seedMass": item["seedMass"],
        } for item in representative),
        tuple(medoid["sourceBasisIds"]),
    )


def _median_atr(tape, features, start, end):
    values = [features.atr[index] for index in range(max(0, start), min(end, len(tape.candles) - 1) + 1) if features.atr[index] is not None]
    return median(values) if values else features.atr_scale(end, tape.candles[end].close)


def _dedupe(candidates, tape, features):
    winners = []
    for candidate in sorted(candidates, key=lambda item: (-item.rank_score, item.candidate_id)):
        duplicate = False
        for existing in winners:
            if existing.role != candidate.role:
                continue
            start = max(existing.observed_from_index, candidate.observed_from_index)
            end = min(existing.observed_to_index, candidate.observed_to_index)
            if end < start:
                continue
            atr = _median_atr(tape, features, start, end)
            old_start = existing.intercept_at_origin + existing.slope_per_bar * (start - existing.index_origin)
            new_start = candidate.intercept_at_origin + candidate.slope_per_bar * (start - candidate.index_origin)
            old_end = existing.intercept_at_origin + existing.slope_per_bar * (end - existing.index_origin)
            new_end = candidate.intercept_at_origin + candidate.slope_per_bar * (end - candidate.index_origin)
            if max(abs(old_start - new_start), abs(old_end - new_end)) <= 0.25 * atr:
                duplicate = True
                break
        if not duplicate:
            winners.append(candidate)
    return winners
