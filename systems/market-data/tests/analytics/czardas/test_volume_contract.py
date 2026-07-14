from __future__ import annotations

from copy import deepcopy

from alfaka.analytics.czardas import Ready, analyze_czardas
from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas.evidence import build_evidence
from alfaka.analytics.czardas.features import build_features
from alfaka.analytics.czardas.meaning import build_base_candle_meanings
from alfaka.analytics.czardas.tape import CandleTape

from .fixtures import flat_rows, oscillating_rows


def _trend_projection(content: dict) -> dict:
    """Resolve index-based SoA links into a complete Trend-only semantic slice."""

    field = content["czardasField"]
    facts = field["basisFacts"]
    basis_ids = facts["basisIds"]
    trend_basis_indexes = [index for index, role in enumerate(facts["roleCodes"]) if role in {2, 3}]
    trend_basis = [{key: facts[key][index] for key in (
        "basisIds", "roleCodes", "observedIndexes", "confirmedIndexes", "endpointPrices",
        "bodyEdgePrices", "corridorLows", "corridorHighs", "roleMasses", "participations", "effectiveScales",
    )} for index in trend_basis_indexes]

    refs = field["selectedModeRefs"]
    trend_candidate_ids = {
        ref["candidateId"] for ref in refs if ref["kind"] == "trend"
    }
    episodes = field["derivationEpisodes"]
    trend_episodes = []
    for index, candidate_index in enumerate(episodes["candidateIndexes"]):
        ref = refs[candidate_index]
        if ref["candidateId"] not in trend_candidate_ids:
            continue
        trend_episodes.append({
            "candidateId": ref["candidateId"],
            "candidateEpisodeOrdinal": episodes["candidateEpisodeOrdinals"][index],
            "contributionBasisId": basis_ids[episodes["contributionBasisIndexes"][index]],
            "memberBasisIds": [basis_ids[value] for value in episodes["memberBasisIndexes"][index]],
            **{key: episodes[key][index] for key in (
                "observedFromIndexes", "observedToIndexes", "confirmedIndexes", "contributionIndexes", "contributionPrices",
                "corridorLows", "corridorHighs", "initialFormationMasks",
            )},
        })

    validation = []
    for glyph in field["validationGlyphs"]:
        ref = refs[glyph["candidateIndex"]]
        if ref["candidateId"] not in trend_candidate_ids:
            continue
        item = deepcopy(glyph)
        item["candidateId"] = ref["candidateId"]
        item.pop("candidateIndex")
        validation.append(item)

    boundaries = []
    for boundary in content["boundaries"]:
        if boundary["kind"] != "trend":
            continue
        item = deepcopy(boundary)
        item.pop("sourceInferenceId")
        boundaries.append(item)
    drawings = []
    for drawing in content["drawings"]:
        if drawing["czardasLayer"] != "trend":
            continue
        item = deepcopy(drawing)
        item.pop("sourceInferenceId")
        drawings.append(item)
    selected_refs = []
    for ref in refs:
        if ref["kind"] != "trend":
            continue
        item = deepcopy(ref)
        item.pop("sourceInferenceId")
        selected_refs.append(item)
    meaning = field["candleMeanings"]
    trend_factor_keys = (
        "localHighR2", "localLowR2", "localHighR5", "localLowR5", "localHighR13", "localLowR13",
        "lowerResidualAtr", "upperResidualAtr", "trendPenetrationAtr",
    )
    return {
        "selection": content["selection"]["trend"],
        "basis": trend_basis,
        "modes": field["trendModes"],
        "selectedRefs": selected_refs,
        "episodes": trend_episodes,
        "validation": validation,
        "boundaries": boundaries,
        "drawings": drawings,
        "meaning": {
            "summary": meaning["summaries"]["trend"],
            "lower": meaning["roles"]["lower"],
            "upper": meaning["roles"]["upper"],
            "factors": {key: meaning["factors"][key] for key in trend_factor_keys},
            "normalizedFactors": {key: meaning["normalizedFactors"][key] for key in trend_factor_keys},
        },
    }


def test_volume_scaling_does_not_change_trend_geometry_rank_or_field():
    rows = oscillating_rows(volume_scale=1.0)
    changed_rows = [dict(item) for item in rows]
    for index, item in enumerate(changed_rows):
        item["volume"] *= 1.0 + (index % 11)
    normal = analyze_czardas(rows)
    scaled = analyze_czardas(changed_rows)
    assert isinstance(normal, Ready) and isinstance(scaled, Ready)
    assert _trend_projection(normal.content) == _trend_projection(scaled.content)


def test_volume_alone_cannot_create_a_boundary():
    result = analyze_czardas(flat_rows(volume=1_000_000_000.0))
    assert isinstance(result, Ready)
    assert result.content["boundaries"] == []


def test_pre_baseline_hline_basis_does_not_claim_synthetic_volume_participation():
    tape = CandleTape.from_rows(oscillating_rows(), DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    meanings = build_base_candle_meanings(tape, features, DEFAULT_CONFIG)
    _clusters, basis = build_evidence(tape, features, DEFAULT_CONFIG, meanings)
    early_hline = [item for item in basis if item.role in {"support", "resistance"} and item.bar_index < 20]
    assert early_hline
    assert all(item.participation is None for item in early_hline)
