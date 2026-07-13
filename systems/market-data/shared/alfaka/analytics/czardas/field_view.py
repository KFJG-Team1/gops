from __future__ import annotations

from copy import deepcopy

from .config import CzardasConfig
from .numeric import canonical_digest, canonical_json, median
from .tape import CandleTape
from .types import BoundaryCandidate, DetectorResult, FieldMode, RoleBasis


ROLE_ORDER = {"support": 0, "resistance": 1, "lower": 2, "upper": 3}
STATE_ORDER = {"coherent": 0, "weak": 1, "opposed": 2}


def build_field_view(
    tape: CandleTape,
    hline: DetectorResult,
    trend: DetectorResult,
    selected: tuple[BoundaryCandidate, ...],
    relation: dict | None,
    config: CzardasConfig,
) -> dict:
    selected_modes = {(item.source_field_mode_id, item.source_field_revision) for item in selected}
    all_basis = _dedupe_basis((*hline.basis, *trend.basis))
    basis_by_id = {item.basis_id: item for item in all_basis}
    required_basis = {
        basis_id
        for mode in (*hline.modes, *trend.modes)
        if (mode.field_mode_id, mode.field_revision) in selected_modes
        for basis_id in mode.origin_seed_basis_ids
    }
    required_basis.update(
        episode.contribution_basis_id
        for candidate in selected
        for episode in candidate.fit_episodes
        if episode.episode_id in candidate.initial_episode_ids
    )
    basis_sorted = sorted(all_basis, key=lambda item: (ROLE_ORDER[item.role], -item.role_mass, -item.bar_index, item.basis_id))
    basis_sorted = _required_first(basis_sorted, required_basis, key=lambda item: item.basis_id)[:64]
    h_modes = _mode_dtos(tape, hline.modes, selected_modes, all_basis, required_basis)
    t_modes = _mode_dtos(tape, trend.modes, selected_modes, all_basis, required_basis)
    selected_refs = [{
        "candidateId": item.candidate_id,
        "modelRevision": item.model_revision,
        "kind": item.kind,
        "sourceFieldModeId": item.source_field_mode_id,
        "sourceFieldRevision": item.source_field_revision,
    } for item in selected]
    validation = []
    for candidate in selected:
        episodes = {item.episode_id: item for item in candidate.fit_episodes}
        for episode_id in candidate.initial_episode_ids:
            episode = episodes[episode_id]
            validation.append({
                "validationId": canonical_digest([candidate.candidate_id, episode_id, "formation"]),
                "candidateId": candidate.candidate_id,
                "sourceFieldModeId": candidate.source_field_mode_id,
                "sourceFieldRevision": candidate.source_field_revision,
                "kind": "formation",
                "observedAt": tape.candles[episode.observed_from_index].timestamp,
                "confirmedAt": tape.candles[episode.confirmed_index].timestamp,
                "episodeId": episode_id,
                "clusterId": basis_by_id[episode.contribution_basis_id].cluster_id,
                "endpointPrice": episode.contribution_price,
                "bodyEdgePrice": None,
                "corridorLow": episode.corridor_low,
                "corridorHigh": episode.corridor_high,
                "interactionId": None,
                "initialFormation": True,
                "residualAtr": None,
                "explorationPressure": None,
                "acceptanceMass": None,
                "responseScore": None,
                "outcome": None,
            })
    field = {
        "schemaVersion": 1,
        "sourceBars": 240,
        "basisGlyphs": [_basis_dto(item) for item in basis_sorted],
        "hlineResponseSegments": [
            item for item in sorted(hline.response_segments, key=lambda row: (ROLE_ORDER[row["role"]], row["lowPrice"], row["segmentId"]))
            if item["activeBasisCount"] >= 2
        ][:96],
        "hlineProfileBins": list(hline.profile_bins),
        "hlineModes": h_modes,
        "trendModes": t_modes,
        "selectedModeRefs": selected_refs,
        "validationGlyphs": validation,
        "relationGlyph": None if relation is None else {
            "triangleId": relation["triangleId"],
            "upperCandidateId": relation["upperCandidateId"],
            "lowerCandidateId": relation["lowerCandidateId"],
            "relationFrom": relation["relationFrom"],
            "contractionRatio": relation["contractionRatio"],
        },
        "projection": {
            "truncated": False,
            "omittedBasisCount": max(0, len(all_basis) - len(basis_sorted)),
            "omittedHlineResponseSegmentCount": max(0, len(hline.response_segments) - min(96, len(hline.response_segments))),
            "profileBinsOmitted": False,
            "omittedHlineModeCount": max(0, len(hline.modes) - len(h_modes)),
            "omittedTrendModeCount": max(0, len(trend.modes) - len(t_modes)),
            "omittedHypothesisCount": sum(max(0, len(item.representative_hypotheses) - 3) for item in trend.modes),
            "omittedValidationCount": 0,
        },
    }
    _fit_budget(field, required_basis, selected_modes, config.max_field_bytes)
    return field


