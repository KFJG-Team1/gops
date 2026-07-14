from __future__ import annotations

import math
from dataclasses import dataclass, replace

from .config import CzardasConfig
from .features import FeatureTape
from .interactions import LineProbe, integrity_for_domain
from .numeric import clamp, median, stable_hash
from .tape import CandleTape
from .types import BoundaryCandidate, DetectorResult, FieldMode, FormationEpisode, RoleBasis


@dataclass(frozen=True, slots=True)
class StructuralDomain:
    domain_id: str
    parent_id: str | None
    start_index: int
    end_index: int
    depth: int
    slope_per_bar: float
    intercept: float
    residual_mad: float
    fit_loss: float
    active: bool = False


@dataclass(frozen=True, slots=True)
class RegressionFlow:
    flow_id: str
    domain_id: str
    start_index: int
    end_index: int
    slope_per_bar: float
    intercept: float
    corridor_half_width: float
    residual_mad: float
    leverage_max: float

    def price(self, index: int) -> float:
        return self.intercept + self.slope_per_bar * index


@dataclass(frozen=True, slots=True)
class PriceMemoryRidge:
    ridge_id: str
    low_price: float
    high_price: float
    center_price: float
    response_mass: float
    contributor_indexes: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class ImpulseFact:
    fact_id: str
    boundary_start_index: int
    start_index: int
    end_index: int
    direction: int
    normalized_move: float
    path_efficiency: float


@dataclass(frozen=True, slots=True)
class StructuralFactTape:
    """Neutral structural facts shared by boundaries and Pattern relations.

    RoleBasis remains the canonical confirmed endpoint/reaction fact. Impulse
    is calculated once for the snapshot here, so Pattern families never grow
    their own candle scan or fit chain.
    """

    basis: tuple[RoleBasis, ...]
    impulses: tuple[ImpulseFact, ...]

    def preceding_impulse(self, boundary_start_index: int) -> ImpulseFact | None:
        return next(
            (item for item in self.impulses if item.boundary_start_index == boundary_start_index),
            None,
        )


def build_structural_facts(
    tape: CandleTape,
    features: FeatureTape,
    basis: tuple[RoleBasis, ...],
) -> StructuralFactTape:
    """Materialize endpoint/reaction and adaptive preceding-impulse facts.

    Impulse uses one suffix search rather than a list of fixed lookback
    detectors. Net displacement must also dominate the travelled close path,
    which keeps a volatile sideways region from masquerading as an impulse.
    """

    impulses: list[ImpulseFact] = []
    path_prefix = [0.0] * len(tape.candles)
    for index in range(1, len(tape.candles)):
        path_prefix[index] = (
            path_prefix[index - 1]
            + abs(tape.candles[index].close - tape.candles[index - 1].close)
        )
    for boundary_start in range(6, len(tape.candles)):
        end = boundary_start - 1
        scale_start = max(0, boundary_start - 48)
        # One robust scale describes the regime immediately preceding this
        # boundary. Candidate suffixes then compete on displacement and path
        # efficiency, not on a suffix-specific denominator that can reward a
        # conveniently quiet subwindow. This also keeps the adaptive search
        # linear in its bounded suffix bank.
        atr = median(features.effective_atr[scale_start:boundary_start])
        best: tuple[float, int, float, float] | None = None
        for start in range(scale_start, boundary_start - 5):
            move = tape.candles[end].close - tape.candles[start].close
            normalized = move / max(atr, 1e-12)
            travelled = path_prefix[end] - path_prefix[start]
            efficiency = abs(move) / max(travelled, 1e-12)
            score = abs(normalized) * math.sqrt(clamp(efficiency))
            key = (score, -start, normalized, efficiency)
            if best is None or key > best:
                best = key
        if best is None:
            continue
        score, negative_start, normalized, efficiency = best
        start = -negative_start
        if abs(normalized) < 2.5 or efficiency < 0.45:
            continue
        impulses.append(ImpulseFact(
            fact_id=stable_hash(
                "impulse-fact", tape.symbol, tape.interval,
                boundary_start, start, end, normalized, efficiency,
            ),
            boundary_start_index=boundary_start,
            start_index=start,
            end_index=end,
            direction=1 if normalized > 0 else -1,
            normalized_move=normalized,
            path_efficiency=efficiency,
        ))
    return StructuralFactTape(basis=basis, impulses=tuple(impulses))


