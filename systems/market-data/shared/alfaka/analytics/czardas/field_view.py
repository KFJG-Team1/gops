from __future__ import annotations

from .config import CzardasConfig
from .meaning import CandleMeaningTape
from .numeric import canonical_digest, canonical_json, median
from .tape import CandleTape
from .types import BoundaryCandidate, DetectorResult, FieldMode, RoleBasis
from .structure import domains_to_dto, flows_to_dto, memory_to_dto


ROLE_ORDER = {"support": 0, "resistance": 1, "lower": 2, "upper": 3}
STATE_ORDER = {"coherent": 0, "weak": 1, "opposed": 2}


def build_field_view(
    tape: CandleTape,
    hline: DetectorResult,
    trend: DetectorResult,
    selected: tuple[BoundaryCandidate, ...],
    relations: tuple[dict, ...],
    relation_evidence: tuple[dict, ...],
    meanings: CandleMeaningTape,
    inference_id: str,
    sight_projection_id: str,
    config: CzardasConfig,
    *,
    domains=(),
    regression_flows=(),
    price_memory=(),
    _omitted_pattern_evidence_count=0,
) -> tuple[dict, int]:
    projected_flows = _projected_regression_flows(regression_flows, len(tape.candles) - 1)
    projected_domain_ids = {item.domain_id for item in projected_flows}
    projected_domain_ids.update(
        domain_id
        for relation in relations
        for domain_id in relation["domain"].get("domainIds", ())
    )
    candidates_by_id = {
        item.candidate_id: item
        for item in (*hline.candidates, *trend.candidates)
    }
    supporting_ids = {
        candidate_id
        for relation in relations
        for candidate_id in relation["boundaryCandidateIds"]
    }
    supporting_ids.update(
        candidate_id
        for evidence in relation_evidence
        for candidate_id in evidence["boundaryCandidateIds"]
    )
    derivation_candidates = list(selected)
    derivation_candidates.extend(
        candidates_by_id[item]
        for item in sorted(supporting_ids)
        if item in candidates_by_id and item not in {candidate.candidate_id for candidate in selected}
    )
    derivation_candidates = tuple(derivation_candidates)
    candidate_domain_by_id = {
        item.candidate_id: _formation_domain_id(item, domains)
        for item in derivation_candidates
    }
    projected_domain_ids.update(filter(None, candidate_domain_by_id.values()))
    projected_domains = _projected_domains_with_ancestors(projected_domain_ids, domains)
    episode_ref_by_id = {
        episode_id: [candidate_index, ordinal]
        for candidate_index, candidate in enumerate(derivation_candidates)
        for ordinal, episode_id in enumerate(candidate.fit_episode_ids)
    }
    selected_modes = {
        (item.source_field_mode_id, item.source_field_derivation_digest) for item in derivation_candidates
    }
    all_basis = _dedupe_basis((*hline.basis, *trend.basis))
    basis_by_id = {item.basis_id: item for item in all_basis}
    required_basis = {
        basis_id
        for mode in (*hline.modes, *trend.modes)
        if (mode.field_mode_id, mode.derivation_digest) in selected_modes
        for basis_id in mode.contributor_basis_ids
    }
    required_basis.update(
        basis_id
        for candidate in derivation_candidates
        for episode in candidate.fit_episodes
        for basis_id in episode.member_basis_ids
    )
    # The full selected derivation is retained in basisFacts.  Glyphs are the
    # canonical initial formation contributions actually painted on the chart.
    priority_glyph_basis = {
        episode.contribution_basis_id
        for candidate in derivation_candidates
        for episode in candidate.fit_episodes
        if episode.episode_id in candidate.initial_episode_ids
    }
    # Selected Basis live canonically in compact basisFacts and are painted via
    # validationGlyphs.  The legacy duplicate object glyphs add no information.
    basis_sorted: list[RoleBasis] = []
    basis_facts = sorted(
        (basis_by_id[basis_id] for basis_id in required_basis if basis_id in basis_by_id),
        key=lambda item: item.basis_id,
    )
    basis_fact_index = {item.basis_id: index for index, item in enumerate(basis_facts)}
    h_modes = _mode_dtos(tape, hline.modes, selected_modes, all_basis, required_basis, basis_fact_index)
    t_modes = _mode_dtos(tape, trend.modes, selected_modes, all_basis, required_basis, basis_fact_index)
    eligible_hline_response_segments = [
        {
            **item,
            "windowFromTimestamp": tape.candles[0].timestamp,
            "windowToTimestamp": tape.candles[-1].timestamp,
        }
        for item in sorted(
            hline.response_segments,
            key=lambda row: (ROLE_ORDER[row["role"]], row["lowPrice"], row["segmentId"]),
        )
        if item["activeBasisCount"] >= 2
    ]
    rendered_hline_response_segments = []
    for role in ("support", "resistance"):
        rendered_hline_response_segments.extend(
            [item for item in eligible_hline_response_segments if item["role"] == role][:8]
        )
    selected_refs = [{
        "candidateId": item.candidate_id,
        "kind": item.kind,
        "sourceFieldModeId": item.source_field_mode_id,
        "sourceFieldDerivationDigest": item.source_field_derivation_digest,
        "presentationSelected": item.candidate_id in {candidate.candidate_id for candidate in selected},
        "patternSupporting": item.candidate_id in supporting_ids,
        "formationDomainId": candidate_domain_by_id[item.candidate_id],
    } for item in derivation_candidates]
    validation = []
    derivation_episodes = {
        "candidateIndexes": [],
        "candidateEpisodeOrdinals": [],
        "contributionBasisIndexes": [],
        "memberBasisIndexes": [],
        "observedFromIndexes": [],
        "observedToIndexes": [],
        "confirmedIndexes": [],
        "contributionIndexes": [],
        "contributionPrices": [],
        "corridorLows": [],
        "corridorHighs": [],
        "initialFormationMasks": [],
    }
    for candidate_index, candidate in enumerate(derivation_candidates):
        episodes = {item.episode_id: item for item in candidate.fit_episodes}
        for candidate_episode_ordinal, episode_id in enumerate(candidate.fit_episode_ids):
            episode = episodes[episode_id]
            initial = episode_id in candidate.initial_episode_ids
            derivation_episodes["candidateIndexes"].append(candidate_index)
            derivation_episodes["candidateEpisodeOrdinals"].append(candidate_episode_ordinal)
            derivation_episodes["contributionBasisIndexes"].append(basis_fact_index[episode.contribution_basis_id])
            derivation_episodes["memberBasisIndexes"].append([basis_fact_index[item] for item in episode.member_basis_ids])
            derivation_episodes["observedFromIndexes"].append(episode.observed_from_index)
            derivation_episodes["observedToIndexes"].append(episode.observed_to_index)
            derivation_episodes["confirmedIndexes"].append(episode.confirmed_index)
            derivation_episodes["contributionIndexes"].append(episode.contribution_index)
            derivation_episodes["contributionPrices"].append(episode.contribution_price)
            derivation_episodes["corridorLows"].append(episode.corridor_low)
            derivation_episodes["corridorHighs"].append(episode.corridor_high)
            derivation_episodes["initialFormationMasks"].append(1 if initial else 0)
            episode_index = len(derivation_episodes["candidateIndexes"]) - 1
            if not initial:
                continue
            # Formation glyphs are reconstructed from the mandatory SoA
            # derivationEpisodes closure.  Duplicating them as object records
            # would spend the Field budget without adding provenance.
        for event in candidate.interactions:
            validation.append({
                "validationId": canonical_digest([candidate.candidate_id, event.interaction_id, "interaction"]),
                "candidateIndex": candidate_index,
                "episodeIndex": None,
                "candidateKind": candidate.kind,
                "role": candidate.role,
                "kind": "interaction",
                "observedAt": tape.candles[event.contact_index].timestamp,
                "confirmedAt": None if event.terminal_index is None else tape.candles[event.terminal_index].timestamp,
                "endpointPrice": (
                    candidate.intercept_at_origin
                    + candidate.slope_per_bar * (event.contact_index - candidate.index_origin)
                ),
                "corridorLow": None,
                "corridorHigh": None,
                "interactionId": event.interaction_id,
                "initialFormation": False,
                "residualAtr": None,
                "explorationPressure": event.exploration_pressure,
                "acceptanceMass": event.acceptance_mass,
                "responseScore": event.response_score,
                "outcome": event.outcome,
            })
    field = {
        "schemaVersion": 4,
        "inputContractVersion": config.input_contract_version,
        "inferenceConfigDigest": config.inference_digest,
        "projectionConfigDigest": config.projection_digest,
        "sightProjectionVersion": config.sight_projection_version,
        "sightProjectionId": sight_projection_id,
        "sourceBars": 240,
        "evaluationAsOf": tape.as_of,
        "sourceInferenceId": inference_id,
        "windowFromTimestamp": tape.candles[0].timestamp,
        "windowToTimestamp": tape.candles[-1].timestamp,
        "candleMeanings": meanings.to_dto(tape),
        "structuralDomains": domains_to_dto(tape, projected_domains),
        "regressionFlows": flows_to_dto(tape, projected_flows),
        "priceMemoryRidges": memory_to_dto(price_memory),
        "basisFacts": _basis_facts_dto(basis_facts),
        "basisGlyphs": [_basis_dto(item) for item in basis_sorted],
        "hlineResponseSegments": rendered_hline_response_segments,
        "hlineProfileBins": list(hline.profile_bins),
        "hlineModes": h_modes,
        "trendModes": t_modes,
        "selectedModeRefs": selected_refs,
        "derivationEpisodes": derivation_episodes,
        "validationGlyphs": validation,
        "patternRelationGlyphs": [{
            "relationId": relation["relationId"],
            "kind": relation["kind"],
            "boundaryCandidateIds": relation["boundaryCandidateIds"],
            "domain": relation["domain"],
            "trace": {
                "indexes": [item["index"] for item in relation["trace"]["anchors"]],
                "prices": [item["price"] for item in relation["trace"]["anchors"]],
                "roles": [item["role"] for item in relation["trace"]["anchors"]],
                "episodeRefs": [
                    episode_ref_by_id[episode_id]
                    for episode_id in relation["trace"]["contributingEpisodeIds"]
                    if episode_id in episode_ref_by_id
                ],
            },
            "relationQuality": relation["relationQuality"],
        } for relation in relations],
        "patternEvidenceGlyphs": [{
            "evidenceId": evidence["evidenceId"],
            "kind": evidence["kind"],
            "boundaryCandidateIds": evidence["boundaryCandidateIds"],
            "trace": {
                "indexes": [item["index"] for item in evidence["trace"]["anchors"]],
                "prices": [item["price"] for item in evidence["trace"]["anchors"]],
                "roles": [item["role"] for item in evidence["trace"]["anchors"]],
                "episodeRefs": [
                    episode_ref_by_id[episode_id]
                    for episode_id in evidence["trace"]["contributingEpisodeIds"]
                    if episode_id in episode_ref_by_id
                ],
            },
        } for evidence in relation_evidence],
        "projection": {
            "truncated": False,
            "omittedBasisCount": max(0, len(all_basis) - len(basis_sorted)),
            "omittedHlineResponseSegmentCount": len(hline.response_segments) - len(rendered_hline_response_segments),
            "profileBinsOmitted": False,
            "omittedHlineModeCount": max(0, len(hline.modes) - len(h_modes)),
            "omittedTrendModeCount": max(0, len(trend.modes) - len(t_modes)),
            "omittedHypothesisCount": sum(max(0, len(item.representative_hypotheses) - 1) for item in trend.modes),
            "omittedValidationCount": sum(
                max(0, len(item.fit_episode_ids) - len(item.initial_episode_ids))
                for item in selected
            ),
            "omittedPatternSupportingValidationCount": sum(
                max(0, len(item.fit_episode_ids) - len(item.initial_episode_ids))
                for item in derivation_candidates
                if item.candidate_id not in {candidate.candidate_id for candidate in selected}
            ),
            "omittedPatternEvidenceCount": _omitted_pattern_evidence_count,
        },
    }
    try:
        field_bytes = _fit_budget(
            field, priority_glyph_basis, selected_modes,
            config.target_field_bytes, config.max_field_bytes,
        )
    except ValueError:
        if relation_evidence:
            # PatternEvidence is a representative diagnostic projection. Its
            # entire candidate/mode/episode closure is atomic: when that
            # closure cannot fit, rebuild without it instead of leaving an
            # orphan or truncating fact provenance.
            return build_field_view(
                tape, hline, trend, selected, relations, (), meanings,
                inference_id, sight_projection_id, config,
                domains=domains,
                regression_flows=regression_flows,
                price_memory=price_memory,
                _omitted_pattern_evidence_count=(
                    _omitted_pattern_evidence_count + len(relation_evidence)
                ),
            )
        raise
    return field, field_bytes


