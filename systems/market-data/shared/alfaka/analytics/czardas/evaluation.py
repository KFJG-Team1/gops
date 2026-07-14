"""Offline, non-storable Czardas walk-forward evaluation.

Every evaluated point is inferred from a fresh exact-240 slice.  Rows after the
slice are passed only to the outcome evaluator; they never enter Czardas.
This module deliberately does not tune or write production configuration.
"""

from __future__ import annotations

import math
import statistics
import time
from dataclasses import asdict, dataclass, replace
from typing import Any, Iterable, Sequence

from .config import CzardasConfig, DEFAULT_CONFIG
from .kernel import CzardasInference, infer_czardas, project_czardas_sight
from .numeric import canonicalize, identity_digest, quantize_number
from .rank import boundary_rank
from .select import select_boundaries
from .types import AnalysisUnavailable, BoundaryCandidate, Ready


@dataclass(frozen=True, slots=True)
class ResearchCzardasConfig(CzardasConfig):
    """A kernel-readable config that cannot be projected or persisted."""

    config_version: str = "czardas-research-only"
    study_label: str = "offline"

    @property
    def production_storable(self) -> bool:
        return False


def evaluate_walk_forward(
    rows: Sequence[dict[str, Any]],
    *,
    as_of_indexes: Iterable[int] | None = None,
    future_horizon: int = 10,
    config: CzardasConfig = DEFAULT_CONFIG,
) -> dict[str, Any]:
    """Evaluate independent snapshots and return diagnostics, never assets.

    ``as_of_indexes`` indexes ``rows`` and must leave 240 rows at or before the
    selected index.  Future rows are used only by ``_future_outcomes``.
    """

    config.validate()
    if future_horizon < 0:
        raise ValueError("future_horizon_must_be_non_negative")
    indexes = list(as_of_indexes) if as_of_indexes is not None else list(range(239, len(rows)))
    snapshots: list[dict[str, Any]] = []
    previous: tuple[CzardasInference, Ready] | None = None
    for end_index in indexes:
        if end_index < 239 or end_index >= len(rows):
            raise ValueError("walk_forward_index_out_of_range")
        # This is the only kernel input.  It is exact-240 and ends at asOf.
        kernel_rows = [dict(item) for item in rows[end_index - 239:end_index + 1]]
        inference = infer_czardas(kernel_rows, config)
        if isinstance(inference, AnalysisUnavailable):
            snapshots.append({"asOfIndex": end_index, "status": "unavailable", "reason": inference.reason})
            previous = None
            continue
        pack = project_czardas_sight(inference)
        if not isinstance(pack, Ready):
            snapshots.append({"asOfIndex": end_index, "status": "unavailable", "reason": pack.reason})
            previous = None
            continue
        future = rows[end_index + 1:min(len(rows), end_index + 1 + future_horizon)]
        current = _snapshot_metrics(inference, pack, future)
        current["asOfIndex"] = end_index
        current["adjacent"] = _adjacent_metrics(previous, (inference, pack)) if previous else None
        current["ablations"] = _ablation_metrics(kernel_rows, inference)
        current["simpleBoundaryBaseline"] = _simple_boundary_baseline(kernel_rows, future)
        snapshots.append(canonicalize(current))
        previous = (inference, pack)
    ready = [item for item in snapshots if item.get("status") == "ready"]
    return canonicalize({
        "contract": "offline-independent-exact-240-v1",
        "productionConfigDigest": config.inference_digest,
        "futureHorizon": future_horizon,
        "thresholdsAutoAdjusted": False,
        "snapshotCount": len(snapshots),
        "readyCount": len(ready),
        "summary": _aggregate(ready),
        "snapshots": snapshots,
    })


