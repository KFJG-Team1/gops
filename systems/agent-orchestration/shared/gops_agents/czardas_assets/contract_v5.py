from __future__ import annotations

import base64
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from typing import Any

from alfaka.analytics.czardas import DEFAULT_CONFIG
from alfaka.analytics.czardas.data import SUPPORTED_INTERVALS
from alfaka.analytics.czardas.meaning import FACTOR_CODEBOOK_VERSION
from alfaka.analytics.czardas.numeric import identity_digest


_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_PATTERNS = {"triangle", "channel", "rectangle", "wedge", "flag", "pennant"}
_TOP = {
    "algorithmVersion", "configVersion", "inputContractVersion", "timeContractVersion",
    "calendarVersion", "inferenceConfigDigest", "projectionConfigDigest",
    "sightProjectionVersion", "sightProjectionId", "inferenceId", "symbol", "interval",
    "asOf", "lastCandleKey", "inputDigest", "status", "coverage", "selection",
    "boundaries", "patternRelations", "drawings", "czardasField", "rejectSummary",
}
_HISTORICAL = {
    "fieldRevision", "modelRevision", "sourceFieldRevision", "engineRevision",
    "lineageFormedAt", "revisionFormedAt", "firstSeenAt", "replayLineageCap",
    "replay_lineage_cap", "originFieldModeId", "roleMassAtRevision", "verification",
    "verificationCount", "lifecycle",
}


class V5ContractError(ValueError):
    pass


def validate_v5_pack(pack: Any, *, expected_symbol=None, expected_interval=None) -> dict[str, Any]:
    root = _record(pack, "pack")
    _need(set(root) == _TOP, "pack has missing or unknown top-level keys")
    _reject_historical(root)
    _need(root.get("algorithmVersion") == DEFAULT_CONFIG.algorithm_version, "algorithmVersion is incompatible")
    _need(root.get("configVersion") == DEFAULT_CONFIG.config_version, "configVersion is incompatible")
    _need(root.get("inputContractVersion") == DEFAULT_CONFIG.input_contract_version, "inputContractVersion is incompatible")
    _need(root.get("timeContractVersion") == DEFAULT_CONFIG.time_contract_version, "timeContractVersion is incompatible")
    _need(root.get("calendarVersion") == DEFAULT_CONFIG.calendar_version, "calendarVersion is incompatible")
    _need(root.get("inferenceConfigDigest") == DEFAULT_CONFIG.inference_digest, "inferenceConfigDigest is incompatible")
    _need(root.get("projectionConfigDigest") == DEFAULT_CONFIG.projection_digest, "projectionConfigDigest is incompatible")
    _need(root.get("sightProjectionVersion") == DEFAULT_CONFIG.sight_projection_version, "sightProjectionVersion is incompatible")
    symbol = _text(root.get("symbol"), "symbol")
    interval = _text(root.get("interval"), "interval")
    _need(symbol == symbol.upper(), "symbol must be uppercase")
    _need(interval in SUPPORTED_INTERVALS, "interval is unsupported")
    if expected_symbol is not None:
        _need(symbol == str(expected_symbol).strip().upper(), "pack symbol does not match scope")
    if expected_interval is not None:
        _need(interval == str(expected_interval).strip(), "pack interval does not match scope")
    as_of = _timestamp(root.get("asOf"), "asOf")
    input_digest = _digest(root.get("inputDigest"), "inputDigest")
    inference_id = _digest(root.get("inferenceId"), "inferenceId")
    expected_inference = identity_digest([
        root["algorithmVersion"], root["configVersion"], root["inputContractVersion"],
        root["timeContractVersion"], root["calendarVersion"], root["inferenceConfigDigest"],
        symbol, interval, root["asOf"], input_digest,
    ])
    _need(inference_id == expected_inference, "inferenceId is inconsistent")
    _need(root.get("sightProjectionId") == identity_digest([
        inference_id, root["sightProjectionVersion"], root["projectionConfigDigest"],
    ]), "sightProjectionId is inconsistent")
    _need(root.get("status") == "ready", "pack status must be ready")
    coverage = _record(root.get("coverage"), "coverage")
    _need(coverage.get("state") == "exact", "coverage must be exact")
    _need(all(coverage.get(key) == 240 for key in ("targetCompleted", "actualCompleted", "analysisBars")), "coverage must be exact-240")

    boundaries = _array(root.get("boundaries"), "boundaries", 7)
    boundary_by_id = _boundaries(boundaries, as_of)
    relations = _relations(_array(root.get("patternRelations"), "patternRelations", 2), as_of)
    field = _record(root.get("czardasField"), "czardasField")
    candidate_refs = _field(field, root, boundary_by_id, relations, as_of)
    for relation in relations.values():
        _need(set(relation["boundaryCandidateIds"]).issubset(candidate_refs), "Pattern references a missing Field boundary")
    drawing_counts = _drawings(
        _array(root.get("drawings"), "drawings", 9), boundary_by_id, candidate_refs,
        relations, field, interval, inference_id, as_of,
    )
    selection = _record(root.get("selection"), "selection")
    _selection(selection, drawing_counts)
    _need(isinstance(root.get("rejectSummary"), dict), "rejectSummary must be an object")
    _need(_size(field) <= 80 * 1024, "Czardas Field exceeds 80 KiB")
    _need(_size(root) <= 96 * 1024, "Czardas pack exceeds 96 KiB")
    return root


