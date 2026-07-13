from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import re
import struct
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

from alfaka.analytics.czardas import DEFAULT_CONFIG
from alfaka.analytics.czardas.data import SUPPORTED_INTERVALS
from alfaka.analytics.czardas.numeric import canonical_digest


FIELD_SCHEMA_VERSION = 2
TARGET_BARS = 240
MAX_DRAWINGS = 7
MAX_HLINES = 4
MAX_TRENDS = 3
MAX_FIELD_BYTES = 80 * 1024
MAX_PACK_BYTES = 96 * 1024
RAW_FACTOR_SCALE = 1000

FACTOR_KEYS = frozenset({
    "rangeAtr",
    "absoluteReturnAtr",
    "bodyFraction",
    "lowerWickFraction",
    "upperWickFraction",
    "volumeRank",
    "volumeZ",
    "participation",
    "localHighR2",
    "localLowR2",
    "localHighR5",
    "localLowR5",
    "localHighR13",
    "localLowR13",
    "supportProximity",
    "resistanceProximity",
    "lowerResidualAtr",
    "upperResidualAtr",
    "hlinePenetrationAtr",
    "trendPenetrationAtr",
    "reclaimStrength",
})

LOG1P_FACTOR_KEYS = frozenset({
    "rangeAtr",
    "absoluteReturnAtr",
    "lowerResidualAtr",
    "upperResidualAtr",
    "hlinePenetrationAtr",
    "trendPenetrationAtr",
})

HISTORICAL_KEYS = frozenset({
    "fieldRevision",
    "modelRevision",
    "sourceFieldRevision",
    "engineRevision",
    "lineageFormedAt",
    "revisionFormedAt",
    "firstSeenAt",
    "replayLineageCap",
    "replay_lineage_cap",
    "originFieldModeId",
    "roleMassAtRevision",
    "verificationCount",
    "verification",
    "lifecycle",
})

TOP_LEVEL_KEYS = frozenset({
    "algorithmVersion",
    "configVersion",
    "timeContractVersion",
    "calendarVersion",
    "inferenceId",
    "symbol",
    "interval",
    "asOf",
    "lastCandleKey",
    "inputDigest",
    "status",
    "coverage",
    "selection",
    "boundaries",
    "presentationPattern",
    "drawings",
    "czardasField",
    "rejectSummary",
})

_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")


class CzardasPackValidationError(ValueError):
    """The deterministic Czardas pack does not satisfy the v2 wire contract."""


def validate_czardas_pack(
    pack: Any,
    *,
    expected_symbol: str | None = None,
    expected_interval: str | None = None,
) -> dict[str, Any]:
    """Validate the authoritative persisted/delivered Czardas v2 wire shape.

    This validator is deliberately dependency-free so the worker and API can
    apply exactly the same checks. It returns the original mapping after a
    successful validation and raises ``CzardasPackValidationError`` otherwise.
    """

    root = _record(pack, "pack")
    _require(set(root) == TOP_LEVEL_KEYS, "pack has missing or unknown top-level keys")
    _reject_historical_keys(root)
    _require("generatedAt" not in root, "generatedAt belongs to the DB/API envelope")

    _require(root.get("algorithmVersion") == DEFAULT_CONFIG.algorithm_version, "algorithmVersion is incompatible")
    _require(root.get("configVersion") == DEFAULT_CONFIG.config_version, "configVersion is incompatible")
    _require(root.get("timeContractVersion") == DEFAULT_CONFIG.time_contract_version, "timeContractVersion is incompatible")
    _require(root.get("calendarVersion") == DEFAULT_CONFIG.calendar_version, "calendarVersion is incompatible")

    symbol = _nonempty(root.get("symbol"), "symbol").upper()
    interval = _nonempty(root.get("interval"), "interval")
    _require(root.get("symbol") == symbol, "symbol must be canonical uppercase")
    _require(interval in SUPPORTED_INTERVALS, "interval is unsupported")
    if expected_symbol is not None:
        _require(symbol == str(expected_symbol).strip().upper(), "pack symbol does not match its storage/API scope")
    if expected_interval is not None:
        _require(interval == str(expected_interval).strip(), "pack interval does not match its storage/API scope")

    as_of = _timestamp(root.get("asOf"), "asOf")
    as_of_text = str(root["asOf"])
    last_candle_key = _nonempty(root.get("lastCandleKey"), "lastCandleKey")
    input_digest = _digest(root.get("inputDigest"), "inputDigest")
    inference_id = _digest(root.get("inferenceId"), "inferenceId")
    expected_inference_id = canonical_digest([
        root["algorithmVersion"],
        root["configVersion"],
        root["timeContractVersion"],
        root["calendarVersion"],
        symbol,
        interval,
        as_of_text,
        input_digest,
    ])
    _require(inference_id == expected_inference_id, "inferenceId does not match the snapshot identity")
    _require(root.get("status") == "ready", "pack status must be ready")

    coverage = _record(root.get("coverage"), "coverage")
    _require(coverage.get("state") == "exact", "coverage state must be exact")
    for key in ("targetCompleted", "actualCompleted", "analysisBars"):
        _require(_integer(coverage.get(key), f"coverage.{key}") == TARGET_BARS, f"coverage.{key} must be 240")
    _require(isinstance(coverage.get("qualityFlags"), list), "coverage.qualityFlags must be an array")

    boundaries = _array(root.get("boundaries"), "boundaries", maximum=MAX_DRAWINGS)
    drawings = _array(root.get("drawings"), "drawings", maximum=MAX_DRAWINGS)
    selection = _record(root.get("selection"), "selection")
    boundary_by_id = _validate_boundaries(boundaries, inference_id, as_of)
    drawing_by_candidate = _validate_drawings(
        drawings, boundary_by_id, symbol, interval, inference_id, as_of, as_of_text
    )
    _require(set(boundary_by_id) == set(drawing_by_candidate), "boundaries and drawings must have the same candidate IDs")
    _validate_selection(selection, drawings)

    field = _record(root.get("czardasField"), "czardasField")
    _validate_field(field, root, boundary_by_id, inference_id, as_of, last_candle_key)
    _validate_pattern(root.get("presentationPattern"), drawings, field.get("relationGlyph"))
    _require(isinstance(root.get("rejectSummary"), dict), "rejectSummary must be an object")
    _require(_canonical_size(field) <= MAX_FIELD_BYTES, "Czardas Field exceeds 80 KiB")
    _require(_canonical_size(root) <= MAX_PACK_BYTES, "Czardas pack exceeds 96 KiB")
    return root