def _fit_budget(field, required_basis, selected_modes, budget):
    projection = field["projection"]
    size = lambda: len(canonical_json(field).encode("utf-8"))
    if size() <= budget:
        projection["truncated"] = any(
            value for key, value in projection.items() if key != "truncated" and isinstance(value, int)
        )
        return
    if field["hlineProfileBins"]:
        field["hlineProfileBins"] = []
        projection["profileBinsOmitted"] = True
        projection["truncated"] = True
    # Representative facts are lower priority than the Basis and modes they explain.
    omitted_hypotheses = 0
    for item in field["trendModes"]:
        hypotheses = item.get("representativeHypotheses") or []
        if len(hypotheses) > 1:
            omitted_hypotheses += len(hypotheses) - 1
            item["representativeHypotheses"] = hypotheses[:1]
    projection["omittedHypothesisCount"] += omitted_hypotheses
    _trim_optional_to_budget(
        field, "basisGlyphs", lambda item: item["basisId"] in required_basis, budget,
        projection, "omittedBasisCount",
    )
    _trim_optional_to_budget(
        field, "hlineResponseSegments", lambda _item: False, budget,
        projection, "omittedHlineResponseSegmentCount",
    )
    for key, omitted_key in (("trendModes", "omittedTrendModeCount"), ("hlineModes", "omittedHlineModeCount")):
        _trim_optional_to_budget(
            field, key,
            lambda item: (item["fieldModeId"], item["fieldRevision"]) in selected_modes,
            budget, projection, omitted_key,
        )
    projection["truncated"] = True
    if size() > budget:
        raise ValueError("payload_limit_exceeded")


def _trim_optional_to_budget(field, key, mandatory, budget, projection, omitted_key):
    values = field[key]
    current_size = len(canonical_json(field).encode("utf-8"))
    if current_size <= budget or not values:
        return
    optional = [item for item in values if not mandatory(item)]
    if not optional:
        return
    # Remove the lowest-priority tail in one deterministic pass.  Per-item
    # encoded sizes avoid serializing the whole Field at every binary-search
    # probe, which would dominate the 50 ms kernel budget.
    required_saving = current_size - budget + 128
    removed: set[int] = set()
    saved = 0
    for item in reversed(optional):
        removed.add(id(item))
        saved += len(canonical_json(item).encode("utf-8")) + 1
        if saved >= required_saving:
            break
    field[key] = [item for item in values if id(item) not in removed]
    projection[omitted_key] += len(removed)