def _snapshot_metrics(
    inference: CzardasInference,
    pack: Ready,
    future: Sequence[dict[str, Any]],
) -> dict[str, Any]:
    selected = (*inference.selected_hlines, *inference.selected_trends)
    return {
        "status": "ready",
        "asOf": inference.tape.as_of,
        "inferenceId": inference.inference_id,
        "outputCount": {
            "hline": len(inference.selected_hlines),
            "trend": len(inference.selected_trends),
        },
        "searchModeCount": len(inference.hline.modes) + len(inference.trend.modes),
        "projectionBytes": pack.debug["payloadBytes"],
        "fieldBytes": pack.debug["fieldBytes"],
        "stageLatencyMs": {
            "inference": pack.debug["inferenceElapsedMs"],
            "projection": pack.debug["projectionElapsedMs"],
        },
        "futureBoundaryFacts": _future_outcomes(selected, future),
        "marginalInformation": _marginal_information(inference, selected),
    }


def _adjacent_metrics(
    previous: tuple[CzardasInference, Ready],
    current: tuple[CzardasInference, Ready],
) -> dict[str, Any]:
    old, old_pack = previous
    new, new_pack = current
    atr = new.features.effective_atr[-1]
    return {
        "hlineDriftAtr": _role_drift(old.selected_hlines, new.selected_hlines, atr),
        "trendDriftAtr": _role_drift(old.selected_trends, new.selected_trends, atr),
        "fieldChurn": _field_churn(old_pack, new_pack),
    }


def _role_drift(
    old: Sequence[BoundaryCandidate], new: Sequence[BoundaryCandidate], atr: float
) -> float | None:
    distances: list[float] = []
    for candidate in new:
        compatible = [item for item in old if item.kind == candidate.kind and item.role == candidate.role]
        if compatible:
            distances.append(min(abs(candidate.price_at_as_of - item.price_at_as_of) for item in compatible) / atr)
    return None if not distances else math.fsum(distances) / len(distances)


def _field_churn(old: Ready, new: Ready) -> dict[str, float | None]:
    old_meaning = old.content["czardasField"]["candleMeanings"]
    new_meaning = new.content["czardasField"]["candleMeanings"]
    old_index = {value: index for index, value in enumerate(old_meaning["timestamps"])}
    pairs = [(old_index[value], index) for index, value in enumerate(new_meaning["timestamps"]) if value in old_index]
    if not pairs:
        return {"overlapBars": 0, "meanAbsoluteDelta": None, "changedFraction": None}
    deltas: list[float] = []
    for key in ("shared", "hline", "trend", "compositePercentile"):
        left = old_meaning["summaries"][key]
        right = new_meaning["summaries"][key]
        deltas.extend(abs(float(left[a]) - float(right[b])) for a, b in pairs)
    return {
        "overlapBars": len(pairs),
        "meanAbsoluteDelta": math.fsum(deltas) / len(deltas),
        "changedFraction": sum(value > 1e-6 for value in deltas) / len(deltas),
    }


def _future_outcomes(
    candidates: Sequence[BoundaryCandidate], future: Sequence[dict[str, Any]]
) -> dict[str, int]:
    totals = {"contacts": 0, "reclaims": 0, "bodyPenetrations": 0, "closePenetrations": 0, "twoCloseInvalidations": 0}
    for candidate in candidates:
        penetrated = False
        previous_close_penetrated = False
        invalidated = False
        for offset, raw in enumerate(future, start=1):
            open_ = quantize_number(raw["open"])
            high = quantize_number(raw["high"])
            low = quantize_number(raw["low"])
            close = quantize_number(raw["close"])
            line = candidate.price_at_as_of + candidate.slope_per_bar * offset
            low_edge, high_edge = line - candidate.zone_half_width, line + candidate.zone_half_width
            if low <= high_edge and high >= low_edge:
                totals["contacts"] += 1
            lower_side = candidate.role in {"support", "lower"}
            body_penetrated = min(open_, close) < low_edge if lower_side else max(open_, close) > high_edge
            close_penetrated = close < low_edge if lower_side else close > high_edge
            valid_close = close >= low_edge if lower_side else close <= high_edge
            totals["bodyPenetrations"] += int(body_penetrated)
            totals["closePenetrations"] += int(close_penetrated)
            if penetrated and valid_close:
                totals["reclaims"] += 1
                penetrated = False
            penetrated = penetrated or body_penetrated or close_penetrated
            if previous_close_penetrated and close_penetrated and not invalidated:
                totals["twoCloseInvalidations"] += 1
                invalidated = True
            previous_close_penetrated = close_penetrated
    return totals


