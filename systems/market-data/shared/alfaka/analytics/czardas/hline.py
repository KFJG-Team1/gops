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
            first_seen_index = max(item.confirmed_index for item in origin_seed)
            origin_ids = tuple(item.basis_id for item in origin_seed)
            mode_id = stable_hash(
                "hmode", tape.symbol, tape.interval, role,
                tape.candles[first_seen_index].timestamp, low, high, origin_ids,
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
                    tape, mode_id, role, first_seen_index, origin_ids, center, zone, low, high,
                    contributors, episodes, "weak", provisional_atr,
                ))
                continue
            final_center, final_zone, final_episodes, dispersion = refined
            revision_index = max(item.confirmed_index for item in final_episodes)
            formation_start = min(item.observed_from_index for item in final_episodes)
            formation_end = max(item.observed_to_index for item in final_episodes)
            probe = LineProbe(role, 0.0, final_center, 0, final_zone)
            integrity, body_integrity, close_integrity, _, _ = integrity_for_domain(
                tape, features, probe, formation_start, revision_index, config
            )
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
                and final_zone <= config.max_zone_atr * _candidate_median_atr(tape, features, formation_start, revision_index)
                and seed_quality >= 0.45
            )
            opposed = body_integrity < 0.70 or has_open_break(tape, features, probe, revision_index, config)
            state = "coherent" if geometry_ok and not opposed else "opposed" if geometry_ok else "weak"
            opposition = clamp(0.5 * (1 - body_integrity) + 0.5 * (1 - close_integrity))
            modes.append(_field_mode(
                tape, mode_id, role, first_seen_index, origin_ids, final_center, final_zone, low, high,
                contributors, final_episodes, state, provisional_atr, opposition, dispersion,
            ))
            if state != "coherent":
                continue
            initial = tuple(item.episode_id for item in sorted(final_episodes, key=lambda item: (item.confirmed_index, item.episode_id))[:2])
            initial_episodes = [item for item in final_episodes if item.episode_id in initial]
            lineage_formed = max(item.confirmed_index for item in initial_episodes)
            candidate_id = stable_hash(tape.symbol, tape.interval, "hline", role, "initial", initial)
            interactions = evaluate_interactions(tape, features, probe, candidate_id, 1, revision_index, span, config)
            if any(item.outcome == "confirmed_break" for item in interactions):
                continue
            confluence = profile_confluence(profile, final_center, final_zone)
            persistence = clamp(span / 96.0, 0.25, 1.0)
            rank_score, _, _ = boundary_rank(
                seed_quality, integrity, persistence, interactions, profile_confluence=confluence
            )
            lifecycle = "verified" if any(item.outcome == "verified_response" for item in interactions) else "formed"
            candidates.append(BoundaryCandidate(
                candidate_id, 1, "hline", role, lifecycle, mode_id, 1,
                0.0, formation_start, final_center, final_center, final_zone,
                formation_start, formation_end, initial, tuple(item.episode_id for item in final_episodes),
                lineage_formed, revision_index, seed_quality, integrity, body_integrity, close_integrity,
                persistence, interactions, confluence, rank_score,
                (), tuple(final_episodes),
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
        while end + 1 < len(segments) and abs(segments[end + 1][2] - mass) <= 1e-12 and segments[end + 1][0] == segments[end][1]:
            end += 1
            high = segments[end][1]
            contributors.update(segments[end][3])
        left = segments[index - 1][2] if index else -math.inf
        right = segments[end + 1][2] if end + 1 < len(segments) else -math.inf
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
    revision = max(item.confirmed_index for item in selected)
    atr = _candidate_median_atr(tape, features, start, revision)
    residual_floor = weighted_quantile([(abs(value - center), weight, stable_id) for value, weight, stable_id in values], 0.80)
    zone = max(
        2 * max(0.01, tape.candles[revision].close * 1e-6),
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
    tape, mode_id, role, first_seen_index, origin_ids, center, zone, low, high, contributors, episodes, state, atr,
    opposition=0.0, dispersion=0.0,
):
    return FieldMode(
        mode_id, 1, "hline", role, state, "refined" if episodes else "provisional",
        tape.candles[first_seen_index].timestamp,
        center, center, zone, low, high,
        math.fsum(item.contribution_mass for item in episodes) if episodes else math.fsum(item.role_mass for item in contributors),
        opposition, dispersion, dispersion,
        tuple(sorted(item.basis_id for item in contributors)), tuple(item.episode_id for item in episodes),
        (), tuple(origin_ids),
    )


def _dedupe_candidates(candidates, tape, features):
    winners = []
    for candidate in sorted(candidates, key=lambda item: (-item.rank_score, item.lineage_formed_index, item.candidate_id)):
        atr = features.atr_scale(candidate.revision_formed_index, tape.candles[candidate.revision_formed_index].close)
        if any(existing.role == candidate.role and abs(existing.price_at_as_of - candidate.price_at_as_of) <= 0.35 * atr for existing in winners):
            continue
        winners.append(candidate)
    return winners