def _boundaries(values, as_of):
    result = {}
    for index, value in enumerate(values):
        path = f"boundaries[{index}]"
        item = _record(value, path)
        candidate_id = _digest(item.get("candidateId"), f"{path}.candidateId")
        _need(candidate_id not in result, "boundary IDs must be unique")
        kind, role = item.get("kind"), item.get("role")
        _need(kind in {"hline", "trend"}, f"{path}.kind is invalid")
        _need(role in ({"support", "resistance"} if kind == "hline" else {"lower", "upper"}), f"{path}.role is invalid")
        _need(item.get("evidenceState") in {"formed", "response_supported", "baseline_memory"}, f"{path}.evidenceState is invalid")
        formation = _record(item.get("formation"), f"{path}.formation")
        _need(isinstance(formation.get("fitCount"), int) and formation["fitCount"] >= 2, f"{path} has insufficient fit evidence")
        _need(formation.get("initialFormationCount") == 2, f"{path} must have two initial episodes")
        _not_after(formation.get("fitEvidenceConfirmedAt"), as_of, f"{path}.fitEvidenceConfirmedAt")
        line = _record(item.get("line"), f"{path}.line")
        _need(all(_finite(line.get(key)) for key in ("slopePerBar", "priceAtAsOf", "zoneHalfWidth")), f"{path}.line is invalid")
        _need(isinstance(item.get("explanation"), dict), f"{path}.explanation is missing")
        rank = _record(item.get("rank"), f"{path}.rank")
        for key in ("presentRelevance", "selectionUtility"):
            _need(_finite(rank.get(key)) and 0 <= rank[key] <= 1, f"{path}.{key} is invalid")
        result[candidate_id] = item
    _need(1 <= sum(item["kind"] == "hline" for item in result.values()) <= 4, "Ready pack must have 1..4 H-Lines")
    _need(sum(item["kind"] == "trend" for item in result.values()) <= 3, "Trend limit exceeded")
    return result