def impulse_to_dto(tape: CandleTape, impulse: ImpulseFact | None) -> dict | None:
    if impulse is None:
        return None
    return {
        "factId": impulse.fact_id,
        "fromTimestamp": tape.candles[impulse.start_index].timestamp,
        "toTimestamp": tape.candles[impulse.end_index].timestamp,
        "direction": impulse.direction,
        "normalizedMove": impulse.normalized_move,
        "pathEfficiency": impulse.path_efficiency,
    }


def build_structural_domains(
    tape: CandleTape,
    features: FeatureTape,
) -> tuple[tuple[StructuralDomain, ...], tuple[RegressionFlow, ...]]:
    """Build one deterministic adaptive scale tree from q8 HLC3.

    The tree is descriptive rather than predictive.  Splits are accepted only
    when two linear descriptions remove enough robustly scaled loss to pay for
    the additional model.  The root, current right spine and its siblings form
    the active multi-scale Field.
    """

    values = tuple((bar.high + bar.low + bar.close) / 3.0 for bar in tape.candles)
    prefix_y = [0.0]
    prefix_y2 = [0.0]
    prefix_xy = [0.0]
    for index, value in enumerate(values):
        prefix_y.append(prefix_y[-1] + value)
        prefix_y2.append(prefix_y2[-1] + value * value)
        prefix_xy.append(prefix_xy[-1] + index * value)
    provisional: list[StructuralDomain] = []
    children: dict[str, tuple[str, str]] = {}
    max_depth = math.ceil(math.log2(len(values)))

    def visit(start: int, end: int, depth: int, parent_id: str | None) -> str:
        slope, intercept, mad, loss = _ols(values, start, end)
        domain_id = stable_hash("domain", tape.symbol, tape.interval, start, end)
        provisional.append(StructuralDomain(
            domain_id, parent_id, start, end, depth, slope, intercept, mad, loss,
        ))
        count = end - start + 1
        if depth >= max_depth or count < 12:
            return domain_id
        best: tuple[float, int] | None = None
        scale = max(mad, median(features.effective_atr[start:end + 1]) * 0.10, 1e-12)
        complexity_cost = scale * scale * math.log1p(count) * 2.0
        for split in range(start + 6, end - 4):
            left_loss = _ols_loss(prefix_y, prefix_y2, prefix_xy, start, split - 1)
            right_loss = _ols_loss(prefix_y, prefix_y2, prefix_xy, split, end)
            gain = loss - left_loss - right_loss - complexity_cost
            key = (gain, -split)
            if best is None or key > (best[0], -best[1]):
                best = (gain, split)
        if best is None or best[0] <= max(0.12 * loss, complexity_cost):
            return domain_id
        split = best[1]
        left_id = visit(start, split - 1, depth + 1, domain_id)
        right_id = visit(split, end, depth + 1, domain_id)
        children[domain_id] = (left_id, right_id)
        return domain_id

    root_id = visit(0, len(values) - 1, 0, None)
    active_ids = {root_id}
    cursor = root_id
    while cursor in children:
        left_id, right_id = children[cursor]
        active_ids.update((left_id, right_id))
        cursor = right_id
    domains = tuple(replace(item, active=item.domain_id in active_ids) for item in provisional)
    flows = tuple(
        RegressionFlow(
            stable_hash("ols-flow", item.domain_id), item.domain_id,
            item.start_index, item.end_index, item.slope_per_bar, item.intercept,
            max(1.4826 * item.residual_mad, median(features.effective_atr[item.start_index:item.end_index + 1]) * 0.20),
            item.residual_mad,
            _max_leverage(item.start_index, item.end_index),
        )
        for item in domains if item.active
    )
    return domains, flows


