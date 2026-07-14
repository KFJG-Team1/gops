from __future__ import annotations

import math
from dataclasses import replace

from .config import CzardasConfig
from .features import FeatureTape
from .interactions import (
    LineProbe,
    evaluate_interactions,
    formation_episodes,
    has_open_break,
    integrity_for_domain,
)
from .numeric import clamp, median, stable_hash, weighted_mad, weighted_median, weighted_quantile
from .profile import estimated_volume_profile, profile_confluence
from .rank import boundary_rank
from .tape import CandleTape
from .types import BoundaryCandidate, DetectorResult, FieldMode, FormationEpisode, RoleBasis


def detect_hlines(
    tape: CandleTape,
    features: FeatureTape,
    all_basis: tuple[RoleBasis, ...],
    config: CzardasConfig,
) -> DetectorResult:
    profile = estimated_volume_profile(tape, config)
    modes: list[FieldMode] = []
    candidates: list[BoundaryCandidate] = []
    response_segments: list[dict] = []
    retained_basis: list[RoleBasis] = []
    for role in ("support", "resistance"):
        role_basis = [item for item in all_basis if item.role == role]
        role_basis = sorted(role_basis, key=lambda item: (-item.role_mass, -item.bar_index, item.basis_id))[
            :config.hline_evidence_cap_per_role
        ]
        retained_basis.extend(role_basis)
        intervals = [_basis_interval(tape, features, item, config) for item in role_basis]
        segments = _piecewise_segments(intervals)
        for low, high, mass, active in segments:
            response_segments.append({
                "segmentId": stable_hash("hseg", tape.symbol, tape.interval, tape.as_of, role, low, high),
                "derivationDigest": stable_hash(tuple(sorted(active)), low, high, mass),
                "role": role,
                "lowPrice": low,
                "highPrice": high,
                "responseMass": mass,
                "activeBasisCount": len(active),
            })
        ridges = _local_ridges(segments)
        basis_by_id = {item.basis_id: item for item in role_basis}
        for ridge_index, ridge in enumerate(ridges):
            low, high, mass, active_ids = ridge
            contributors = [basis_by_id[item] for item in active_ids if item in basis_by_id]
            if len({item.cluster_id for item in contributors}) < 2:
                continue
            origin_seed = sorted(contributors, key=lambda item: (item.confirmed_index, item.basis_id))[:2]
            origin_ids = tuple(item.basis_id for item in origin_seed)
            mode_id = stable_hash(
                "hmode", tape.symbol, tape.interval, role, origin_ids,
            )
            atr_values = [
                features.atr_scale(index, tape.candles[index].close)
                for index in range(min(item.bar_index for item in contributors), len(tape.candles))
                if features.atr[index] is not None
            ]
            provisional_atr = median(atr_values) if atr_values else features.atr_scale(len(tape.candles) - 1, tape.candles[-1].close)
            center = weighted_median([
                (clamp(item.endpoint_price, low, high), item.role_mass, item.basis_id) for item in contributors
            ])
            zone = max(
                2 * max(0.01, tape.candles[-1].close * 1e-6),
                min(config.max_zone_atr * provisional_atr, max((high - low) / 2, config.touch_tolerance_atr * provisional_atr)),
            )
            provisional = LineProbe(role, 0.0, center, 0, zone)
            episodes = formation_episodes(tape, features, contributors, provisional, mode_id, config)
            refined = _refine_mode(tape, features, episodes, role, mode_id, config)
            if refined is None:
                modes.append(_field_mode(
                    tape, mode_id, role, origin_ids, center, zone, low, high,
                    contributors, episodes, "weak", provisional_atr,
                ))
                continue
            final_center, final_zone, final_episodes, dispersion = refined
            fit_confirmed_index = max(item.confirmed_index for item in final_episodes)
            formation_start = min(item.observed_from_index for item in final_episodes)
            formation_end = max(item.observed_to_index for item in final_episodes)
            probe = LineProbe(role, 0.0, final_center, 0, final_zone)
            rejection_mean = math.fsum(item.rejection for item in final_episodes) / len(final_episodes)
            contribution_basis = [basis_by_id[item.contribution_basis_id] for item in final_episodes]
            agreement = clamp(1.0 - weighted_mad([
                (clamp(item.contribution_price, final_center - final_zone, final_center + final_zone), item.contribution_mass, item.episode_id)
                for item in final_episodes
            ], final_center) / max(final_zone, 1e-12))
            seed_quality = clamp(
                0.45 * (math.fsum(item.geometry_score for item in contribution_basis) / len(contribution_basis))
                + 0.30 * rejection_mean
                + 0.25 * agreement
            )
            span = formation_end - formation_start
            geometry_ok = (
                len(final_episodes) >= 2
                and span >= 20
                and rejection_mean >= 0.35
                and final_zone <= config.max_zone_atr * _candidate_median_atr(tape, features, formation_start, fit_confirmed_index)
                and seed_quality >= 0.45
            )
            if not geometry_ok:
                modes.append(_field_mode(
                    tape, mode_id, role, origin_ids, final_center, final_zone, low, high,
                    contributors, final_episodes, "weak", provisional_atr,
                    dispersion=dispersion,
                ))
                continue
            integrity_eval = integrity_for_domain(
                tape, features, probe, 0, len(tape.candles) - 1, config
            )
            integrity = integrity_eval.integrity
            body_integrity = integrity_eval.body_integrity
            close_integrity = integrity_eval.close_integrity
            opposed = body_integrity < 0.70 or has_open_break(tape, features, probe, len(tape.candles) - 1, config)
            state = "opposed" if opposed else "coherent"
            opposition = clamp(0.5 * (1 - body_integrity) + 0.5 * (1 - close_integrity))
            mode = _field_mode(
                tape, mode_id, role, origin_ids, final_center, final_zone, low, high,
                contributors, final_episodes, state, provisional_atr, opposition, dispersion,
            )
            modes.append(mode)
            if state != "coherent":
                continue
            initial = tuple(item.episode_id for item in sorted(final_episodes, key=lambda item: (item.confirmed_index, item.episode_id))[:2])
            candidate_id = stable_hash(tape.symbol, tape.interval, "hline", role, "initial", initial)
            interactions = evaluate_interactions(tape, features, probe, candidate_id, fit_confirmed_index, span, config)
            confluence = profile_confluence(profile, final_center, final_zone)
            persistence = clamp(span / 96.0, 0.25, 1.0)
            rank_score, _, _ = boundary_rank(
                seed_quality, integrity, persistence, interactions, profile_confluence=confluence
            )
            evidence_state = "response_supported" if any(item.outcome == "supported_response" for item in interactions) else "formed"
            candidates.append(BoundaryCandidate(
                candidate_id=candidate_id, kind="hline", role=role, evidence_state=evidence_state,
                source_field_mode_id=mode_id, source_field_derivation_digest=mode.derivation_digest,
                slope_per_bar=0.0, index_origin=formation_start, intercept_at_origin=final_center,
                price_at_as_of=final_center, zone_half_width=final_zone,
                observed_from_index=formation_start, observed_to_index=formation_end,
                initial_episode_ids=initial, fit_episode_ids=tuple(item.episode_id for item in final_episodes),
                fit_evidence_confirmed_index=fit_confirmed_index, seed_quality=seed_quality, integrity=integrity,
                body_integrity=body_integrity, close_integrity=close_integrity, persistence=persistence,
                integrity_fact_count=integrity_eval.fact_count,
                integrity_effective_fact_count=integrity_eval.effective_fact_count,
                integrity_coverage=integrity_eval.coverage,
                body_penetration_count=integrity_eval.body_penetration_count,
                close_penetration_count=integrity_eval.close_penetration_count,
                interactions=interactions, profile_confluence=confluence, rank_score=rank_score,
                reject_reasons=(), fit_episodes=tuple(final_episodes),
            ))
    return DetectorResult(
        tuple(_dedupe_candidates(candidates, tape, features)),
        tuple(modes), tuple(retained_basis), tuple(response_segments), profile,
    )