def _relations(values, as_of):
    result = {}
    for index, value in enumerate(values):
        path = f"patternRelations[{index}]"
        item = _record(value, path)
        relation_id = _digest(item.get("relationId"), f"{path}.relationId")
        _need(relation_id not in result and item.get("kind") in _PATTERNS, f"{path} identity is invalid")
        boundary_ids = _array(item.get("boundaryCandidateIds"), f"{path}.boundaryCandidateIds")
        _need(len(boundary_ids) == 2 and len(set(boundary_ids)) == 2, f"{path} needs two boundaries")
        _need(all(_DIGEST.fullmatch(str(value)) for value in boundary_ids), f"{path} boundary identity is invalid")
        domain = _record(item.get("domain"), f"{path}.domain")
        domain_from = _timestamp(domain.get("fromTimestamp"), f"{path}.from")
        domain_to = _timestamp(domain.get("toTimestamp"), f"{path}.to")
        _need(domain_from <= domain_to <= as_of, f"{path} domain chronology is invalid")
        impulse = item.get("impulse")
        if item.get("kind") in {"flag", "pennant"}:
            _need(isinstance(impulse, dict), f"{path} requires a preceding impulse")
        if impulse is not None:
            impulse = _record(impulse, f"{path}.impulse")
            impulse_from = _timestamp(impulse.get("fromTimestamp"), f"{path}.impulse.from")
            impulse_to = _timestamp(impulse.get("toTimestamp"), f"{path}.impulse.to")
            _need(impulse_from <= impulse_to < domain_from, f"{path} impulse must precede its consolidation")
            _need(impulse.get("direction") in {-1, 1}, f"{path} impulse direction is invalid")
            _need(_finite(impulse.get("normalizedMove")), f"{path} impulse move is invalid")
            _need(
                _finite(impulse.get("pathEfficiency")) and 0 <= impulse["pathEfficiency"] <= 1,
                f"{path} impulse efficiency is invalid",
            )
        _need(item.get("traceRef") == relation_id, f"{path}.traceRef is invalid")
        _need(3 <= item.get("traceAnchorCount", 0) <= 16, f"{path} trace anchor count is invalid")
        _need(3 <= item.get("traceFactCount", 0) <= 16, f"{path} trace fact count is invalid")
        for key in ("presentRelevance", "selectionScore"):
            _need(_finite(item.get(key)) and 0 <= item[key] <= 1, f"{path}.{key} is invalid")
        result[relation_id] = item
    return result