def _marginal_information(
    inference: CzardasInference, candidates: Sequence[BoundaryCandidate]
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    atr = inference.features.effective_atr[-1]
    for first_index, first in enumerate(candidates):
        for second in candidates[first_index + 1:]:
            if first.kind != second.kind or first.role != second.role:
                continue
            distances = []
            for index in (0, 239):
                first_y = first.intercept_at_origin + first.slope_per_bar * (index - first.index_origin)
                second_y = second.intercept_at_origin + second.slope_per_bar * (index - second.index_origin)
                distances.append(abs(first_y - second_y) / atr)
            geometry_overlap = max(0.0, 1.0 - math.fsum(distances) / (2 * 0.75))
            left, right = set(first.fit_episode_ids), set(second.fit_episode_ids)
            union = left | right
            result.append({
                "firstCandidateId": first.candidate_id,
                "secondCandidateId": second.candidate_id,
                "geometryOverlap": geometry_overlap,
                "fitEpisodeJaccard": 0.0 if not union else len(left & right) / len(union),
                "marginalInformation": 1.0 - max(geometry_overlap, 0.0 if not union else len(left & right) / len(union)),
            })
    return result


def _ablation_metrics(rows: Sequence[dict[str, Any]], full: CzardasInference) -> dict[str, Any]:
    result = {
        "response": _rank_ablation(full, remove_response=True, remove_profile=False),
        "profile": _rank_ablation(full, remove_response=False, remove_profile=True),
    }
    neutral_volume = statistics.median(quantize_number(item["volume"]) for item in rows)
    no_volume_rows = [{**item, "volume": neutral_volume} for item in rows]
    result["volume"] = _research_variant(no_volume_rows, full, "volume-neutral", {})
    result["recency"] = _research_variant(rows, full, "recency-flat", {"recency_half_life_bars": 1_000_000_000})
    result["multiRadius"] = {
        f"radius{radius}": _research_variant(rows, full, f"radius-{radius}", {"extrema_radii": (radius,)})
        for radius in (2, 5, 13)
    }
    return result


def _rank_ablation(
    inference: CzardasInference, *, remove_response: bool, remove_profile: bool
) -> dict[str, Any]:
    def adjusted(candidate: BoundaryCandidate) -> BoundaryCandidate:
        rank, _, _ = boundary_rank(
            candidate.seed_quality,
            candidate.integrity,
            candidate.persistence,
            () if remove_response else candidate.interactions,
            profile_confluence=None if remove_profile else candidate.profile_confluence,
        )
        return replace(candidate, rank_score=rank)

    hlines = tuple(adjusted(item) for item in inference.hline.candidates)
    trends = tuple(adjusted(item) for item in inference.trend.candidates)
    selected_h, selected_t, _ = select_boundaries(
        inference.tape, inference.features, hlines, trends, inference.config
    )
    return _selection_comparison(inference, selected_h, selected_t)


def _research_variant(
    rows: Sequence[dict[str, Any]],
    full: CzardasInference,
    label: str,
    overrides: dict[str, Any],
) -> dict[str, Any]:
    values = asdict(full.config)
    values.update(overrides)
    values["config_version"] = "czardas-research-only"
    values["study_label"] = label
    research = ResearchCzardasConfig(**values)
    started = time.perf_counter()
    variant = infer_czardas(rows, research)
    if isinstance(variant, AnalysisUnavailable):
        return {"status": "unavailable", "reason": variant.reason}
    comparison = _selection_comparison(full, variant.selected_hlines, variant.selected_trends)
    comparison.update({
        "status": "ready",
        "latencyMs": (time.perf_counter() - started) * 1000.0,
        "searchModeCount": len(variant.hline.modes) + len(variant.trend.modes),
        "trendInferenceDigest": _trend_slice_digest(variant),
    })
    if label == "volume-neutral":
        comparison["trendInvariant"] = _trend_slice_digest(full) == comparison["trendInferenceDigest"]
    return comparison


def _selection_comparison(
    full: CzardasInference,
    hlines: Sequence[BoundaryCandidate],
    trends: Sequence[BoundaryCandidate],
) -> dict[str, Any]:
    original = {item.candidate_id for item in (*full.selected_hlines, *full.selected_trends)}
    altered = {item.candidate_id for item in (*hlines, *trends)}
    union = original | altered
    return {
        "outputCount": {"hline": len(hlines), "trend": len(trends)},
        "selectionJaccard": 1.0 if not union else len(original & altered) / len(union),
    }


def _trend_slice_digest(inference: CzardasInference) -> str:
    return identity_digest([
        tuple(asdict(item) for item in inference.basis if item.role in {"lower", "upper"}),
        tuple(asdict(item) for item in inference.trend.modes),
        tuple(asdict(item) for item in inference.trend.candidates),
        tuple(asdict(item) for item in inference.selected_trends),
    ])


def _simple_boundary_baseline(
    rows: Sequence[dict[str, Any]], future: Sequence[dict[str, Any]]
) -> dict[str, Any]:
    pivots: dict[str, list[tuple[int, float]]] = {"support": [], "resistance": []}
    radius = 5
    for index in range(radius, len(rows) - radius):
        window = rows[index - radius:index + radius + 1]
        low = quantize_number(rows[index]["low"])
        high = quantize_number(rows[index]["high"])
        if low == min(quantize_number(item["low"]) for item in window):
            pivots["support"].append((index, low))
        if high == max(quantize_number(item["high"]) for item in window):
            pivots["resistance"].append((index, high))
    synthetic: list[BoundaryCandidate] = []
    for role, values in pivots.items():
        if not values:
            continue
        index, price = values[-1]
        synthetic.append(_baseline_candidate(role, index, price))
    return {
        "method": "latest-confirmed-radius5-pivot",
        "outputCount": len(synthetic),
        "futureBoundaryFacts": _future_outcomes(synthetic, future),
    }


def _baseline_candidate(role: str, index: int, price: float) -> BoundaryCandidate:
    return BoundaryCandidate(
        candidate_id=f"baseline:{role}:{index}", kind="hline", role=role, evidence_state="formed",
        source_field_mode_id="baseline", source_field_derivation_digest="baseline", slope_per_bar=0.0,
        index_origin=index, intercept_at_origin=price, price_at_as_of=price, zone_half_width=0.0,
        observed_from_index=index, observed_to_index=index, initial_episode_ids=("a", "b"),
        fit_episode_ids=("a", "b"), fit_evidence_confirmed_index=index, seed_quality=0.0,
        integrity=0.0, body_integrity=0.0, close_integrity=0.0, integrity_fact_count=0,
        integrity_effective_fact_count=0.0, integrity_coverage=0.0, body_penetration_count=0,
        close_penetration_count=0, persistence=0.0, interactions=(), profile_confluence=None,
        rank_score=0.0,
    )


def _aggregate(ready: Sequence[dict[str, Any]]) -> dict[str, Any]:
    if not ready:
        return {}
    return {
        "meanHLineCount": math.fsum(item["outputCount"]["hline"] for item in ready) / len(ready),
        "meanTrendCount": math.fsum(item["outputCount"]["trend"] for item in ready) / len(ready),
        "meanSearchModeCount": math.fsum(item["searchModeCount"] for item in ready) / len(ready),
        "maxProjectionBytes": max(item["projectionBytes"] for item in ready),
        "inferenceP95Ms": _percentile([item["stageLatencyMs"]["inference"] for item in ready], 0.95),
    }


def _percentile(values: Sequence[float], percentile: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(percentile * len(ordered)) - 1))
    return ordered[index]