def _basis_interval(tape: CandleTape, features: FeatureTape, item: RoleBasis, config: CzardasConfig):
    atr = features.atr_scale(item.bar_index, tape.candles[item.bar_index].close)
    tolerance = max(2 * max(0.01, tape.candles[item.bar_index].close * 1e-6), config.touch_tolerance_atr * atr)
    return item.corridor_low - tolerance, item.corridor_high + tolerance, item.role_mass, item.basis_id, item.cluster_id


def _piecewise_segments(intervals):
    endpoints = sorted({value for low, high, *_ in intervals for value in (low, high)})
    segments = []
    for low, high in zip(endpoints, endpoints[1:]):
        if high <= low:
            continue
        midpoint = 0.5 * (low + high)
        active = [(basis_id, mass, cluster) for start, end, mass, basis_id, cluster in intervals if start <= midpoint <= end]
        if not active:
            continue
        active.sort()
        segments.append((low, high, math.fsum(item[1] for item in active), tuple(item[0] for item in active)))
    return segments


def _local_ridges(segments):
    ridges = []
    index = 0
    while index < len(segments):
        low, high, mass, active = segments[index]
        end = index
        contributors = set(active)
        while (
            end + 1 < len(segments)
            and abs(segments[end + 1][2] - mass) <= 1e-12
            and segments[end + 1][0] == segments[end][1]
            and set(segments[end][3]).intersection(segments[end + 1][3])
        ):
            end += 1
            high = segments[end][1]
            contributors.update(segments[end][3])
        # Only geometrically touching elementary segments are neighbours.  A
        # price gap defines a separate response landscape and must not suppress
        # a ridge on the other side of empty price space.
        left = (
            segments[index - 1][2]
            if index and segments[index - 1][1] == low
            else -math.inf
        )
        right = (
            segments[end + 1][2]
            if end + 1 < len(segments) and segments[end + 1][0] == high
            else -math.inf
        )
        if mass >= left and mass >= right and len(contributors) >= 2:
            ridges.append((low, high, mass, tuple(sorted(contributors))))
        index = end + 1
    return sorted(ridges, key=lambda item: (-item[2], item[0], item[1], item[3]))