def _field(field, pack, boundaries, relations, as_of):
    _need(field.get("schemaVersion") == 5, "Field schema is incompatible")
    for left, right in (
        ("inputContractVersion", "inputContractVersion"),
        ("inferenceConfigDigest", "inferenceConfigDigest"),
        ("projectionConfigDigest", "projectionConfigDigest"),
        ("sightProjectionVersion", "sightProjectionVersion"),
        ("sightProjectionId", "sightProjectionId"),
    ):
        _need(field.get(left) == pack.get(right), f"Field {left} is inconsistent")
    _need(field.get("sourceBars") == 240 and field.get("evaluationAsOf") == pack.get("asOf"), "Field snapshot is inconsistent")
    _need(field.get("sourceInferenceId") == pack.get("inferenceId"), "Field inference is inconsistent")
    window_from = _timestamp(field.get("windowFromTimestamp"), "Field windowFrom")
    _need(_timestamp(field.get("windowToTimestamp"), "Field windowTo") == as_of, "Field window must end at asOf")
    meanings = _record(field.get("candleMeanings"), "candleMeanings")
    _need(meanings.get("evaluationAsOf") == pack.get("asOf"), "CandleMeaning asOf is inconsistent")
    _need(meanings.get("codebookVersion") == FACTOR_CODEBOOK_VERSION, "CandleMeaning codebook is incompatible")
    for key in ("candleKeys", "timestamps", "availabilityMasks", "phaseMasks"):
        _need(len(_array(meanings.get(key), f"candleMeanings.{key}")) == 240, f"{key} must contain 240 values")
    timestamps = meanings["timestamps"]
    _need(all(_timestamp(value, "candle timestamp") <= as_of for value in timestamps), "CandleMeaning uses post-asOf data")
    _need(timestamps[0] == field.get("windowFromTimestamp") and timestamps[-1] == pack.get("asOf"), "CandleMeaning window is inconsistent")
    _need(meanings.get("rawFactorEncoding") == "int16-base64-be", "raw factor encoding is incompatible")
    _need(meanings.get("normalizedFactorEncoding") == "int16-base64-be", "normalized factor encoding is incompatible")
    _need(meanings.get("rawFactorNullSentinel") == -32768 and meanings.get("normalizedFactorNullSentinel") == -32768, "factor null sentinel is incompatible")
    _need(meanings.get("rawFactorOverflowPolicy") == "reject", "raw factor overflow policy is incompatible")
    _need(meanings.get("normalizedFactorScale") == 1000 and meanings.get("scoreScale") == 1000, "factor scale is incompatible")
    for group, expected_keys in (("summaries", {"shared", "hline", "trend", "compositePercentile"}), ("roles", {"support", "resistance", "lower", "upper"})):
        series = _record(meanings.get(group), f"candleMeanings.{group}")
        _need(set(series) == expected_keys, f"{group} keys are incompatible")
        for values in series.values():
            _need(isinstance(values, list) and len(values) == 240 and all(isinstance(value, int) and 0 <= value <= 1000 for value in values), f"{group} series must contain 240 scaled values")
    scales = _record(meanings.get("rawFactorScales"), "rawFactorScales")
    transforms = _record(meanings.get("rawFactorTransforms"), "rawFactorTransforms")
    ranges = _record(meanings.get("rawFactorRanges"), "rawFactorRanges")
    factor_codebook = _array(meanings.get("factorCodebook"), "factorCodebook", 64)
    _need(bool(factor_codebook), "factorCodebook is empty")
    factor_keys = []
    for value in factor_codebook:
        item = _record(value, "factorCodebook item")
        key = _text(item.get("key"), "factorCodebook.key")
        _need(key not in factor_keys, "factorCodebook keys must be unique")
        factor_keys.append(key)
        _text(item.get("label"), "factorCodebook.label")
        _need(item.get("channel") in {"shared", "hline", "trend"}, "factorCodebook channel is invalid")
        _need(_finite(item.get("scale")) and item["scale"] > 0, "factorCodebook scale is invalid")
        _need(item.get("transform") in {"linear", "log1p"}, "factorCodebook transform is invalid")
        _need(scales.get(key) == item["scale"] and transforms.get(key) == item["transform"], "factorCodebook transport is inconsistent")
    _need(set(scales) == set(transforms) == set(ranges) == set(factor_keys), "factor transport keys are incompatible")
    for key, value in ranges.items():
        _need(isinstance(value, list) and len(value) == 2 and all(_finite(item) for item in value) and value[0] <= value[1], f"rawFactorRanges.{key} is invalid")
        encoded_limit = 32767 / scales[key]
        expected = (
            (0.0, math.expm1(encoded_limit))
            if transforms[key] == "log1p"
            else (-encoded_limit, encoded_limit)
        )
        for actual, target in zip(value, expected):
            tolerance = max(1e-9, abs(target) * 1e-12)
            _need(abs(actual - target) <= tolerance, f"rawFactorRanges.{key} is inconsistent")
    for group in ("factors", "normalizedFactors"):
        values = _record(meanings.get(group), f"candleMeanings.{group}")
        _need(set(values) == set(factor_keys), f"{group} must contain the complete factor codebook")
        for encoded in values.values():
            try:
                _need(len(base64.b64decode(encoded, validate=True)) == 480, f"{group} series must encode 240 int16 values")
            except Exception as exc:
                raise V5ContractError(f"{group} contains invalid base64") from exc
    domains = _array(field.get("structuralDomains"), "structuralDomains")
    domain_ids = set()
    parent_domain_ids = set()
    for value in domains:
        domain = _record(value, "structuralDomain")
        domain_id = _digest(domain.get("domainId"), "structuralDomain.domainId")
        _need(domain_id not in domain_ids, "StructuralDomain IDs must be unique")
        domain_ids.add(domain_id)
        if domain.get("parentId") is not None:
            parent_domain_ids.add(_digest(domain.get("parentId"), "structuralDomain.parentId"))
        _need(isinstance(domain.get("startIndex"), int) and isinstance(domain.get("endIndex"), int) and 0 <= domain["startIndex"] <= domain["endIndex"] < 240, "StructuralDomain range is invalid")
    _need(parent_domain_ids.issubset(domain_ids), "StructuralDomain parent is missing")
    flows = _array(field.get("regressionFlows"), "regressionFlows", 2)
    for value in flows:
        flow = _record(value, "regressionFlow")
        _digest(flow.get("flowId"), "regressionFlow.flowId")
        _need(flow.get("domainId") in domain_ids, "RegressionFlow domain is missing")
        _need(all(_finite(flow.get(key)) for key in ("startPrice", "endPrice", "slopePerBar", "corridorHalfWidth", "residualMad", "leverageMax")), "RegressionFlow geometry is invalid")
    mode_by_key = {}
    for value in [*_array(field.get("hlineModes"), "hlineModes"), *_array(field.get("trendModes"), "trendModes")]:
        mode = _record(value, "Field mode")
        key = (_digest(mode.get("fieldModeId"), "fieldModeId"), _digest(mode.get("derivationDigest"), "derivationDigest"))
        _need(key not in mode_by_key, "Field mode identity must be unique")
        mode_by_key[key] = mode
    refs = _array(field.get("selectedModeRefs"), "selectedModeRefs", 13)
    candidate_refs = {}
    for value in refs:
        ref = _record(value, "selectedModeRef")
        candidate_id = _digest(ref.get("candidateId"), "selectedModeRef.candidateId")
        _need(candidate_id not in candidate_refs, "selectedModeRef candidates must be unique")
        key = (_digest(ref.get("sourceFieldModeId"), "selectedModeRef.sourceFieldModeId"), _digest(ref.get("sourceFieldDerivationDigest"), "selectedModeRef.sourceFieldDerivationDigest"))
        _need(key in mode_by_key, "selectedModeRef points to a missing mode")
        _need(ref.get("formationDomainId") in domain_ids, "selectedModeRef formation domain is missing")
        _need(isinstance(ref.get("presentationSelected"), bool) and isinstance(ref.get("patternSupporting"), bool), "selectedModeRef usage flags are invalid")
        candidate_refs[candidate_id] = ref
    _need({key for key, ref in candidate_refs.items() if ref["presentationSelected"]} == set(boundaries), "Field presentation refs must equal selected boundaries")
    basis = _record(field.get("basisFacts"), "basisFacts")
    basis_count = len(_array(basis.get("basisIds"), "basisFacts.basisIds"))
    for key in ("roleCodes", "observedIndexes", "confirmedIndexes", "endpointPrices", "bodyEdgePrices", "corridorLows", "corridorHighs", "roleMasses", "participations", "effectiveScales"):
        _need(len(_array(basis.get(key), f"basisFacts.{key}")) == basis_count, "basisFacts columns are inconsistent")
    episodes = _record(field.get("derivationEpisodes"), "derivationEpisodes")
    episode_columns = ("candidateIndexes", "candidateEpisodeOrdinals", "contributionBasisIndexes", "memberBasisIndexes", "observedFromIndexes", "observedToIndexes", "confirmedIndexes", "contributionIndexes", "contributionPrices", "corridorLows", "corridorHighs", "initialFormationMasks")
    episode_count = len(_array(episodes.get("candidateIndexes"), "derivationEpisodes.candidateIndexes"))
    _need(all(len(_array(episodes.get(key), f"derivationEpisodes.{key}")) == episode_count for key in episode_columns), "derivationEpisodes columns are inconsistent")
    counts = [0] * len(refs); initial_counts = [0] * len(refs); fit_confirmed = [-1] * len(refs)
    for index, candidate_index in enumerate(episodes["candidateIndexes"]):
        _need(isinstance(candidate_index, int) and 0 <= candidate_index < len(refs), "derivation episode candidate is invalid")
        counts[candidate_index] += 1
        initial = episodes["initialFormationMasks"][index]
        _need(initial in {0, 1}, "initial formation mask is invalid")
        initial_counts[candidate_index] += initial
        confirmed = episodes["confirmedIndexes"][index]
        _need(isinstance(confirmed, int) and 0 <= confirmed < 240, "episode confirmation is invalid")
        fit_confirmed[candidate_index] = max(fit_confirmed[candidate_index], confirmed)
        contribution = episodes["contributionBasisIndexes"][index]
        members = episodes["memberBasisIndexes"][index]
        _need(isinstance(contribution, int) and 0 <= contribution < basis_count and isinstance(members, list) and contribution in members and all(isinstance(item, int) and 0 <= item < basis_count for item in members), "episode Basis closure is invalid")
    _need(all(count >= 2 and initial == 2 for count, initial in zip(counts, initial_counts)), "every candidate needs two initial formation episodes")
    for candidate_id, boundary in boundaries.items():
        ref_index = next(index for index, ref in enumerate(refs) if ref["candidateId"] == candidate_id)
        _need(boundary["formation"]["fitCount"] == counts[ref_index], "boundary fit count does not match Field episodes")
    for segment in _array(field.get("hlineResponseSegments"), "hlineResponseSegments"):
        item = _record(segment, "hlineResponseSegment")
        _need(item.get("windowFromTimestamp") == field.get("windowFromTimestamp") and item.get("windowToTimestamp") == field.get("windowToTimestamp"), "hlineResponseSegment window is inconsistent")
    timestamp_indexes = {value: index for index, value in enumerate(timestamps)}
    interaction_ids = set()
    for glyph in _array(field.get("validationGlyphs"), "validationGlyphs"):
        item = _record(glyph, "validationGlyph")
        candidate_index = item.get("candidateIndex")
        _need(isinstance(candidate_index, int) and 0 <= candidate_index < len(refs), "validation candidate is invalid")
        for key in ("corridorLow", "corridorHigh"):
            _need(key in item and (item[key] is None or _finite(item[key])), f"validationGlyph.{key} is invalid")
        observed_index = timestamp_indexes.get(item.get("observedAt"), -1)
        _need(observed_index >= 0, "validation timestamp is outside exact-240")
        if item.get("kind") == "interaction":
            _need(observed_index > fit_confirmed[candidate_index], "interaction must start after fit evidence")
            interaction_ids.add(_digest(item.get("interactionId"), "validation interactionId"))
    relation_glyphs = _array(field.get("patternRelationGlyphs"), "patternRelationGlyphs", 2)
    _need({item.get("relationId") for item in relation_glyphs} == set(relations), "Pattern Field closure is inconsistent")
    for glyph in relation_glyphs:
        relation_id = glyph.get("relationId")
        contact_count = _contact_sequence(
            glyph.get("contactSequence"), refs, counts, interaction_ids,
        )
        trace_indexes = _price_trace(glyph.get("priceTrace"))
        relation = relations[relation_id]
        _need(contact_count == relation["traceFactCount"], "Pattern contact count is inconsistent")
        _need(len(trace_indexes) == relation["traceAnchorCount"], "Pattern price trace count is inconsistent")
        domain = relation["domain"]
        _need(
            timestamps[trace_indexes[0]] == domain["fromTimestamp"]
            and timestamps[trace_indexes[-1]] == domain["toTimestamp"],
            "Pattern price trace domain is inconsistent",
        )
    evidence_glyphs = _array(field.get("patternEvidenceGlyphs"), "patternEvidenceGlyphs", 1)
    evidence_ids = set()
    evidence_candidate_ids = set()
    for glyph in evidence_glyphs:
        item = _record(glyph, "patternEvidenceGlyph")
        evidence_id = _digest(item.get("evidenceId"), "patternEvidenceGlyph.evidenceId")
        _need(evidence_id not in evidence_ids, "Pattern evidence IDs must be unique")
        evidence_ids.add(evidence_id)
        _need(item.get("kind") in {"trend_pair", "price_memory_pair", "mixed_triangle_pair"}, "Pattern evidence kind is invalid")
        boundary_ids = _array(item.get("boundaryCandidateIds"), "patternEvidenceGlyph.boundaryCandidateIds")
        _need(len(boundary_ids) == 2 and len(set(boundary_ids)) == 2, "Pattern evidence needs two boundaries")
        _need(all(candidate_id in candidate_refs for candidate_id in boundary_ids), "Pattern evidence boundary is missing")
        evidence_candidate_ids.update(boundary_ids)
        _contact_sequence(item.get("contactSequence"), refs, counts, interaction_ids)
    relation_candidate_ids = {candidate_id for relation in relations.values() for candidate_id in relation["boundaryCandidateIds"]}
    _need(
        {key for key, ref in candidate_refs.items() if ref["patternSupporting"]}
        == relation_candidate_ids | evidence_candidate_ids,
        "Field Pattern refs are inconsistent",
    )
    _need(isinstance(field.get("priceMemoryRidges"), list) and field["priceMemoryRidges"], "PriceMemory Field is missing")
    return candidate_refs