def _projected_regression_flows(flows, as_of_index):
    """Keep the Sight hierarchy to one global and one current local OLS flow.

    Inference and Pattern relations still use the complete adaptive flow set;
    this is only the deterministic visual projection promised by Sight.
    """
    if not flows:
        return ()
    root = min(flows, key=lambda item: (
        item.start_index, -item.end_index, item.domain_id,
    ))
    local_candidates = [
        item for item in flows
        if item.flow_id != root.flow_id and item.end_index == as_of_index
    ]
    if not local_candidates:
        return (root,)
    local = min(local_candidates, key=lambda item: (
        item.end_index - item.start_index, -item.start_index, item.flow_id,
    ))
    return (root, local)


def _projected_domains_with_ancestors(domain_ids, domains):
    domains_by_id = {item.domain_id: item for item in domains}
    closed_ids = set(domain_ids)
    pending = sorted(closed_ids)
    while pending:
        domain = domains_by_id.get(pending.pop())
        if domain is None or domain.parent_id is None or domain.parent_id in closed_ids:
            continue
        closed_ids.add(domain.parent_id)
        pending.append(domain.parent_id)
    return tuple(item for item in domains if item.domain_id in closed_ids)


def _formation_domain_id(candidate, domains):
    covering = [
        item for item in domains
        if item.active
        and item.start_index <= candidate.observed_from_index
        and item.end_index >= candidate.observed_to_index
    ]
    if not covering:
        return None
    return min(covering, key=lambda item: (
        item.end_index - item.start_index, -item.depth, item.domain_id,
    )).domain_id