def is_valid_czardas_pack(
    pack: Any,
    *,
    expected_symbol: str | None = None,
    expected_interval: str | None = None,
) -> bool:
    try:
        validate_czardas_pack(pack, expected_symbol=expected_symbol, expected_interval=expected_interval)
    except (CzardasPackValidationError, TypeError, ValueError):
        return False
    return True


def canonical_pack_json(pack: Mapping[str, Any]) -> str:
    return json.dumps(pack, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def canonical_pack_digest(pack: Mapping[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(canonical_pack_json(pack).encode("utf-8")).hexdigest()


def _validate_boundaries(values: list[Any], inference_id: str, as_of: datetime) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for index, value in enumerate(values):
        path = f"boundaries[{index}]"
        item = _record(value, path)
        candidate_id = _nonempty(item.get("candidateId"), f"{path}.candidateId")
        _require(candidate_id not in result, "boundary candidate IDs must be unique")
        _require(item.get("sourceInferenceId") == inference_id, f"{path}.sourceInferenceId is inconsistent")
        _digest(item.get("sourceFieldModeId"), f"{path}.sourceFieldModeId")
        _digest(item.get("sourceFieldDerivationDigest"), f"{path}.sourceFieldDerivationDigest")
        kind = item.get("kind")
        role = item.get("role")
        _require(kind in {"hline", "trend"}, f"{path}.kind is invalid")
        _require(
            role in ({"support", "resistance"} if kind == "hline" else {"lower", "upper"}),
            f"{path}.role does not match kind",
        )
        _require(item.get("evidenceState") in {"formed", "response_supported"}, f"{path}.evidenceState is invalid")
        _require(type(item.get("isRelevantNow")) is bool, f"{path}.isRelevantNow must be boolean")

        formation = _record(item.get("formation"), f"{path}.formation")
        initial = _string_array(formation.get("initialFormationEpisodeIds"), f"{path}.formation.initialFormationEpisodeIds")
        fit = _string_array(formation.get("fitEpisodeIds"), f"{path}.formation.fitEpisodeIds")
        _require(len(initial) == 2 and len(set(initial)) == 2, f"{path} must have two canonical initial episodes")
        _require(len(fit) == len(set(fit)), f"{path} fit episode IDs must be unique")
        _require(set(initial).issubset(fit), f"{path} initial episodes must be fit episodes")
        _require(_integer(formation.get("fitCount"), f"{path}.formation.fitCount") == len(fit), f"{path}.formation.fitCount is inconsistent")
        _time_not_after(formation.get("lastFitObservedAt"), as_of, f"{path}.formation.lastFitObservedAt")
        _time_not_after(formation.get("fitEvidenceConfirmedAt"), as_of, f"{path}.formation.fitEvidenceConfirmedAt")
        _finite(formation.get("seedQuality"), f"{path}.formation.seedQuality")

        responses = _record(item.get("responses"), f"{path}.responses")
        for key in ("completedCount", "pendingCount"):
            _require(_integer(responses.get(key), f"{path}.responses.{key}") >= 0, f"{path}.responses.{key} must be non-negative")
        _require(_finite(responses.get("responseMass"), f"{path}.responses.responseMass") >= 0, f"{path}.responses.responseMass must be non-negative")
        if responses.get("lastInteractionAt") is not None:
            _time_not_after(responses.get("lastInteractionAt"), as_of, f"{path}.responses.lastInteractionAt")

        line = _record(item.get("line"), f"{path}.line")
        for key in ("slopePerBar", "interceptAtOrigin", "priceAtAsOf", "zoneHalfWidth"):
            _finite(line.get(key), f"{path}.line.{key}")
        _require(_finite(line.get("zoneHalfWidth"), f"{path}.line.zoneHalfWidth") >= 0, f"{path}.line.zoneHalfWidth must be non-negative")
        _nonempty(line.get("indexOriginCandleKey"), f"{path}.line.indexOriginCandleKey")
        _require(line.get("priceSpace") == "linear", f"{path}.line.priceSpace must be linear")

        rank = _record(item.get("rank"), f"{path}.rank")
        for key in ("rankScore", "seedQuality", "integrity", "persistence", "responseMass", "responseBonus", "profileBonus"):
            _finite(rank.get(key), f"{path}.rank.{key}")
        _require(_integer(rank.get("responseCount"), f"{path}.rank.responseCount") >= 0, f"{path}.rank.responseCount must be non-negative")
        explanation = _record(item.get("explanation"), f"{path}.explanation")
        _nonempty(explanation.get("claim"), f"{path}.explanation.claim")
        _string_array(explanation.get("because"), f"{path}.explanation.because", allow_empty=True)
        _string_array(explanation.get("against"), f"{path}.explanation.against", allow_empty=True)
        _require(explanation.get("state") == item.get("evidenceState"), f"{path}.explanation.state is inconsistent")
        result[candidate_id] = item
    return result


def _validate_drawings(
    values: list[Any],
    boundaries: dict[str, dict[str, Any]],
    symbol: str,
    interval: str,
    inference_id: str,
    as_of: datetime,
    as_of_text: str,
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    ids: set[str] = set()
    hlines = trends = 0
    for index, value in enumerate(values):
        path = f"drawings[{index}]"
        item = _record(value, path)
        drawing_id = _nonempty(item.get("id"), f"{path}.id")
        _require(drawing_id not in ids and drawing_id.startswith("czardas:"), "drawing IDs must be unique Czardas IDs")
        ids.add(drawing_id)
        candidate_id = _nonempty(item.get("sourceCandidateId"), f"{path}.sourceCandidateId")
        _require(candidate_id in boundaries and candidate_id not in result, "each drawing must reference one unique boundary")
        boundary = boundaries[candidate_id]
        layer = item.get("czardasLayer")
        _require(layer == boundary.get("kind"), f"{path}.czardasLayer is inconsistent")
        hlines += layer == "hline"
        trends += layer == "trend"
        expected_type = "horizontalLine" if layer == "hline" else "trendLine"
        expected_extension = "line" if layer == "hline" else "ray"
        _require(item.get("type") == expected_type, f"{path}.type is inconsistent")
        _require(item.get("symbol") == symbol and item.get("interval") == interval, f"{path} identity is inconsistent")
        _require(item.get("sourceInterval") == interval, f"{path}.sourceInterval is inconsistent")
        _require(item.get("ownership") == "czardas-managed" and item.get("createdBy") == "system", f"{path} must be system managed")
        _require(item.get("sourceInferenceId") == inference_id, f"{path}.sourceInferenceId is inconsistent")
        _require(item.get("sourceFieldModeId") == boundary.get("sourceFieldModeId"), f"{path}.sourceFieldModeId is inconsistent")
        _require(item.get("sourceFieldDerivationDigest") == boundary.get("sourceFieldDerivationDigest"), f"{path}.sourceFieldDerivationDigest is inconsistent")
        anchors = _array(item.get("anchors"), f"{path}.anchors")
        _require(len(anchors) == 2, f"{path} must have two anchors")
        anchor_times: list[datetime] = []
        for anchor_index, anchor_value in enumerate(anchors):
            anchor = _record(anchor_value, f"{path}.anchors[{anchor_index}]")
            anchor_times.append(_time_not_after(
                anchor.get("timestamp"), as_of, f"{path}.anchors[{anchor_index}].timestamp"
            ))
            _finite(anchor.get("price"), f"{path}.anchors[{anchor_index}].price")
        _require(anchor_times[0] <= anchor_times[1], f"{path} anchors must be chronological")
        style = _record(item.get("style"), f"{path}.style")
        _require(_integer(style.get("lineWidth"), f"{path}.style.lineWidth") in {1, 2, 3}, f"{path}.style.lineWidth is invalid")
        _require(style.get("extension") == expected_extension, f"{path}.style.extension is inconsistent")
        _require(item.get("visible") is True, f"{path}.visible must be true")
        _require(
            item.get("createdAt") == as_of_text and item.get("updatedAt") == as_of_text,
            f"{path} timestamps must equal asOf",
        )
        result[candidate_id] = item
    _require(hlines <= MAX_HLINES and trends <= MAX_TRENDS, "Czardas drawing layer limit exceeded")
    return result


def _validate_selection(selection: dict[str, Any], drawings: list[Any]) -> None:
    actual = {
        "hline": sum(_record(item, "drawing").get("czardasLayer") == "hline" for item in drawings),
        "trend": sum(_record(item, "drawing").get("czardasLayer") == "trend" for item in drawings),
    }
    limits = {"hline": (1, MAX_HLINES), "trend": (1, MAX_TRENDS)}
    for key in ("hline", "trend"):
        item = _record(selection.get(key), f"selection.{key}")
        configured = _integer(item.get("configuredCount"), f"selection.{key}.configuredCount")
        _require(limits[key][0] <= configured <= limits[key][1], f"selection.{key}.configuredCount is invalid")
        _require(_integer(item.get("actualCount"), f"selection.{key}.actualCount") == actual[key], f"selection.{key}.actualCount is inconsistent")


def _validate_field(
    field: dict[str, Any],
    pack: dict[str, Any],
    boundaries: dict[str, dict[str, Any]],
    inference_id: str,
    as_of: datetime,
    last_candle_key: str,
) -> None:
    _require(_integer(field.get("schemaVersion"), "czardasField.schemaVersion") == FIELD_SCHEMA_VERSION, "Field schema is incompatible")
    _require(_integer(field.get("sourceBars"), "czardasField.sourceBars") == TARGET_BARS, "Field sourceBars must be 240")
    _require(field.get("evaluationAsOf") == pack.get("asOf"), "Field evaluationAsOf is inconsistent")
    _require(field.get("sourceInferenceId") == inference_id, "Field sourceInferenceId is inconsistent")
    window_from = _timestamp(field.get("windowFromTimestamp"), "czardasField.windowFromTimestamp")
    window_to = _timestamp(field.get("windowToTimestamp"), "czardasField.windowToTimestamp")
    _require(window_from <= window_to == as_of, "Field window must end at asOf")
    for drawing_index, drawing_value in enumerate(pack["drawings"]):
        drawing = _record(drawing_value, f"drawings[{drawing_index}]")
        for anchor_index, anchor_value in enumerate(drawing["anchors"]):
            anchor = _record(anchor_value, f"drawings[{drawing_index}].anchors[{anchor_index}]")
            anchor_time = _timestamp(anchor.get("timestamp"), f"drawings[{drawing_index}].anchors[{anchor_index}].timestamp")
            _require(window_from <= anchor_time <= window_to, "drawing anchor is outside the exact-240 window")
    _validate_meanings(_record(field.get("candleMeanings"), "czardasField.candleMeanings"), pack, window_from, window_to, last_candle_key)

    basis_facts = _validate_basis_facts(_record(field.get("basisFacts"), "czardasField.basisFacts"))
    _validate_basis_glyphs(_array(field.get("basisGlyphs"), "czardasField.basisGlyphs"), window_from, window_to)
    mode_by_key: dict[tuple[str, str], tuple[dict[str, Any], str]] = {}
    for key, roles in (("hlineModes", {"support", "resistance"}), ("trendModes", {"lower", "upper"})):
        for index, mode_value in enumerate(_array(field.get(key), f"czardasField.{key}")):
            mode = _record(mode_value, f"czardasField.{key}[{index}]")
            mode_id = _digest(mode.get("fieldModeId"), f"czardasField.{key}[{index}].fieldModeId")
            derivation = _digest(mode.get("derivationDigest"), f"czardasField.{key}[{index}].derivationDigest")
            mode_key = (mode_id, derivation)
            _require(mode_key not in mode_by_key, "Field mode identity must be unique")
            _require(mode.get("role") in roles, "Field mode role is inconsistent")
            origin_seed_ids = _string_array(mode.get("originSeedBasisIds"), f"czardasField.{key}[{index}].originSeedBasisIds")
            _require(len(origin_seed_ids) == 2 and len(set(origin_seed_ids)) == 2, "Field mode must identify two canonical origin seeds")
            for seed_index, seed_id in enumerate(origin_seed_ids):
                _digest(seed_id, f"czardasField.{key}[{index}].originSeedBasisIds[{seed_index}]")
            if key == "hlineModes":
                _require(mode.get("windowFromTimestamp") == field.get("windowFromTimestamp"), "H-Line mode windowFrom is inconsistent")
                _require(mode.get("windowToTimestamp") == field.get("windowToTimestamp"), "H-Line mode windowTo is inconsistent")
                for name in ("centerPrice", "zoneHalfWidth", "supportMass", "oppositionMass"):
                    _finite(mode.get(name), f"czardasField.{key}[{index}].{name}")
            else:
                for name in ("hypothesisMedoid", "boundaryEstimate"):
                    _validate_timestamp_price_line(_record(mode.get(name), f"czardasField.{key}[{index}].{name}"), window_from, window_to)
                ribbon = _record(mode.get("ribbon"), f"czardasField.{key}[{index}].ribbon")
                _require(_timestamp(ribbon.get("fromTimestamp"), "ribbon.fromTimestamp") >= window_from, "Trend ribbon starts before Field")
                _require(_timestamp(ribbon.get("toTimestamp"), "ribbon.toTimestamp") <= window_to, "Trend ribbon ends after Field")
                for name in ("lowerFromPrice", "upperFromPrice", "lowerToPrice", "upperToPrice"):
                    _finite(ribbon.get(name), f"ribbon.{name}")
            mode_by_key[mode_key] = (mode, "hline" if key == "hlineModes" else "trend")

    selected_refs = _array(field.get("selectedModeRefs"), "czardasField.selectedModeRefs")
    _require(len(selected_refs) == len(boundaries), "selectedModeRefs must cover every boundary")
    selected_candidates: set[str] = set()
    ordered_candidates: list[str] = []
    for index, ref_value in enumerate(selected_refs):
        path = f"czardasField.selectedModeRefs[{index}]"
        ref = _record(ref_value, path)
        candidate_id = _nonempty(ref.get("candidateId"), f"{path}.candidateId")
        _require(candidate_id in boundaries and candidate_id not in selected_candidates, "selectedModeRefs candidate is invalid")
        selected_candidates.add(candidate_id)
        ordered_candidates.append(candidate_id)
        boundary = boundaries[candidate_id]
        _require(ref.get("sourceInferenceId") == inference_id, f"{path}.sourceInferenceId is inconsistent")
        mode_key = (ref.get("sourceFieldModeId"), ref.get("sourceFieldDerivationDigest"))
        _require(mode_key in mode_by_key, f"{path} references an omitted mode")
        _require(mode_key == (boundary.get("sourceFieldModeId"), boundary.get("sourceFieldDerivationDigest")), f"{path} is inconsistent with boundary")
        _require(ref.get("kind") == boundary.get("kind"), f"{path}.kind is inconsistent")
        selected_mode, detector_kind = mode_by_key[mode_key]
        _require(detector_kind == boundary.get("kind"), f"{path} detector kind is inconsistent")
        _require(selected_mode.get("role") == boundary.get("role"), f"{path} role is inconsistent")
        _require(selected_mode.get("viewRole") == "landscape_and_selected", f"{path} mode is not marked selected")
        contributor_indexes = _array(selected_mode.get("contributorBasisIndexes"), f"{path}.contributorBasisIndexes")
        contributor_count = _integer(selected_mode.get("contributorCount"), f"{path}.contributorCount")
        _require(len(contributor_indexes) == contributor_count, f"{path} contributor count is inconsistent")
        _require(len(set(contributor_indexes)) == contributor_count, f"{path} contributor Basis indexes must be unique")
        _require(
            all(type(value) is int and 0 <= value < basis_facts["count"] for value in contributor_indexes),
            f"{path} contributor Basis index is invalid",
        )
        expected_role_code = {"support": 0, "resistance": 1, "lower": 2, "upper": 3}[boundary["role"]]
        _require(
            all(basis_facts["role_codes"][value] == expected_role_code for value in contributor_indexes),
            f"{path} contributor Basis role is inconsistent",
        )

    episode_facts = _validate_derivation_episodes(
        _record(field.get("derivationEpisodes"), "czardasField.derivationEpisodes"),
        basis_facts,
        ordered_candidates,
        boundaries,
    )
    _validate_validation_glyphs(
        _array(field.get("validationGlyphs"), "czardasField.validationGlyphs"),
        boundaries,
        ordered_candidates,
        episode_facts,
        _string_array(field["candleMeanings"].get("timestamps"), "candleMeanings.timestamps"),
        as_of,
    )
    _validate_hline_response_segments(
        _array(field.get("hlineResponseSegments"), "czardasField.hlineResponseSegments", maximum=96),
        field.get("windowFromTimestamp"),
        field.get("windowToTimestamp"),
    )
    _validate_hline_profile_bins(_array(field.get("hlineProfileBins"), "czardasField.hlineProfileBins", maximum=48))
    projection = _record(field.get("projection"), "czardasField.projection")
    _require(type(projection.get("truncated")) is bool, "Field projection.truncated must be boolean")


def _validate_meanings(meanings: dict[str, Any], pack: dict[str, Any], window_from: datetime, window_to: datetime, last_key: str) -> None:
    _require(meanings.get("evaluationAsOf") == pack.get("asOf"), "CandleMeaning evaluationAsOf is inconsistent")
    normalized_scale = _positive_integer(meanings.get("normalizedFactorScale"), "candleMeanings.normalizedFactorScale")
    score_scale = _positive_integer(meanings.get("scoreScale"), "candleMeanings.scoreScale")
    _require(normalized_scale == RAW_FACTOR_SCALE, "candleMeanings.normalizedFactorScale is incompatible")
    _require(score_scale == RAW_FACTOR_SCALE, "candleMeanings.scoreScale is incompatible")

    candle_keys = _string_array(meanings.get("candleKeys"), "candleMeanings.candleKeys")
    timestamps = _string_array(meanings.get("timestamps"), "candleMeanings.timestamps")
    _require(len(candle_keys) == len(timestamps) == TARGET_BARS, "CandleMeaning must contain exact-240 identities")
    _require(len(set(candle_keys)) == TARGET_BARS, "CandleMeaning candle keys must be unique")
    parsed = [_timestamp(value, f"candleMeanings.timestamps[{index}]") for index, value in enumerate(timestamps)]
    _require(all(left < right for left, right in zip(parsed, parsed[1:])), "CandleMeaning timestamps must be strictly increasing")
    _require(parsed[0] == window_from and parsed[-1] == window_to, "CandleMeaning timestamps must span the Field window")
    _require(candle_keys[-1] == last_key, "CandleMeaning last key is inconsistent")

    summaries = _record(meanings.get("summaries"), "candleMeanings.summaries")
    _require(set(summaries) == {"shared", "hline", "trend", "compositePercentile"}, "CandleMeaning summaries are invalid")
    roles = _record(meanings.get("roles"), "candleMeanings.roles")
    _require(set(roles) == {"support", "resistance", "lower", "upper"}, "CandleMeaning roles are invalid")
    for name, values in (*summaries.items(), *roles.items()):
        _scaled_series(values, TARGET_BARS, score_scale, f"candleMeanings.{name}")

    factors = _record(meanings.get("factors"), "candleMeanings.factors")
    normalized = _record(meanings.get("normalizedFactors"), "candleMeanings.normalizedFactors")
    scales = _record(meanings.get("rawFactorScales"), "candleMeanings.rawFactorScales")
    transforms = _record(meanings.get("rawFactorTransforms"), "candleMeanings.rawFactorTransforms")
    ranges = _record(meanings.get("rawFactorRanges"), "candleMeanings.rawFactorRanges")
    _require(set(factors) == set(normalized) == set(scales) == set(transforms) == FACTOR_KEYS, "CandleMeaning factor keys are incompatible")
    _require(set(ranges) == FACTOR_KEYS, "CandleMeaning rawFactorRanges keys are incompatible")
    raw_encoding = meanings.get("rawFactorEncoding")
    normalized_encoding = meanings.get("normalizedFactorEncoding")
    _require(raw_encoding == normalized_encoding == "int16-base64-be", "CandleMeaning factor encodings are incompatible")
    raw_sentinel = _integer(meanings.get("rawFactorNullSentinel"), "candleMeanings.rawFactorNullSentinel")
    normalized_sentinel = _integer(meanings.get("normalizedFactorNullSentinel"), "candleMeanings.normalizedFactorNullSentinel")
    _require(raw_sentinel == normalized_sentinel == -32768, "CandleMeaning factor null sentinel is incompatible")
    _require(meanings.get("rawFactorOverflowPolicy") == "reject", "rawFactorOverflowPolicy must be reject")
    for key in sorted(FACTOR_KEYS):
        scale = _positive_integer(scales.get(key), f"rawFactorScales.{key}")
        _require(scale == RAW_FACTOR_SCALE, f"rawFactorScales.{key} is incompatible")
        factor_range = _array(ranges.get(key), f"rawFactorRanges.{key}")
        _require(len(factor_range) == 2, f"rawFactorRanges.{key} must have two bounds")
        low = _finite(factor_range[0], f"rawFactorRanges.{key}[0]")
        high = _finite(factor_range[1], f"rawFactorRanges.{key}[1]")
        expected_transform = "log1p" if key in LOG1P_FACTOR_KEYS else "linear"
        _require(transforms.get(key) == expected_transform, f"rawFactorTransforms.{key} is incompatible")
        expected_range = (0.0, math.expm1(32767 / scale)) if expected_transform == "log1p" else (-32767 / scale, 32767 / scale)
        _require((low, high) == expected_range, f"rawFactorRanges.{key} is inconsistent with its scale and transform")
        _decode_factor_series(factors.get(key), raw_encoding, raw_sentinel, None, f"factors.{key}")
        _decode_factor_series(normalized.get(key), normalized_encoding, normalized_sentinel, normalized_scale, f"normalizedFactors.{key}")

    for key, codebook_key in (("availabilityMasks", "availabilityCodebook"), ("phaseMasks", "phaseCodebook")):
        values = _array(meanings.get(key), f"candleMeanings.{key}")
        _require(len(values) == TARGET_BARS, f"{key} must have 240 entries")
        _require(all(type(value) is int and value >= 0 for value in values), f"{key} must contain non-negative integers")
        codebook = _record(meanings.get(codebook_key), f"candleMeanings.{codebook_key}")
        bits = list(codebook.values())
        _require(codebook and all(type(value) is int and value > 0 and value & (value - 1) == 0 for value in bits), f"{codebook_key} must contain bit flags")
        _require(len(set(bits)) == len(bits), f"{codebook_key} bit flags must be unique")
        allowed_mask = sum(bits)
        _require(all(value & ~allowed_mask == 0 for value in values), f"{key} contains an unknown bit")

    reasons = _array(meanings.get("reasonCodebook"), "candleMeanings.reasonCodebook")
    codes: set[int] = set()
    reason_keys: set[str] = set()
    _require(bool(reasons), "reasonCodebook must not be empty")
    for index, reason_value in enumerate(reasons):
        reason = _record(reason_value, f"reasonCodebook[{index}]")
        code = _integer(reason.get("code"), f"reasonCodebook[{index}].code")
        _require(0 <= code <= 31 and code not in codes, "reason codes must be unique integers from 0 through 31")
        codes.add(code)
        reason_key = _nonempty(reason.get("key"), f"reasonCodebook[{index}].key")
        _require(reason_key not in reason_keys, "reason keys must be unique")
        reason_keys.add(reason_key)
        _nonempty(reason.get("label"), f"reasonCodebook[{index}].label")
        _require(reason.get("usage") in {"geometry_input", "fit", "integrity", "response", "visualization_only"}, "reason usage is invalid")
        _require(reason.get("channel") in {"shared", "hline", "trend"}, "reason channel is invalid")
    _require(meanings.get("reasonEncoding") == "uint32-bitmask-base64-be", "reasonEncoding is incompatible")
    reason_masks = _decode_reason_masks(meanings.get("reasonMasks"))
    allowed_reason_mask = sum(1 << code for code in codes)
    _require(all(value & ~allowed_reason_mask == 0 for value in reason_masks), "reasonMasks contains an unknown code")


def _validate_basis_facts(facts: dict[str, Any]) -> dict[str, Any]:
    columns = (
        "basisIds", "roleCodes", "observedIndexes", "confirmedIndexes", "endpointPrices",
        "bodyEdgePrices", "corridorLows", "corridorHighs", "roleMasses", "participations",
        "effectiveScales",
    )
    arrays = {key: _array(facts.get(key), f"basisFacts.{key}") for key in columns}
    role_codebook = _record(facts.get("roleCodebook"), "basisFacts.roleCodebook")
    _require(
        role_codebook == {"support": 0, "resistance": 1, "lower": 2, "upper": 3},
        "basisFacts.roleCodebook is incompatible",
    )
    count = len(arrays["basisIds"])
    _require(all(len(values) == count for values in arrays.values()), "basisFacts SoA columns have different lengths")
    _require(len(set(arrays["basisIds"])) == count, "basisFacts IDs must be unique")
    for index, basis_id in enumerate(arrays["basisIds"]):
        _digest(basis_id, f"basisFacts.basisIds[{index}]")
    for index in range(count):
        observed = _integer(arrays["observedIndexes"][index], f"basisFacts.observedIndexes[{index}]")
        confirmed = _integer(arrays["confirmedIndexes"][index], f"basisFacts.confirmedIndexes[{index}]")
        _require(0 <= observed <= confirmed < TARGET_BARS, "basis fact chronology is invalid")
        _require(_integer(arrays["roleCodes"][index], f"basisFacts.roleCodes[{index}]") in {0, 1, 2, 3}, "basis role code is invalid")
        for key in ("endpointPrices", "bodyEdgePrices", "corridorLows", "corridorHighs", "roleMasses"):
            _finite(arrays[key][index], f"basisFacts.{key}[{index}]")
        if arrays["participations"][index] is not None:
            _finite(arrays["participations"][index], f"basisFacts.participations[{index}]")
        _require(_integer(arrays["effectiveScales"][index], f"basisFacts.effectiveScales[{index}]") > 0, "basis effective scale must be positive")
    return {"count": count, "ids": arrays["basisIds"], "role_codes": arrays["roleCodes"]}


def _validate_basis_glyphs(values: list[Any], window_from: datetime, window_to: datetime) -> None:
    ids: set[str] = set()
    for index, value in enumerate(values):
        item = _record(value, f"basisGlyphs[{index}]")
        basis_id = _nonempty(item.get("basisId"), f"basisGlyphs[{index}].basisId")
        _require(basis_id not in ids, "basis glyph IDs must be unique")
        ids.add(basis_id)
        observed = _timestamp(item.get("observedAt"), f"basisGlyphs[{index}].observedAt")
        confirmed = _timestamp(item.get("confirmedAt"), f"basisGlyphs[{index}].confirmedAt")
        _require(window_from <= observed <= confirmed <= window_to, "basis glyph chronology is invalid")


def _validate_derivation_episodes(
    episodes: dict[str, Any],
    basis: dict[str, Any],
    ordered_candidates: list[str],
    boundaries: dict[str, dict[str, Any]],
) -> dict[str, tuple[Any, ...]]:
    columns = (
        "candidateIndexes", "candidateEpisodeOrdinals", "contributionBasisIndexes", "memberBasisIndexes",
        "observedFromIndexes", "observedToIndexes", "confirmedIndexes", "contributionPrices",
        "corridorLows", "corridorHighs", "initialFormationMasks",
    )
    arrays = {key: _array(episodes.get(key), f"derivationEpisodes.{key}") for key in columns}
    count = len(arrays["candidateIndexes"])
    _require(all(len(values) == count for values in arrays.values()), "derivationEpisodes SoA columns have different lengths")
    by_candidate: dict[int, set[str]] = {index: set() for index in range(len(ordered_candidates))}
    initials: dict[int, set[str]] = {index: set() for index in range(len(ordered_candidates))}
    for index in range(count):
        candidate_index = _integer(arrays["candidateIndexes"][index], f"derivationEpisodes.candidateIndexes[{index}]")
        _require(candidate_index in by_candidate, "derivation episode candidate index is invalid")
        candidate_id = ordered_candidates[candidate_index]
        fit_ids = boundaries[candidate_id]["formation"]["fitEpisodeIds"]
        ordinal = _integer(arrays["candidateEpisodeOrdinals"][index], f"derivationEpisodes.candidateEpisodeOrdinals[{index}]")
        _require(0 <= ordinal < len(fit_ids), "derivation episode ordinal is invalid")
        episode_id = fit_ids[ordinal]
        _require(episode_id not in by_candidate[candidate_index], "derivation episode ID is duplicated for a candidate")
        by_candidate[candidate_index].add(episode_id)
        contribution = _integer(arrays["contributionBasisIndexes"][index], "derivation contribution basis index")
        _require(0 <= contribution < basis["count"], "derivation contribution basis index is invalid")
        members = arrays["memberBasisIndexes"][index]
        _require(isinstance(members, list) and members, "derivation episode must contain member Basis indexes")
        _require(all(type(value) is int and 0 <= value < basis["count"] for value in members), "derivation member Basis index is invalid")
        _require(len(set(members)) == len(members), "derivation member Basis indexes must be unique")
        _require(contribution in members, "derivation contribution Basis must be a member")
        expected_role_code = {"support": 0, "resistance": 1, "lower": 2, "upper": 3}[boundaries[candidate_id]["role"]]
        _require(
            all(basis["role_codes"][value] == expected_role_code for value in members),
            "derivation member Basis role is inconsistent",
        )
        observed_from = _integer(arrays["observedFromIndexes"][index], "derivation observedFrom")
        observed_to = _integer(arrays["observedToIndexes"][index], "derivation observedTo")
        confirmed = _integer(arrays["confirmedIndexes"][index], "derivation confirmed")
        _require(0 <= observed_from <= observed_to <= confirmed < TARGET_BARS, "derivation episode chronology is invalid")
        initial = _integer(arrays["initialFormationMasks"][index], "derivation initial mask")
        _require(initial in {0, 1}, "derivation initial mask is invalid")
        if initial:
            initials[candidate_index].add(episode_id)
    for candidate_index, candidate_id in enumerate(ordered_candidates):
        boundary = boundaries[candidate_id]
        _require(by_candidate[candidate_index] == set(boundary["formation"]["fitEpisodeIds"]), "derivation episodes do not close over fit episodes")
        _require(initials[candidate_index] == set(boundary["formation"]["initialFormationEpisodeIds"]), "derivation initial episodes are inconsistent")
    return {key: tuple(values) for key, values in arrays.items()}


def _validate_validation_glyphs(
    values: list[Any],
    boundaries: dict[str, dict[str, Any]],
    ordered_candidates: list[str],
    episode_facts: dict[str, tuple[Any, ...]],
    timestamps: list[str],
    as_of: datetime,
) -> None:
    ids: set[str] = set()
    covered_initial_episode_indexes: set[int] = set()
    interaction_outcomes: dict[int, list[dict[str, Any]]] = {
        index: [] for index in range(len(ordered_candidates))
    }
    for candidate_index, candidate_id in enumerate(ordered_candidates):
        episode_indexes = [
            index
            for index, value in enumerate(episode_facts["candidateIndexes"])
            if value == candidate_index
        ]
        _require(bool(episode_indexes), "selected candidate has no derivation episodes")
        boundary = boundaries[candidate_id]
        max_confirmed = max(episode_facts["confirmedIndexes"][index] for index in episode_indexes)
        max_observed_to = max(episode_facts["observedToIndexes"][index] for index in episode_indexes)
        _require(
            boundary["formation"]["fitEvidenceConfirmedAt"] == timestamps[max_confirmed],
            "fitEvidenceConfirmedAt is not the maximum fit episode confirmation",
        )
        _require(
            boundary["formation"]["lastFitObservedAt"] == timestamps[max_observed_to],
            "lastFitObservedAt is not the maximum fit episode observation",
        )
    for index, value in enumerate(values):
        item = _record(value, f"validationGlyphs[{index}]")
        validation_id = _digest(item.get("validationId"), f"validationGlyphs[{index}].validationId")
        _require(validation_id not in ids, "validation glyph IDs must be unique")
        ids.add(validation_id)
        candidate_index = _integer(item.get("candidateIndex"), f"validationGlyphs[{index}].candidateIndex")
        _require(0 <= candidate_index < len(ordered_candidates), "validation glyph candidate index is invalid")
        candidate_id = ordered_candidates[candidate_index]
        boundary = boundaries[candidate_id]
        _require(item.get("candidateKind") == boundary.get("kind"), "validation glyph kind is inconsistent")
        _require(item.get("role") == boundary.get("role"), "validation glyph role is inconsistent")
        kind = item.get("kind")
        _require(kind in {"formation", "interaction"}, "validation glyph fact kind is invalid")
        episode_index = item.get("episodeIndex")
        if kind == "formation":
            episode_index = _integer(episode_index, f"validationGlyphs[{index}].episodeIndex")
            _require(
                0 <= episode_index < len(episode_facts["candidateIndexes"])
                and episode_facts["candidateIndexes"][episode_index] == candidate_index,
                "validation glyph episode index is inconsistent",
            )
            _require(item.get("initialFormation") is True, "formation validation must be initial evidence")
            _require(episode_facts["initialFormationMasks"][episode_index] == 1, "formation validation is not an initial episode")
            _require(episode_index not in covered_initial_episode_indexes, "initial formation validation is duplicated")
            covered_initial_episode_indexes.add(episode_index)
        else:
            _require(episode_index is None, "interaction validation cannot reference a formation episode")
        observed = _time_not_after(item.get("observedAt"), as_of, f"validationGlyphs[{index}].observedAt")
        if item.get("confirmedAt") is not None:
            confirmed = _time_not_after(item.get("confirmedAt"), as_of, f"validationGlyphs[{index}].confirmedAt")
            _require(observed <= confirmed, "validation glyph chronology is invalid")
        if kind == "formation":
            assert isinstance(episode_index, int)
            _require(item.get("observedAt") == timestamps[episode_facts["observedFromIndexes"][episode_index]], "formation validation observedAt is inconsistent")
            _require(item.get("confirmedAt") == timestamps[episode_facts["confirmedIndexes"][episode_index]], "formation validation confirmedAt is inconsistent")
            _require(_finite(item.get("endpointPrice"), "formation validation endpointPrice") == episode_facts["contributionPrices"][episode_index], "formation validation endpoint is inconsistent")
            _require(_finite(item.get("corridorLow"), "formation validation corridorLow") == episode_facts["corridorLows"][episode_index], "formation validation corridorLow is inconsistent")
            _require(_finite(item.get("corridorHigh"), "formation validation corridorHigh") == episode_facts["corridorHighs"][episode_index], "formation validation corridorHigh is inconsistent")
        else:
            _require(item.get("initialFormation") is False, "interaction validation cannot be initial formation")
            outcome = item.get("outcome")
            _require(outcome in {"response_pending", "neutral_response", "supported_response", "confirmed_break"}, "interaction validation outcome is invalid")
            _finite(item.get("endpointPrice"), "interaction validation endpointPrice")
            for key in ("explorationPressure", "acceptanceMass", "responseScore"):
                value = _finite(item.get(key), f"interaction validation {key}")
                _require(0 <= value <= 1, f"interaction validation {key} is out of range")
            watermark = _timestamp(boundary["formation"]["fitEvidenceConfirmedAt"], "fitEvidenceConfirmedAt")
            _require(observed > watermark, "interaction validation must start after fit evidence")
            _require((outcome == "response_pending") == (item.get("confirmedAt") is None), "interaction terminal time is inconsistent")
            interaction_outcomes[candidate_index].append(item)

    expected_initial_episode_indexes = {
        index
        for index, mask in enumerate(episode_facts["initialFormationMasks"])
        if mask == 1
    }
    _require(
        covered_initial_episode_indexes == expected_initial_episode_indexes,
        "validationGlyphs must cover every selected initial formation episode",
    )
    for candidate_index, candidate_id in enumerate(ordered_candidates):
        boundary = boundaries[candidate_id]
        facts = interaction_outcomes[candidate_index]
        supported = [item for item in facts if item.get("outcome") == "supported_response"]
        pending = [item for item in facts if item.get("outcome") == "response_pending"]
        _require(len(supported) == boundary["responses"]["completedCount"], "supported response validation count is inconsistent")
        _require(len(pending) == boundary["responses"]["pendingCount"], "pending response validation count is inconsistent")
        _require(
            math.fsum(item["responseScore"] for item in supported) == boundary["responses"]["responseMass"],
            "supported response validation mass is inconsistent",
        )
        expected_last = supported[-1]["observedAt"] if supported else None
        _require(boundary["responses"]["lastInteractionAt"] == expected_last, "last supported response time is inconsistent")
        _require((boundary["evidenceState"] == "response_supported") == bool(supported), "candidate evidenceState is inconsistent with response facts")


def _validate_hline_response_segments(values: list[Any], window_from: Any, window_to: Any) -> None:
    ids: set[str] = set()
    previous: tuple[int, float, str] | None = None
    role_order = {"support": 0, "resistance": 1}
    for index, value in enumerate(values):
        path = f"hlineResponseSegments[{index}]"
        item = _record(value, path)
        segment_id = _digest(item.get("segmentId"), f"{path}.segmentId")
        _require(segment_id not in ids, "H-Line response segment IDs must be unique")
        ids.add(segment_id)
        _digest(item.get("derivationDigest"), f"{path}.derivationDigest")
        role = item.get("role")
        _require(role in role_order, f"{path}.role is invalid")
        low = _finite(item.get("lowPrice"), f"{path}.lowPrice")
        high = _finite(item.get("highPrice"), f"{path}.highPrice")
        _require(low < high, f"{path} must have positive price width")
        _require(_finite(item.get("responseMass"), f"{path}.responseMass") >= 0, f"{path}.responseMass must be non-negative")
        _require(_integer(item.get("activeBasisCount"), f"{path}.activeBasisCount") >= 2, f"{path}.activeBasisCount must be at least two")
        _require(item.get("windowFromTimestamp") == window_from, f"{path}.windowFromTimestamp is inconsistent")
        _require(item.get("windowToTimestamp") == window_to, f"{path}.windowToTimestamp is inconsistent")
        order_key = (role_order[role], low, segment_id)
        _require(previous is None or previous <= order_key, "H-Line response segments are not canonical ordered")
        previous = order_key


def _validate_hline_profile_bins(values: list[Any]) -> None:
    previous_high: float | None = None
    for index, value in enumerate(values):
        path = f"hlineProfileBins[{index}]"
        item = _record(value, path)
        _require(_integer(item.get("binIndex"), f"{path}.binIndex") == index, "H-Line profile bin index is inconsistent")
        low = _finite(item.get("lowPrice"), f"{path}.lowPrice")
        high = _finite(item.get("highPrice"), f"{path}.highPrice")
        _require(low < high, f"{path} must have positive price width")
        if previous_high is not None:
            _require(low == previous_high, "H-Line profile bins must be contiguous")
        normalized = _finite(item.get("normalizedVolume"), f"{path}.normalizedVolume")
        _require(0 <= normalized <= 1, f"{path}.normalizedVolume is out of range")
        previous_high = high


def _validate_pattern(value: Any, drawings: list[Any], relation_value: Any) -> None:
    if value is None:
        _require(relation_value is None, "relationGlyph requires a presentationPattern")
        return
    pattern = _record(value, "presentationPattern")
    triangle_id = _digest(pattern.get("triangleId"), "presentationPattern.triangleId")
    _require(pattern.get("kind") in {"ascending_triangle", "descending_triangle", "symmetrical_triangle"}, "Triangle kind is invalid")
    upper = _nonempty(pattern.get("upperCandidateId"), "presentationPattern.upperCandidateId")
    lower = _nonempty(pattern.get("lowerCandidateId"), "presentationPattern.lowerCandidateId")
    candidates = {item.get("sourceCandidateId"): item for item in drawings}
    _require(upper in candidates and lower in candidates, "Triangle references missing drawings")
    _require(candidates[upper].get("sourceGroupId") == triangle_id and candidates[lower].get("sourceGroupId") == triangle_id, "Triangle drawing group is inconsistent")
    if relation_value is not None:
        relation = _record(relation_value, "relationGlyph")
        _require(relation.get("triangleId") == triangle_id, "relationGlyph triangle is inconsistent")
        _require(relation.get("upperCandidateId") == upper and relation.get("lowerCandidateId") == lower, "relationGlyph candidates are inconsistent")


def _validate_timestamp_price_line(value: dict[str, Any], window_from: datetime, window_to: datetime) -> None:
    start = _timestamp(value.get("fromTimestamp"), "line.fromTimestamp")
    end = _timestamp(value.get("toTimestamp"), "line.toTimestamp")
    _require(window_from <= start <= end <= window_to, "timestamp-price line is outside the Field window")
    _finite(value.get("fromPrice"), "line.fromPrice")
    _finite(value.get("toPrice"), "line.toPrice")


def _decode_factor_series(value: Any, encoding: Any, sentinel: int, maximum: int | None, path: str) -> tuple[int, ...]:
    _require(isinstance(value, str) and value, f"{path} must be a base64 string")
    try:
        payload = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise CzardasPackValidationError(f"{path} is not canonical base64") from exc
    _require(base64.b64encode(payload).decode("ascii") == value, f"{path} is not canonical base64")
    if encoding == "int16-base64-be":
        width, format_code = 2, "h"
    elif encoding == "int32-base64-be":
        width, format_code = 4, "i"
    else:
        raise CzardasPackValidationError(f"{path} has unsupported encoding")
    _require(len(payload) == TARGET_BARS * width, f"{path} must encode 240 values")
    values = struct.unpack(f">{TARGET_BARS}{format_code}", payload)
    if maximum is not None:
        _require(all(value == sentinel or 0 <= value <= maximum for value in values), f"{path} normalized values are out of range")
    return values


def _decode_reason_masks(value: Any) -> tuple[int, ...]:
    _require(isinstance(value, str) and value, "candleMeanings.reasonMasks must be a base64 string")
    try:
        payload = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise CzardasPackValidationError("candleMeanings.reasonMasks is not canonical base64") from exc
    _require(base64.b64encode(payload).decode("ascii") == value, "candleMeanings.reasonMasks is not canonical base64")
    _require(len(payload) == TARGET_BARS * 4, "candleMeanings.reasonMasks must encode 240 values")
    return struct.unpack(f">{TARGET_BARS}I", payload)


def _reject_historical_keys(value: Any) -> None:
    if isinstance(value, list):
        for item in value:
            _reject_historical_keys(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            _require(key not in HISTORICAL_KEYS, f"historical Czardas key is forbidden: {key}")
            _reject_historical_keys(item)


def _record(value: Any, path: str) -> dict[str, Any]:
    _require(isinstance(value, dict), f"{path} must be an object")
    return value


def _array(value: Any, path: str, *, maximum: int | None = None) -> list[Any]:
    _require(isinstance(value, list), f"{path} must be an array")
    if maximum is not None:
        _require(len(value) <= maximum, f"{path} has too many items")
    return value


def _string_array(value: Any, path: str, *, allow_empty: bool = False) -> list[str]:
    values = _array(value, path)
    _require(all(isinstance(item, str) and (allow_empty or bool(item)) for item in values), f"{path} must contain strings")
    return values


def _nonempty(value: Any, path: str) -> str:
    _require(isinstance(value, str) and bool(value.strip()), f"{path} must be a non-empty string")
    return value


def _digest(value: Any, path: str) -> str:
    text = _nonempty(value, path)
    _require(_DIGEST.fullmatch(text) is not None, f"{path} must be a canonical sha256 digest")
    return text


def _integer(value: Any, path: str) -> int:
    _require(type(value) is int, f"{path} must be an integer")
    return value


def _positive_integer(value: Any, path: str) -> int:
    result = _integer(value, path)
    _require(result > 0, f"{path} must be positive")
    return result


def _finite(value: Any, path: str) -> float:
    _require(type(value) in {int, float} and math.isfinite(float(value)), f"{path} must be finite")
    return float(value)


def _scaled_series(value: Any, count: int, scale: int, path: str) -> None:
    values = _array(value, path)
    _require(len(values) == count, f"{path} must have {count} entries")
    _require(all(type(item) is int and 0 <= item <= scale for item in values), f"{path} contains an invalid scaled value")


def _timestamp(value: Any, path: str) -> datetime:
    text = _nonempty(value, path)
    _require(text.endswith("Z"), f"{path} must use UTC Z")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise CzardasPackValidationError(f"{path} is not an ISO timestamp") from exc
    _require(parsed.tzinfo is not None and parsed.utcoffset() == timezone.utc.utcoffset(parsed), f"{path} must be UTC")
    return parsed


def _time_not_after(value: Any, upper: datetime, path: str) -> datetime:
    result = _timestamp(value, path)
    _require(result <= upper, f"{path} is after asOf")
    return result


def _canonical_size(value: Mapping[str, Any]) -> int:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise CzardasPackValidationError("Czardas pack is not canonical JSON") from exc
    return len(encoded)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise CzardasPackValidationError(message)