def _contact_sequence(value, refs, counts, interaction_ids):
    trace = _record(value, "pattern contact sequence")
    columns = ("indexes", "prices", "roles", "sourceCodes", "episodeRefs", "interactionIds")
    lengths = [len(_array(trace.get(key), f"pattern contact {key}")) for key in columns]
    _need(len(set(lengths)) == 1 and 3 <= lengths[0] <= 16, "Pattern contact columns are inconsistent")
    _need(all(isinstance(index, int) and 0 <= index < 240 for index in trace["indexes"]), "Pattern contact index is invalid")
    _need(all(first < second for first, second in zip(trace["indexes"], trace["indexes"][1:])), "Pattern contact sequence is not chronological")
    _need(all(_finite(price) for price in trace["prices"]), "Pattern contact price is invalid")
    _need(
        all(role in {"support", "resistance", "lower", "upper"} for role in trace["roles"]),
        "Pattern contact role is invalid",
    )
    _need(
        all(first != second for first, second in zip(trace["roles"], trace["roles"][1:])),
        "Pattern contact roles must alternate",
    )
    seen = set()
    for code, episode_ref, interaction_id in zip(
        trace["sourceCodes"], trace["episodeRefs"], trace["interactionIds"], strict=True,
    ):
        _need(code in {0, 1}, "Pattern contact source code is invalid")
        if code == 0:
            _need(
                isinstance(episode_ref, list) and len(episode_ref) == 2
                and isinstance(episode_ref[0], int) and 0 <= episode_ref[0] < len(refs)
                and isinstance(episode_ref[1], int) and 0 <= episode_ref[1] < counts[episode_ref[0]],
                "Pattern episode reference is invalid",
            )
            _need(interaction_id is None, "Formation contact has an interaction reference")
            source = ("formation", *episode_ref)
        else:
            _need(episode_ref is None, "Interaction contact has an episode reference")
            source = ("interaction", _digest(interaction_id, "Pattern interaction reference"))
            _need(source[1] in interaction_ids, "Pattern interaction reference is missing")
        _need(source not in seen, "Pattern contact reference must be unique")
        seen.add(source)
    return lengths[0]