def _fit_budget(field, required_basis, selected_modes, target_budget, hard_budget):
    projection = field["projection"]
    current_size = len(canonical_json(field).encode("utf-8"))
    if current_size <= target_budget:
        return current_size
    remaining = current_size - target_budget + 512
    if field["hlineProfileBins"]:
        remaining -= len(canonical_json(field["hlineProfileBins"]).encode("utf-8"))
        field["hlineProfileBins"] = []
        projection["profileBinsOmitted"] = True
    # Representative facts are lower priority than the Basis and modes they explain.
    omitted_hypotheses = 0
    for item in field["trendModes"]:
        hypotheses = item.get("representativeHypotheses") or []
        if len(hypotheses) > 1:
            remaining -= sum(len(canonical_json(value).encode("utf-8")) + 1 for value in hypotheses[1:])
            omitted_hypotheses += len(hypotheses) - 1
            item["representativeHypotheses"] = hypotheses[:1]
    projection["omittedHypothesisCount"] += omitted_hypotheses
    remaining = _trim_optional_for_saving(
        field, "basisGlyphs", lambda item: item["basisId"] in required_basis, remaining,
        projection, "omittedBasisCount",
    )
    remaining = _trim_optional_for_saving(
        field, "hlineResponseSegments", lambda _item: False, remaining,
        projection, "omittedHlineResponseSegmentCount",
    )
    for key, omitted_key in (("trendModes", "omittedTrendModeCount"), ("hlineModes", "omittedHlineModeCount")):
        remaining = _trim_optional_for_saving(
            field, key,
            lambda item: (item["fieldModeId"], item["derivationDigest"]) in selected_modes,
            remaining, projection, omitted_key,
        )
    # Policy caps above are ordinary Sight projection. `truncated` is reserved
    # for an actual byte-budget cut performed in this function.
    final_size = len(canonical_json(field).encode("utf-8"))
    projection["truncated"] = final_size < current_size
    if final_size > hard_budget:
        raise ValueError("payload_limit_exceeded")
    return final_size