def _mode_dtos(tape, modes, selected_modes, all_basis, required_basis):
    basis_by_id = {item.basis_id: item for item in all_basis}
    atr_values = [item.high - item.low for item in tape.candles]
    price_scale = median(atr_values) if any(atr_values) else max(0.01, tape.candles[-1].close * 1e-6)
    ordered = sorted(modes, key=lambda item: (ROLE_ORDER[item.role], STATE_ORDER[item.mode_state], -item.support_mass, item.dispersion_start_atr + item.dispersion_end_atr, item.field_mode_id))
    chosen = []
    roles = sorted({item.role for item in ordered}, key=lambda role: ROLE_ORDER[role])
    for role in roles:
        role_modes = [item for item in ordered if item.role == role]
        cap = 4 if role in {"support", "resistance"} else 3
        selected_role_modes = [item for item in role_modes if (item.field_mode_id, item.field_revision) in selected_modes]
        values = role_modes[:cap]
        for selected_mode in selected_role_modes:
            if selected_mode not in values:
                values[-1:] = [selected_mode]
        chosen.extend(values)
    chosen_by_id = {(item.field_mode_id, item.field_revision): item for item in chosen}
    ordered = sorted(chosen_by_id.values(), key=lambda item: (ROLE_ORDER[item.role], STATE_ORDER[item.mode_state], -item.support_mass, item.dispersion_start_atr + item.dispersion_end_atr, item.field_mode_id))
    result = []
    for mode in ordered:
        selected = (mode.field_mode_id, mode.field_revision) in selected_modes
        contribution_ids = sorted(
            mode.contributor_basis_ids,
            key=lambda basis_id: (basis_id not in required_basis, basis_id),
        )
        common = {
            "fieldModeId": mode.field_mode_id,
            "fieldRevision": mode.field_revision,
            "viewRole": "landscape_and_selected" if selected else "landscape",
            "derivationDigest": canonical_digest([
                mode.field_mode_id, mode.contributor_basis_ids, mode.episode_ids, mode.center_start, mode.center_end
            ]),
            "role": mode.role,
            "modeState": mode.mode_state,
            "geometryState": mode.geometry_state,
            "firstSeenAt": mode.first_seen_at,
            "originSeedBasisIds": list(mode.origin_seed_basis_ids),
            "supportMass": mode.support_mass,
            "oppositionMass": mode.opposition_mass,
            "contributorCount": len(mode.contributor_basis_ids),
            "independentEpisodeCount": len(mode.episode_ids),
            "representativeContributions": [{
                "basisId": basis_id,
                "roleMassAtRevision": basis_by_id[basis_id].role_mass,
            } for basis_id in contribution_ids[:(6 if selected else 2)] if basis_id in basis_by_id],
        }
        if mode.kind == "hline":
            common.update({
                "ridge": {"lowPrice": mode.ridge_low, "highPrice": mode.ridge_high},
                "centerPrice": mode.center_start,
                "zoneHalfWidth": mode.zone_half_width,
                "dispersionAtr": mode.dispersion_start_atr,
            })
        else:
            start_width = max(mode.zone_half_width, mode.dispersion_start_atr * price_scale)
            end_width = max(mode.zone_half_width, mode.dispersion_end_atr * price_scale)
            common.update({
                "hypothesisMedoid": {"yAtWindowStart": mode.center_start, "yAtWindowEnd": mode.center_end},
                "boundaryEstimate": {"yAtWindowStart": mode.center_start, "yAtWindowEnd": mode.center_end},
                "dispersion": {"startAtr": mode.dispersion_start_atr, "endAtr": mode.dispersion_end_atr},
                "ribbon": {
                    "lowerYAtWindowStart": mode.center_start - start_width,
                    "upperYAtWindowStart": mode.center_start + start_width,
                    "lowerYAtWindowEnd": mode.center_end - end_width,
                    "upperYAtWindowEnd": mode.center_end + end_width,
                },
                "representativeHypotheses": list(mode.representative_hypotheses[:3]),
            })
        result.append(common)
    return result


def _basis_dto(item):
    return {
        "basisId": item.basis_id,
        "clusterId": item.cluster_id,
        "observedAt": item.observed_at,
        "confirmedAt": item.confirmed_at,
        "endpointPrice": item.endpoint_price,
        "bodyEdgePrice": item.body_edge_price,
        "corridorLow": item.corridor_low,
        "corridorHigh": item.corridor_high,
        "kind": "hline_reaction" if item.role in {"support", "resistance"} else "trend_endpoint",
        "role": item.role,
        "effectiveScale": item.effective_scale,
        "roleMassAtAsOf": item.role_mass,
        "participation": item.participation,
    }


def _dedupe_basis(items):
    by_id = {}
    for item in items:
        by_id[item.basis_id] = item
    return tuple(by_id[key] for key in sorted(by_id))


def _required_first(items, required, key):
    return sorted(items, key=lambda item: (key(item) not in required, ROLE_ORDER[item.role], -item.role_mass, item.basis_id))