def _price_trace(value):
    trace = _record(value, "pattern price trace")
    _need(trace.get("method") == "close-rdp-atr-v1", "Pattern price trace method is incompatible")
    indexes = _array(trace.get("indexes"), "pattern price trace indexes")
    prices = _array(trace.get("prices"), "pattern price trace prices")
    _need(len(indexes) == len(prices) and 3 <= len(indexes) <= 16, "Pattern price trace columns are inconsistent")
    _need(all(isinstance(index, int) and 0 <= index < 240 for index in indexes), "Pattern price trace index is invalid")
    _need(all(first < second for first, second in zip(indexes, indexes[1:])), "Pattern price trace is not chronological")
    _need(all(_finite(price) for price in prices), "Pattern price trace price is invalid")
    return indexes


def _drawings(values, boundaries, candidate_refs, relations, field, interval, inference_id, as_of):
    ids = set(); counts = {"hline": 0, "trend": 0, "pattern": 0}; seen_candidates = set(); seen_relations = set()
    for index, value in enumerate(values):
        path = f"drawings[{index}]"; item = _record(value, path)
        drawing_id = _text(item.get("id"), f"{path}.id")
        _need(drawing_id.startswith("czardas:") and drawing_id not in ids, "drawing ID is invalid"); ids.add(drawing_id)
        _need(item.get("sourceInterval") == interval, f"{path} interval is inconsistent")
        _need(item.get("ownership") == "czardas-managed" and item.get("createdBy") == "system", f"{path} ownership is invalid")
        _need(item.get("sourceInferenceId") == inference_id, f"{path} inference is inconsistent")
        layer = item.get("czardasLayer"); _need(layer in counts, f"{path}.czardasLayer is invalid"); counts[layer] += 1
        anchors = _array(item.get("anchors"), f"{path}.anchors")
        _need((len(anchors) == 2) if layer != "pattern" else (3 <= len(anchors) <= 16), f"{path} anchor count is invalid")
        anchor_times = [_not_after(_record(anchor, "anchor").get("timestamp"), as_of, "anchor.timestamp") for anchor in anchors]
        _need(all(first < second for first, second in zip(anchor_times, anchor_times[1:])), f"{path} anchors are not chronological")
        _need(all(_finite(_record(anchor, "anchor").get("price")) for anchor in anchors), f"{path} anchor price is invalid")
        if layer == "pattern":
            relation_id = _digest(item.get("sourceRelationId"), f"{path}.sourceRelationId")
            _need(relation_id in relations and relation_id not in seen_relations, f"{path} relation is invalid"); seen_relations.add(relation_id)
            _need(item.get("type") == "polyline" and item.get("style", {}).get("extension") == "none", f"{path} must be an open polyline")
            glyph = next(value for value in field["patternRelationGlyphs"] if value["relationId"] == relation_id)
            expected = [
                (field["candleMeanings"]["timestamps"][index], price)
                for index, price in zip(glyph["priceTrace"]["indexes"], glyph["priceTrace"]["prices"])
            ]
            _need([(anchor["timestamp"], anchor["price"]) for anchor in anchors] == expected, f"{path} does not match PatternTrace")
        else:
            candidate_id = _digest(item.get("sourceCandidateId"), f"{path}.sourceCandidateId")
            _need(candidate_id in boundaries and candidate_id not in seen_candidates, f"{path} candidate is invalid"); seen_candidates.add(candidate_id)
            _need(boundaries[candidate_id]["kind"] == layer, f"{path} layer is inconsistent")
            ref = candidate_refs[candidate_id]
            _need(item.get("sourceFieldModeId") == ref.get("sourceFieldModeId") and item.get("sourceFieldDerivationDigest") == ref.get("sourceFieldDerivationDigest"), f"{path} provenance is inconsistent")
        _need(item.get("createdAt") == pack_timestamp(as_of) and item.get("updatedAt") == pack_timestamp(as_of), f"{path} timestamps must equal asOf")
    _need(seen_candidates == set(boundaries), "drawings do not cover selected boundaries")
    _need(seen_relations == set(relations), "drawings do not cover detected Patterns")
    return counts