def build_price_memory(
    tape: CandleTape,
    features: FeatureTape,
) -> tuple[PriceMemoryRidge, ...]:
    """Continuous volume-independent price occupancy and endpoint reaction Field."""

    intervals: list[tuple[float, float, float, int]] = []
    for index, candle in enumerate(tape.candles):
        atr = features.effective_atr[index]
        tolerance = max(0.12 * atr, max(0.01, candle.close * 1e-6) * 2)
        body = abs(candle.close - candle.open) / max(atr, 1e-12)
        upper_reject = max(0.0, candle.high - max(candle.open, candle.close)) / max(atr, 1e-12)
        lower_reject = max(0.0, min(candle.open, candle.close) - candle.low) / max(atr, 1e-12)
        age_weight = 2.0 ** (-(len(tape.candles) - 1 - index) / 120.0)
        shared = 0.55 + 0.20 * clamp(body) + 0.25 * age_weight
        intervals.append((candle.low - tolerance, candle.low + tolerance, shared + 0.35 * clamp(lower_reject), index))
        intervals.append((candle.high - tolerance, candle.high + tolerance, shared + 0.35 * clamp(upper_reject), index))
    events: dict[float, dict[str, list[tuple[int, float, int]]]] = {}
    for ordinal, (low, high, mass, candle_index) in enumerate(intervals):
        events.setdefault(low, {"add": [], "remove": []})["add"].append((ordinal, mass, candle_index))
        events.setdefault(high, {"add": [], "remove": []})["remove"].append((ordinal, mass, candle_index))
    endpoints = sorted(events)
    segments: list[tuple[float, float, float, tuple[int, ...]]] = []
    active_mass = 0.0
    active_candle_counts: dict[int, int] = {}
    for position, low in enumerate(endpoints[:-1]):
        event = events[low]
        for _ordinal, mass, candle_index in sorted(event["remove"]):
            active_mass -= mass
            remaining = active_candle_counts.get(candle_index, 0) - 1
            if remaining > 0:
                active_candle_counts[candle_index] = remaining
            else:
                active_candle_counts.pop(candle_index, None)
        for _ordinal, mass, candle_index in sorted(event["add"]):
            active_mass += mass
            active_candle_counts[candle_index] = active_candle_counts.get(candle_index, 0) + 1
        high = endpoints[position + 1]
        if high <= low:
            continue
        if active_candle_counts:
            segments.append((low, high, active_mass, tuple(sorted(active_candle_counts))))
    peaks: list[PriceMemoryRidge] = []
    for index, (low, high, mass, contributors) in enumerate(segments):
        left = segments[index - 1][2] if index and segments[index - 1][1] == low else -math.inf
        right = segments[index + 1][2] if index + 1 < len(segments) and segments[index + 1][0] == high else -math.inf
        if mass < left or mass < right:
            continue
        peaks.append(PriceMemoryRidge(
            stable_hash("price-memory", tape.symbol, tape.interval, low, high, contributors),
            low, high, (low + high) / 2.0, mass, contributors,
        ))
    # Similar neighbouring plateaus represent one memory ridge.  Empty price
    # space is never bridged.
    compressed: list[PriceMemoryRidge] = []
    for ridge in sorted(peaks, key=lambda item: (-item.response_mass, item.low_price, item.ridge_id)):
        if any(
            max(existing.low_price, ridge.low_price) <= min(existing.high_price, ridge.high_price)
            for existing in compressed
        ):
            continue
        compressed.append(ridge)
        if len(compressed) == 16:
            break
    return tuple(compressed)