def _trim_optional_for_saving(field, key, mandatory, remaining, projection, omitted_key):
    values = field[key]
    if remaining <= 0 or not values:
        return remaining
    optional = [item for item in values if not mandatory(item)]
    if not optional:
        return remaining
    removed: set[int] = set()
    for item in reversed(optional):
        removed.add(id(item))
        remaining -= len(canonical_json(item).encode("utf-8")) + 1
        if remaining <= 0:
            break
    field[key] = [item for item in values if id(item) not in removed]
    projection[omitted_key] += len(removed)
    return remaining


def _mode_dtos(tape, modes, selected_modes, all_basis, required_basis, basis_fact_index):
    basis_by_id = {item.basis_id: item for item in all_basis}
    atr_values = [item.high - item.low for item in tape.candles]
    price_scale = median(atr_values) if any(atr_values) else max(0.01, tape.candles[-1].close * 1e-6)
    ordered = sorted(modes, key=lambda item: (ROLE_ORDER[item.role], STATE_ORDER[item.mode_state], -item.support_mass, item.dispersion_start_atr + item.dispersion_end_atr, item.field_mode_id))
    chosen = []
    roles = sorted({item.role for item in ordered}, key=lambda role: ROLE_ORDER[role])
    for role in roles:
        role_modes = [item for item in ordered if item.role == role]
        selected_role_modes = [item for item in role_modes if (item.field_mode_id, item.derivation_digest) in selected_modes]
        values = list(selected_role_modes)
        optional_role_modes = [item for item in role_modes if item not in values]
        values.extend(optional_role_modes[:1])
        chosen.extend(values)
    chosen_by_id = {(item.field_mode_id, item.derivation_digest): item for item in chosen}
    ordered = sorted(chosen_by_id.values(), key=lambda item: (ROLE_ORDER[item.role], STATE_ORDER[item.mode_state], -item.support_mass, item.dispersion_start_atr + item.dispersion_end_atr, item.field_mode_id))
    result = []
    for mode in ordered:
        selected = (mode.field_mode_id, mode.derivation_digest) in selected_modes
        contribution_ids = sorted(
            mode.contributor_basis_ids,
            key=lambda basis_id: (basis_id not in required_basis, basis_id),
        )
        common = {
            "fieldModeId": mode.field_mode_id,
            "viewRole": "landscape_and_selected" if selected else "landscape",
            "derivationDigest": mode.derivation_digest,
            "role": mode.role,
            "modeState": mode.mode_state,
            "geometryState": mode.geometry_state,
            "originSeedBasisIds": list(mode.origin_seed_basis_ids),
            "supportMass": mode.support_mass,
            "oppositionMass": mode.opposition_mass,
            "contributorCount": len(mode.contributor_basis_ids),
            "contributorBasisIndexes": [
                basis_fact_index[basis_id]
                for basis_id in mode.contributor_basis_ids
                if selected and basis_id in basis_fact_index
            ],
            "independentEpisodeCount": len(mode.episode_ids),
            "representativeContributions": [] if selected else [{
                "basisId": basis_id,
                "roleMassAtAsOf": basis_by_id[basis_id].role_mass,
            } for basis_id in contribution_ids[:1] if basis_id in basis_by_id],
        }
        if mode.kind == "hline":
            common.update({
                "windowFromTimestamp": tape.candles[0].timestamp,
                "windowToTimestamp": tape.candles[-1].timestamp,
                "ridge": {"lowPrice": mode.ridge_low, "highPrice": mode.ridge_high},
                "centerPrice": mode.center_start,
                "zoneHalfWidth": mode.zone_half_width,
                "dispersionAtr": mode.dispersion_start_atr,
            })
        else:
            start_width = max(mode.zone_half_width, mode.dispersion_start_atr * price_scale)
            end_width = max(mode.zone_half_width, mode.dispersion_end_atr * price_scale)
            common.update({
                "hypothesisMedoid": {
                    "fromTimestamp": tape.candles[0].timestamp,
                    "fromPrice": mode.center_start,
                    "toTimestamp": tape.candles[-1].timestamp,
                    "toPrice": mode.center_end,
                },
                "boundaryEstimate": {
                    "fromTimestamp": tape.candles[0].timestamp,
                    "fromPrice": mode.center_start,
                    "toTimestamp": tape.candles[-1].timestamp,
                    "toPrice": mode.center_end,
                },
                "dispersion": {"startAtr": mode.dispersion_start_atr, "endAtr": mode.dispersion_end_atr},
                "ribbon": {
                    "fromTimestamp": tape.candles[0].timestamp,
                    "lowerFromPrice": mode.center_start - start_width,
                    "upperFromPrice": mode.center_start + start_width,
                    "toTimestamp": tape.candles[-1].timestamp,
                    "lowerToPrice": mode.center_end - end_width,
                    "upperToPrice": mode.center_end + end_width,
                },
                "representativeHypotheses": [] if selected else [
                    {
                        "hypothesisId": item["hypothesisId"],
                        "sourceBasisIds": item["sourceBasisIds"],
                        "fromTimestamp": tape.candles[0].timestamp,
                        "fromPrice": item["yAtWindowStart"],
                        "toTimestamp": tape.candles[-1].timestamp,
                        "toPrice": item["yAtWindowEnd"],
                        "seedMass": item["seedMass"],
                    }
                    for item in mode.representative_hypotheses[:1]
                ],
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


def _basis_facts_dto(items):
    return {
        "basisIds": [item.basis_id for item in items],
        "roleCodes": [ROLE_ORDER[item.role] for item in items],
        "observedIndexes": [item.bar_index for item in items],
        "confirmedIndexes": [item.confirmed_index for item in items],
        "endpointPrices": [item.endpoint_price for item in items],
        "bodyEdgePrices": [item.body_edge_price for item in items],
        "corridorLows": [item.corridor_low for item in items],
        "corridorHighs": [item.corridor_high for item in items],
        "roleMasses": [item.role_mass for item in items],
        "participations": [item.participation for item in items],
        "effectiveScales": [item.effective_scale for item in items],
        "roleCodebook": {"support": 0, "resistance": 1, "lower": 2, "upper": 3},
    }


def _dedupe_basis(items):
    by_id = {}
    for item in items:
        by_id[item.basis_id] = item
    return tuple(by_id[key] for key in sorted(by_id))


def _required_first(items, required, key):
    return sorted(items, key=lambda item: (key(item) not in required, ROLE_ORDER[item.role], -item.role_mass, item.basis_id))