def _selection(selection, counts):
    _need(set(selection) == {"hline", "trend", "pattern"}, "selection channels are incompatible")
    limits = {"hline": (1, 4), "trend": (0, 3), "pattern": (0, 2)}
    for key, (minimum, maximum) in limits.items():
        item = _record(selection.get(key), f"selection.{key}")
        _need(item.get("actualCount") == counts[key] and minimum <= counts[key] <= maximum, f"selection.{key} is inconsistent")


def pack_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _size(value): return len(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode())
def _need(condition, message):
    if not condition: raise V5ContractError(message)
def _record(value, path): _need(isinstance(value, dict), f"{path} must be an object"); return value
def _array(value, path, maximum=None):
    _need(isinstance(value, list), f"{path} must be an array")
    if maximum is not None: _need(len(value) <= maximum, f"{path} has too many items")
    return value
def _text(value, path): _need(isinstance(value, str) and value, f"{path} must be text"); return value
def _digest(value, path): value = _text(value, path); _need(bool(_DIGEST.fullmatch(value)), f"{path} must be sha256"); return value
def _finite(value): return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and abs(value) != float("inf")
def _timestamp(value, path):
    value = _text(value, path); _need(value.endswith("Z"), f"{path} must be UTC Z")
    try: return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc: raise V5ContractError(f"{path} is invalid") from exc
def _not_after(value, limit, path): result = _timestamp(value, path); _need(result <= limit, f"{path} is after asOf"); return result
def _reject_historical(value):
    if isinstance(value, dict):
        _need(not (_HISTORICAL & set(value)), "historical revision fields are forbidden")
        for item in value.values(): _reject_historical(item)
    elif isinstance(value, list):
        for item in value: _reject_historical(item)
