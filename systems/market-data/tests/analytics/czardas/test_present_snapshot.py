from __future__ import annotations

from datetime import datetime
import base64
import struct

import pytest

from alfaka.analytics.czardas import Ready, analyze_czardas
from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas.evidence import build_evidence
from alfaka.analytics.czardas.features import build_features
from alfaka.analytics.czardas.meaning import build_base_candle_meanings
from alfaka.analytics.czardas.numeric import canonical_json
from alfaka.analytics.czardas.tape import CandleTape

from .fixtures import flat_rows, oscillating_rows


def test_present_snapshot_emits_one_current_meaning_for_every_bar():
    result = analyze_czardas(oscillating_rows())
    assert isinstance(result, Ready)
    content = result.content
    meanings = content["czardasField"]["candleMeanings"]

    assert content["algorithmVersion"] == "czardas-v3"
    assert content["configVersion"] == "czardas-config-v3"
    assert content["inputContractVersion"] == "canonical-ohlcv-q8-v1"
    assert content["czardasField"]["schemaVersion"] == 3
    assert content["czardasField"]["sightProjectionId"] == content["sightProjectionId"]
    assert meanings["evaluationAsOf"] == content["asOf"]
    assert len(meanings["timestamps"]) == len(meanings["candleKeys"]) == 240
    for values in (*meanings["summaries"].values(), *meanings["roles"].values()):
        assert len(values) == 240


def test_later_context_inside_the_same_snapshot_can_change_an_earlier_current_meaning():
    rows = oscillating_rows()
    changed = [dict(item) for item in rows]
    changed[239]["high"] += 8.0
    base = analyze_czardas(rows)
    revised = analyze_czardas(changed)
    assert isinstance(base, Ready) and isinstance(revised, Ready)

    base_values = base.content["czardasField"]["candleMeanings"]["roles"]
    revised_values = revised.content["czardasField"]["candleMeanings"]["roles"]
    assert base_values["upper"][228] != revised_values["upper"][228]