def ensure_baseline_hline(
    tape: CandleTape,
    features: FeatureTape,
    result: DetectorResult,
    memory: tuple[PriceMemoryRidge, ...],
    config: CzardasConfig,
) -> DetectorResult:
    if not memory or any(item.evidence_state == "baseline_memory" for item in result.candidates):
        return result
    ridge = memory[0]
    center = ridge.center_price
    role = "support" if center <= tape.candles[-1].close else "resistance"
    contributor_indexes = list(ridge.contributor_indexes[:2])
    if len(contributor_indexes) < 2:
        contributor_indexes = sorted(range(len(tape.candles)), key=lambda index: (
            min(abs(tape.candles[index].low - center), abs(tape.candles[index].high - center)), index,
        ))[:2]
    synthetic_basis: list[RoleBasis] = []
    episodes: list[FormationEpisode] = []
    mode_id = stable_hash("baseline-memory-mode", tape.symbol, tape.interval, role, ridge.ridge_id)
    zone = max((ridge.high_price - ridge.low_price) / 2.0, config.touch_tolerance_atr * median(features.effective_atr))
    for ordinal, index in enumerate(sorted(contributor_indexes)):
        candle = tape.candles[index]
        endpoint = candle.low if role == "support" else candle.high
        basis_id = stable_hash("baseline-memory-basis", mode_id, index)
        cluster_id = stable_hash("baseline-memory-cluster", mode_id, index)
        basis = RoleBasis(
            basis_id, cluster_id, role, candle.timestamp, candle.timestamp,
            index, index, endpoint, endpoint, endpoint - zone, endpoint + zone,
            0.5, 0.5, 0.0, None, 2,
        )
        episode_id = stable_hash("baseline-memory-episode", mode_id, index)
        synthetic_basis.append(basis)
        episodes.append(FormationEpisode(
            episode_id, mode_id, role, (basis_id,), basis_id, index,
            index, index, index, endpoint, endpoint - zone, endpoint + zone,
            0.5, 0.0, None,
        ))
    episodes.sort(key=lambda item: (item.contribution_index, item.episode_id))
    contributor_ids = tuple(item.basis_id for item in synthetic_basis)
    episode_ids = tuple(item.episode_id for item in episodes)
    derivation = stable_hash("baseline-memory-derivation", mode_id, contributor_ids, center, zone)
    mode = FieldMode(
        mode_id, derivation, "hline", role, "weak", "refined",
        center, center, zone, ridge.low_price, ridge.high_price,
        ridge.response_mass, 0.0, 0.0, 0.0, contributor_ids, episode_ids,
        (), contributor_ids,
    )
    probe = LineProbe(role, 0.0, center, 0, zone)
    integrity = integrity_for_domain(tape, features, probe, 0, len(tape.candles) - 1, config)
    start = min(contributor_indexes)
    end = max(contributor_indexes)
    candidate = BoundaryCandidate(
        stable_hash("baseline-memory-candidate", mode_id), "hline", role, "baseline_memory",
        mode_id, derivation, 0.0, 0, center, center, zone,
        start, end, (episode_ids[0], episode_ids[1]), episode_ids, end,
        0.45, integrity.integrity, integrity.body_integrity, integrity.close_integrity,
        integrity.fact_count, integrity.effective_fact_count, integrity.coverage,
        integrity.body_penetration_count, integrity.close_penetration_count,
        clamp((end - start + 1) / 96.0, 0.25, 1.0), (), None,
        max(config.display_min_rank_score, 0.45), ("baseline_memory",), tuple(episodes),
    )
    return DetectorResult(
        (*result.candidates, candidate), (*result.modes, mode), (*result.basis, *synthetic_basis),
        result.response_segments, result.profile_bins,
    )


