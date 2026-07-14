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
        anchors = _stratified_anchors(anchors, len(tape.candles), config.trend_anchor_cap_per_side)
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
                "tmode", tape.symbol, tape.interval, role, medoid["hypothesisId"],
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
                abs(first.contribution_index - second.contribution_index) >= config.trend_min_pair_separation
                for first, second in itertools.combinations(episodes, 2)
            )
            if len(episodes) < 2 or not separated:
                modes.append(_trend_mode(tape, mode_id, role, medoid, group, compatible, episodes, "weak", dual_scale))
                continue
            slope_values = []
            for first, second in itertools.combinations(episodes, 2):
                separation = second.contribution_index - first.contribution_index
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
                (item.contribution_price - slope * item.contribution_index, item.contribution_mass, item.episode_id)
                for item in episodes
            ]
            seed = weighted_quantile(residuals, 0.20 if role == "lower" else 0.80)
            start = min(item.observed_from_index for item in episodes)
            fit_confirmed_index = max(item.confirmed_index for item in episodes)
            candidate_atr = _median_atr(tape, features, start, fit_confirmed_index)
            zone = max(2 * max(0.01, tape.candles[fit_confirmed_index].close * 1e-6), config.touch_tolerance_atr * candidate_atr)
            lower_bound, upper_bound = seed - config.max_zone_atr * candidate_atr, seed + config.max_zone_atr * candidate_atr
            intercepts = {lower_bound, upper_bound}
            for residual, _weight, _id in residuals:
                intercepts.update((residual, residual - zone, residual + zone))
            intercepts = sorted(clamp(value, lower_bound, upper_bound) for value in intercepts)
            scored = []
            for intercept in sorted(set(intercepts)):
                probe = LineProbe(role, slope, intercept, 0, zone)
                anchor_loss = math.fsum(
                    item.contribution_mass * huber(
                        abs(item.contribution_price - probe.price(item.contribution_index))
                        / features.atr_scale(item.contribution_index, tape.candles[item.contribution_index].close)
                    )
                    for item in episodes
                ) / math.fsum(item.contribution_mass for item in episodes)
                scored.append((anchor_loss, abs(intercept - seed), intercept))
            _loss, _seed_distance, intercept = min(scored)
            probe = LineProbe(role, slope, intercept, 0, zone)
            corridors_ok = all(
                _basis_corridor_distance(by_id[item.contribution_basis_id], probe.price(item.contribution_index))
                <= config.trend_hypothesis_mode_tolerance_atr
                * features.atr_scale(item.contribution_index, tape.candles[item.contribution_index].close)
                for item in episodes
            )
            residual_atr = [
                (
                    abs(item.contribution_price - probe.price(item.contribution_index))
                    / features.atr_scale(item.contribution_index, tape.candles[item.contribution_index].close),
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
            if not geometry_ok:
                modes.append(_trend_mode(
                    tape, mode_id, role, medoid, group, compatible, episodes, "weak", dual_scale,
                    probe=probe,
                ))
                continue
            integrity_eval = integrity_for_domain(
                tape, features, probe, 0, len(tape.candles) - 1, config
            )
            integrity = integrity_eval.integrity
            body_integrity = integrity_eval.body_integrity
            close_integrity = integrity_eval.close_integrity
            opposed = (
                body_integrity < 0.75
                or close_integrity < 0.85
                or has_open_break(tape, features, probe, len(tape.candles) - 1, config)
            )
            state = "opposed" if opposed else "coherent"
            opposition = clamp(0.5 * (1.0 - body_integrity) + 0.5 * (1.0 - close_integrity))
            mode = _trend_mode(
                tape, mode_id, role, medoid, group, compatible, episodes, state, dual_scale,
                probe=probe, opposition=opposition,
            )
            modes.append(mode)
            if state != "coherent":
                continue
            initial = tuple(item.episode_id for item in sorted(episodes, key=lambda item: (item.confirmed_index, item.episode_id))[:2])
            candidate_id = stable_hash(tape.symbol, tape.interval, "trend", role, "initial", initial)
            interactions = evaluate_interactions(tape, features, probe, candidate_id, fit_confirmed_index, span, config)
            persistence = clamp(span / 96.0, 0.25, 1.0)
            rank_score, _, _ = boundary_rank(seed_quality, integrity, persistence, interactions)
            evidence_state = "response_supported" if any(item.outcome == "supported_response" for item in interactions) else "formed"
            candidates.append(BoundaryCandidate(
                candidate_id=candidate_id, kind="trend", role=role, evidence_state=evidence_state,
                source_field_mode_id=mode_id, source_field_derivation_digest=mode.derivation_digest,
                slope_per_bar=slope, index_origin=start, intercept_at_origin=probe.price(start),
                price_at_as_of=probe.price(len(tape.candles) - 1), zone_half_width=zone,
                observed_from_index=start, observed_to_index=max(item.observed_to_index for item in episodes),
                initial_episode_ids=initial, fit_episode_ids=tuple(item.episode_id for item in episodes),
                fit_evidence_confirmed_index=fit_confirmed_index, seed_quality=seed_quality, integrity=integrity,
                body_integrity=body_integrity, close_integrity=close_integrity, persistence=persistence,
                integrity_fact_count=integrity_eval.fact_count,
                integrity_effective_fact_count=integrity_eval.effective_fact_count,
                integrity_coverage=integrity_eval.coverage,
                body_penetration_count=integrity_eval.body_penetration_count,
                close_penetration_count=integrity_eval.close_penetration_count,
                interactions=interactions, profile_confluence=None, rank_score=rank_score,
                reject_reasons=(), fit_episodes=tuple(episodes),
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
    contributor_ids = tuple(sorted(item.basis_id for item in compatible))
    episode_ids = tuple(item.episode_id for item in episodes)
    support_mass = math.fsum(item.contribution_mass for item in episodes) if episodes else math.fsum(item.role_mass for item in compatible)
    hypotheses = tuple({
            "hypothesisId": item["hypothesisId"],
            "sourceBasisIds": list(item["sourceBasisIds"]),
            "yAtWindowStart": item["yAtWindowStart"],
            "yAtWindowEnd": item["yAtWindowEnd"],
            "seedMass": item["seedMass"],
        } for item in representative)
    derivation = stable_hash(
        "tmode-derivation", mode_id, contributor_ids, episode_ids, y0, y_end,
        probe.zone if probe else 0.25 * dual_scale, support_mass, opposition, hypotheses,
    )
    return FieldMode(
        field_mode_id=mode_id, derivation_digest=derivation, kind="trend", role=role,
        mode_state=state, geometry_state="refined" if episodes else "provisional",
        center_start=y0, center_end=y_end, zone_half_width=probe.zone if probe else 0.25 * dual_scale,
        ridge_low=None, ridge_high=None, support_mass=support_mass, opposition_mass=opposition,
        dispersion_start_atr=start_disp, dispersion_end_atr=end_disp,
        contributor_basis_ids=contributor_ids, episode_ids=episode_ids,
        representative_hypotheses=hypotheses, origin_seed_basis_ids=tuple(medoid["sourceBasisIds"]),
    )


def _stratified_anchors(anchors, candle_count, cap):
    """Keep structural coverage across the current snapshot, not just recent endpoints."""
    if cap <= 0:
        return []
    ordered = sorted(
        anchors,
        key=lambda item: (-item.geometry_score, -item.effective_scale, -item.bar_index, item.basis_id),
    )
    strata = 3
    per_stratum = min(4, max(1, cap // strata))
    chosen = []
    for stratum in range(strata):
        start = stratum * candle_count // strata
        end = (stratum + 1) * candle_count // strata
        values = [item for item in ordered if start <= item.bar_index < end]
        for item in values[:per_stratum]:
            chosen.append(item)
    return sorted(chosen[:cap], key=lambda item: (item.bar_index, item.basis_id))


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