def test_confirmation_is_a_market_fact_bounded_by_as_of():
    tape = CandleTape.from_rows(oscillating_rows(), DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    meanings = build_base_candle_meanings(tape, features, DEFAULT_CONFIG)
    _clusters, basis = build_evidence(tape, features, DEFAULT_CONFIG, meanings)
    as_of = datetime.fromisoformat(tape.as_of.replace("Z", "+00:00"))

    assert basis
    for item in basis:
        observed = datetime.fromisoformat(item.observed_at.replace("Z", "+00:00"))
        confirmed = datetime.fromisoformat(item.confirmed_at.replace("Z", "+00:00"))
        assert observed <= confirmed <= as_of

    meaning_dto = meanings.to_dto(tape)
    pending_bit = meaning_dto["phaseCodebook"]["confirmationPending"]
    assert any(mask & pending_bit for mask in meaning_dto["phaseMasks"][-13:])


def test_v3_output_has_no_historical_state_contract_fields():
    result = analyze_czardas(oscillating_rows())
    assert isinstance(result, Ready)
    payload = canonical_json(result.content)
    for banned in (
        "fieldRevi" + "sion",
        "modelRevi" + "sion",
        "sourceFieldRevi" + "sion",
        "engineRevi" + "sion",
        "line" + "ageFormedAt",
        "revi" + "sionFormedAt",
        "first" + "SeenAt",
        "origin" + "FieldModeId",
        "verifi" + "cation",
    ):
        assert banned not in payload


def test_current_distance_is_atr_normalized():
    rows = oscillating_rows()
    result = analyze_czardas(rows)
    assert isinstance(result, Ready)
    tape = CandleTape.from_rows(rows, DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    atr = features.atr_scale(239, tape.candles[-1].close)

    for boundary in result.content["boundaries"]:
        expected = min(1.0, abs(boundary["line"]["priceAtAsOf"] - tape.candles[-1].close) / (3 * atr))
        assert boundary["normalizedCurrentDistance"] == pytest.approx(expected)


def test_selected_derivation_graph_is_closed_without_orphans():
    result = analyze_czardas(oscillating_rows())
    assert isinstance(result, Ready)
    field = result.content["czardasField"]
    fact_ids = field["basisFacts"]["basisIds"]
    assert len(fact_ids) == len(set(fact_ids))

    selected = {(item["sourceFieldModeId"], item["sourceFieldDerivationDigest"]) for item in field["selectedModeRefs"]}
    modes = [*field["hlineModes"], *field["trendModes"]]
    selected_mode_dtos = [item for item in modes if (item["fieldModeId"], item["derivationDigest"]) in selected]
    assert len(selected_mode_dtos) == len(selected)
    for mode in selected_mode_dtos:
        assert set(item["basisId"] for item in mode["representativeContributions"]).issubset(fact_ids)
        assert len(mode["contributorBasisIndexes"]) == mode["contributorCount"]
        assert all(0 <= index < len(fact_ids) for index in mode["contributorBasisIndexes"])

    episode_count = len(field["derivationEpisodes"]["candidateIndexes"])
    assert episode_count > 0
    assert len(field["derivationEpisodes"]["candidateEpisodeOrdinals"]) == episode_count
    boundaries = {item["candidateId"]: item for item in result.content["boundaries"]}
    for candidate_index, ordinal in zip(
        field["derivationEpisodes"]["candidateIndexes"],
        field["derivationEpisodes"]["candidateEpisodeOrdinals"],
        strict=True,
    ):
        candidate_id = field["selectedModeRefs"][candidate_index]["candidateId"]
        assert boundaries[candidate_id]["formation"]["fitEpisodeIds"][ordinal]
    for indexes in field["derivationEpisodes"]["memberBasisIndexes"]:
        assert indexes and all(0 <= index < len(fact_ids) for index in indexes)
    assert all(
        0 <= index < len(fact_ids)
        for index in field["derivationEpisodes"]["contributionBasisIndexes"]
    )
    for episode_index, basis_index in enumerate(field["derivationEpisodes"]["contributionBasisIndexes"]):
        assert field["derivationEpisodes"]["contributionIndexes"][episode_index] == field["basisFacts"]["observedIndexes"][basis_index]
        assert field["derivationEpisodes"]["contributionPrices"][episode_index] == field["basisFacts"]["endpointPrices"][basis_index]


def test_factor_transport_is_complete_compact_and_usage_honest():
    result = analyze_czardas(oscillating_rows())
    assert isinstance(result, Ready)
    meanings = result.content["czardasField"]["candleMeanings"]
    expected = {
        "rangeAtr", "absoluteReturnAtr", "bodyFraction", "lowerWickFraction",
        "upperWickFraction", "volumeRank", "volumeZ", "participation",
        "localHighR2", "localLowR2", "localHighR5", "localLowR5",
        "localHighR13", "localLowR13", "supportProximity", "resistanceProximity", "lowerResidualAtr",
        "upperResidualAtr", "hlinePenetrationAtr", "trendPenetrationAtr", "reclaimStrength",
    }
    assert set(meanings["factors"]) == set(meanings["normalizedFactors"]) == expected
    assert set(meanings["rawFactorScales"]) == set(meanings["rawFactorRanges"]) == expected
    assert meanings["rawFactorOverflowPolicy"] == "reject"
    for values in (*meanings["factors"].values(), *meanings["normalizedFactors"].values()):
        assert len(base64.b64decode(values, validate=True)) == 480
    support = struct.unpack(">240h", base64.b64decode(meanings["factors"]["supportProximity"]))
    resistance = struct.unpack(">240h", base64.b64decode(meanings["factors"]["resistanceProximity"]))
    assert support != resistance
    assert meanings["reasonEncoding"] == "uint32-bitmask-base64-be"
    assert len(base64.b64decode(meanings["reasonMasks"], validate=True)) == 960

    codebook = {item["code"]: item for item in meanings["reasonCodebook"]}
    assert all(codebook[code]["usage"] == "visualization_only" for code in range(3, 11))
    reason_masks = struct.unpack(">240I", base64.b64decode(meanings["reasonMasks"]))
    basis_facts = result.content["czardasField"]["basisFacts"]
    role_reason_codes = {0: 19, 1: 20, 2: 21, 3: 22}
    for index, role_code in zip(
        basis_facts["observedIndexes"],
        basis_facts["roleCodes"],
        strict=True,
    ):
        reason = codebook[role_reason_codes[role_code]]
        assert reason["usage"] == "geometry_input"
        assert reason_masks[index] & (1 << reason["code"])
    geometry_bit = meanings["phaseCodebook"]["geometryInput"]
    assert any(mask & geometry_bit for mask in meanings["phaseMasks"])
    assert any(not (mask & geometry_bit) for mask in meanings["phaseMasks"])


def test_missing_selected_boundaries_leave_null_relations_with_explicit_reasons():
    result = analyze_czardas(flat_rows())
    assert isinstance(result, Ready)
    assert result.content["boundaries"] == []
    meanings = result.content["czardasField"]["candleMeanings"]
    codebook = {item["key"]: item for item in meanings["reasonCodebook"]}
    reason_masks = struct.unpack(">240I", base64.b64decode(meanings["reasonMasks"]))

    for factor in (
        "supportProximity", "resistanceProximity", "lowerResidualAtr", "upperResidualAtr",
    ):
        assert struct.unpack(">240h", base64.b64decode(meanings["factors"][factor])) == (-32768,) * 240
    for key in (
        "support_boundary_unavailable", "resistance_boundary_unavailable",
        "lower_boundary_unavailable", "upper_boundary_unavailable",
    ):
        code = codebook[key]["code"]
        assert codebook[key]["usage"] == "visualization_only"
        assert all(mask & (1 << code) for mask in reason_masks)


def test_projection_reports_non_rendered_fit_validation_facts_exactly():
    result = analyze_czardas(oscillating_rows())
    assert isinstance(result, Ready)

    expected = sum(
        max(0, boundary["formation"]["fitCount"] - len(boundary["formation"]["initialFormationEpisodeIds"]))
        for boundary in result.content["boundaries"]
    )
    assert result.content["czardasField"]["projection"]["omittedValidationCount"] == expected