def domains_to_dto(tape: CandleTape, domains: tuple[StructuralDomain, ...]) -> list[dict]:
    return [{
        "domainId": item.domain_id,
        "parentId": item.parent_id,
        "fromTimestamp": tape.candles[item.start_index].timestamp,
        "toTimestamp": tape.candles[item.end_index].timestamp,
        "startIndex": item.start_index,
        "endIndex": item.end_index,
        "depth": item.depth,
        "active": item.active,
        "fitLoss": item.fit_loss,
    } for item in domains if item.active]


def flows_to_dto(tape: CandleTape, flows: tuple[RegressionFlow, ...]) -> list[dict]:
    return [{
        "flowId": item.flow_id,
        "domainId": item.domain_id,
        "fromTimestamp": tape.candles[item.start_index].timestamp,
        "toTimestamp": tape.candles[item.end_index].timestamp,
        "startPrice": item.price(item.start_index),
        "endPrice": item.price(item.end_index),
        "slopePerBar": item.slope_per_bar,
        "corridorHalfWidth": item.corridor_half_width,
        "residualMad": item.residual_mad,
        "leverageMax": item.leverage_max,
    } for item in flows]


def memory_to_dto(memory: tuple[PriceMemoryRidge, ...]) -> list[dict]:
    return [{
        "ridgeId": item.ridge_id,
        "lowPrice": item.low_price,
        "highPrice": item.high_price,
        "centerPrice": item.center_price,
        "responseMass": item.response_mass,
        "contributorCount": len(item.contributor_indexes),
        # This is part of the selected PriceMemory provenance closure, not a
        # decorative sample. Keep the count and indexes lossless so browser
        # validation and hover explanations can reproduce the ridge.
        "contributorIndexes": list(item.contributor_indexes),
    } for item in memory[:4]]


def _ols(values: tuple[float, ...], start: int, end: int) -> tuple[float, float, float, float]:
    indexes = range(start, end + 1)
    count = end - start + 1
    center_x = (start + end) / 2.0
    center_y = math.fsum(values[index] for index in indexes) / count
    denominator = math.fsum((index - center_x) ** 2 for index in indexes)
    slope = 0.0 if denominator == 0 else math.fsum(
        (index - center_x) * (values[index] - center_y) for index in indexes
    ) / denominator
    intercept = center_y - slope * center_x
    residuals = [values[index] - (intercept + slope * index) for index in indexes]
    residual_center = median(residuals)
    residual_mad = median(abs(value - residual_center) for value in residuals)
    loss = math.fsum(value * value for value in residuals)
    return slope, intercept, residual_mad, loss


def _max_leverage(start: int, end: int) -> float:
    count = end - start + 1
    if count <= 1:
        return 1.0
    center = (start + end) / 2.0
    denominator = math.fsum((index - center) ** 2 for index in range(start, end + 1))
    return max(1.0 / count + (index - center) ** 2 / denominator for index in (start, end))


def _ols_loss(prefix_y, prefix_y2, prefix_xy, start: int, end: int) -> float:
    count = end - start + 1
    sum_x = (start + end) * count / 2.0
    before = (start - 1) * start * (2 * start - 1) / 6.0
    through = end * (end + 1) * (2 * end + 1) / 6.0
    sum_x2 = through - before
    sum_y = prefix_y[end + 1] - prefix_y[start]
    sum_y2 = prefix_y2[end + 1] - prefix_y2[start]
    sum_xy = prefix_xy[end + 1] - prefix_xy[start]
    denominator = count * sum_x2 - sum_x * sum_x
    slope = 0.0 if abs(denominator) <= 1e-18 else (
        count * sum_xy - sum_x * sum_y
    ) / denominator
    intercept = (sum_y - slope * sum_x) / count
    loss = (
        sum_y2
        + count * intercept * intercept
        + slope * slope * sum_x2
        + 2.0 * intercept * slope * sum_x
        - 2.0 * intercept * sum_y
        - 2.0 * slope * sum_xy
    )
    return max(0.0, loss)