def _refine_mode(tape, features, episodes, role, mode_id, config):
    if len(episodes) < 2:
        return None
    interval_rows = [
        (item.corridor_low, item.corridor_high, item.contribution_mass, item.episode_id, item.episode_id)
        for item in episodes
    ]
    ridges = _local_ridges(_piecewise_segments(interval_rows))
    if not ridges:
        return None
    low, high, _mass, active = ridges[0]
    selected = [item for item in episodes if item.episode_id in active]
    if len(selected) < 2:
        return None
    values = [(clamp(item.contribution_price, low, high), item.contribution_mass, item.episode_id) for item in selected]
    center = weighted_median(values)
    start = min(item.observed_from_index for item in selected)
    fit_confirmed = max(item.confirmed_index for item in selected)
    atr = _candidate_median_atr(tape, features, start, fit_confirmed)
    residual_floor = weighted_quantile([(abs(value - center), weight, stable_id) for value, weight, stable_id in values], 0.80)
    zone = max(
        2 * max(0.01, tape.candles[fit_confirmed].close * 1e-6),
        min(config.max_zone_atr * atr, max(config.touch_tolerance_atr * atr, 1.4826 * weighted_mad(values, center), residual_floor)),
    )
    if not all(item.corridor_low <= center + zone and item.corridor_high >= center - zone for item in selected):
        return None
    dispersion = weighted_mad(values, center) / max(atr, 1e-12)
    return center, zone, selected, dispersion


def _candidate_median_atr(tape, features, start, end):
    values = [features.atr[index] for index in range(start, end + 1) if features.atr[index] is not None]
    return median(values) if values else features.atr_scale(end, tape.candles[end].close)


def _field_mode(
    tape, mode_id, role, origin_ids, center, zone, low, high, contributors, episodes, state, atr,
    opposition=0.0, dispersion=0.0,
):
    contributor_ids = tuple(sorted(item.basis_id for item in contributors))
    episode_ids = tuple(item.episode_id for item in episodes)
    support_mass = math.fsum(item.contribution_mass for item in episodes) if episodes else math.fsum(item.role_mass for item in contributors)
    derivation = stable_hash("hmode-derivation", mode_id, contributor_ids, episode_ids, center, zone, low, high, support_mass, opposition)
    return FieldMode(
        field_mode_id=mode_id, derivation_digest=derivation, kind="hline", role=role,
        mode_state=state, geometry_state="refined" if episodes else "provisional",
        center_start=center, center_end=center, zone_half_width=zone, ridge_low=low, ridge_high=high,
        support_mass=support_mass, opposition_mass=opposition,
        dispersion_start_atr=dispersion, dispersion_end_atr=dispersion,
        contributor_basis_ids=contributor_ids, episode_ids=episode_ids,
        representative_hypotheses=(), origin_seed_basis_ids=tuple(origin_ids),
    )


def _dedupe_candidates(candidates, tape, features):
    winners = []
    for candidate in sorted(candidates, key=lambda item: (-item.rank_score, item.fit_evidence_confirmed_index, item.candidate_id)):
        atr = features.atr_scale(candidate.fit_evidence_confirmed_index, tape.candles[candidate.fit_evidence_confirmed_index].close)
        if any(existing.role == candidate.role and abs(existing.price_at_as_of - candidate.price_at_as_of) <= 0.35 * atr for existing in winners):
            continue
        winners.append(candidate)
    return winners
