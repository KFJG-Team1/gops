from __future__ import annotations

from .config import CzardasConfig
from .features import FeatureTape
from .meaning import CandleMeaningTape, build_base_candle_meanings
from .numeric import clamp, stable_hash
from .tape import CandleTape
from .types import EvidenceAtom, EvidenceCluster, RoleBasis


def build_evidence(
    tape: CandleTape,
    features: FeatureTape,
    config: CzardasConfig,
    meanings: CandleMeaningTape | None = None,
) -> tuple[tuple[EvidenceCluster, ...], tuple[RoleBasis, ...]]:
    # PresentSnapshotContract evaluates one current exact-240 snapshot.
    as_of_index = len(tape.candles) - 1
    meanings = meanings or build_base_candle_meanings(tape, features, config)
    atoms = _raw_atoms(tape, features, config, as_of_index)
    clusters = _cluster_atoms(atoms, tape, features)
    basis: list[RoleBasis] = []
    for cluster in clusters:
        atom = cluster.representative
        role = _role_for_kind(atom.kind)
        if role is None:
            continue
        age = max(0, as_of_index - atom.bar_index)
        recency = 2.0 ** (-age / config.recency_half_life_bars)
        scale_score = {2: 0.35, 5: 0.70, 13: 1.0}[max(cluster.confirmed_scales)]
        if role in {"support", "resistance"}:
            hline_mass = clamp(
                0.40 * atom.prominence
                + 0.30 * atom.rejection
                + 0.20 * atom.body_integrity
                + 0.10 * recency
            )
            geometry_score = clamp(
                (0.40 * atom.prominence + 0.20 * atom.body_integrity + 0.10 * recency) / 0.70
            )
            snapshot_mass = (
                meanings.support[atom.bar_index] if role == "support" else meanings.resistance[atom.bar_index]
            )
            participation_multiplier = 1.0 if atom.participation is None else 0.90 + 0.10 * atom.participation
            role_mass = clamp(
                0.80 * hline_mass * participation_multiplier
                + 0.20 * snapshot_mass
            )
            participation = atom.participation
        else:
            structural_mass = clamp(0.50 * atom.prominence + 0.30 * scale_score + 0.20 * recency)
            snapshot_mass = meanings.lower[atom.bar_index] if role == "lower" else meanings.upper[atom.bar_index]
            role_mass = clamp(0.80 * structural_mass + 0.20 * snapshot_mass)
            geometry_score = role_mass
            participation = None
        basis.append(RoleBasis(
            basis_id=stable_hash("basis", tape.symbol, tape.interval, role, cluster.cluster_id),
            cluster_id=cluster.cluster_id,
            role=role,
            observed_at=atom.observed_at,
            confirmed_at=tape.candles[cluster.last_confirmed_index].timestamp,
            bar_index=atom.bar_index,
            confirmed_index=cluster.last_confirmed_index,
            endpoint_price=atom.endpoint_price,
            body_edge_price=atom.body_edge_price,
            corridor_low=atom.corridor_low,
            corridor_high=atom.corridor_high,
            role_mass=role_mass,
            geometry_score=geometry_score,
            rejection=atom.rejection,
            participation=participation,
            effective_scale=max(cluster.confirmed_scales),
        ))
    return tuple(clusters), tuple(sorted(basis, key=lambda item: (item.role, item.confirmed_index, item.basis_id)))


def _raw_atoms(
    tape: CandleTape,
    features: FeatureTape,
    config: CzardasConfig,
    as_of_index: int,
) -> list[EvidenceAtom]:
    candles = tape.candles
    result: list[EvidenceAtom] = []
    for radius in config.extrema_radii:
        highs: list[tuple[int, float, float]] = []
        lows: list[tuple[int, float, float]] = []
        for index in range(radius, min(as_of_index + 1, len(candles) - radius)):
            window = candles[index - radius:index + radius + 1]
            candle = candles[index]
            local_atr = features.atr_scale(index, candle.close)
            if (
                candle.high == max(item.high for item in window)
                and any(item.high < candle.high for item in candles[index - radius:index])
                and any(item.high < candle.high for item in candles[index + 1:index + radius + 1])
            ):
                prominence = min(
                    candle.high - min(item.low for item in candles[index - radius:index]),
                    candle.high - min(item.low for item in candles[index + 1:index + radius + 1]),
                ) / local_atr
                highs.append((index, candle.high, clamp(prominence / 1.5)))
            if (
                candle.low == min(item.low for item in window)
                and any(item.low > candle.low for item in candles[index - radius:index])
                and any(item.low > candle.low for item in candles[index + 1:index + radius + 1])
            ):
                prominence = min(
                    max(item.high for item in candles[index - radius:index]) - candle.low,
                    max(item.high for item in candles[index + 1:index + radius + 1]) - candle.low,
                ) / local_atr
                lows.append((index, candle.low, clamp(prominence / 1.5)))
        for side, values in (("high", _collapse_plateaus(highs)), ("low", _collapse_plateaus(lows))):
            for index, _price, prominence in values:
                if prominence <= 1e-12:
                    continue
                swing_confirmed = index + radius
                if swing_confirmed <= as_of_index:
                    result.append(_atom(tape, features, config, index, radius, prominence, side, swing_confirmed, rejection=False))
                reaction_confirmed = max(index + radius, index + 3)
                if reaction_confirmed <= as_of_index:
                    result.append(_atom(tape, features, config, index, radius, prominence, side, reaction_confirmed, rejection=True))
    return sorted(result, key=lambda item: (item.confirmed_index, -item.scale, -item.prominence, item.candle_key, item.evidence_id))


def _collapse_plateaus(values: list[tuple[int, float, float]]) -> list[tuple[int, float, float]]:
    result: list[tuple[int, float, float]] = []
    cursor = 0
    values = sorted(values)
    while cursor < len(values):
        group = [values[cursor]]
        cursor += 1
        while cursor < len(values) and values[cursor][0] == group[-1][0] + 1 and values[cursor][1] == group[-1][1]:
            group.append(values[cursor])
            cursor += 1
        result.append(max(group, key=lambda item: (item[2], item[0])))
    return result


def _atom(
    tape: CandleTape,
    features: FeatureTape,
    config: CzardasConfig,
    index: int,
    scale: int,
    prominence: float,
    side: str,
    confirmed_index: int,
    *,
    rejection: bool,
) -> EvidenceAtom:
    candle = tape.candles[index]
    local_atr = features.atr_scale(index, candle.close)
    if side == "high":
        endpoint = candle.high
        body_edge = features.body_high[index]
        corridor_low, corridor_high = body_edge, endpoint
        body_integrity = clamp((endpoint - body_edge) / (0.50 * local_atr))
        rejection_value = clamp(max(endpoint - item.close for item in tape.candles[index + 1:index + 4]) / local_atr)
        kind = "rejectionHigh" if rejection else "swingHigh"
    else:
        endpoint = candle.low
        body_edge = features.body_low[index]
        corridor_low, corridor_high = endpoint, body_edge
        body_integrity = clamp((body_edge - endpoint) / (0.50 * local_atr))
        rejection_value = clamp(max(item.close - endpoint for item in tape.candles[index + 1:index + 4]) / local_atr)
        kind = "rejectionLow" if rejection else "swingLow"
    return EvidenceAtom(
        evidence_id=stable_hash(tape.symbol, tape.interval, kind, candle.candle_key, scale),
        kind=kind,
        candle_key=candle.candle_key,
        observed_at=candle.timestamp,
        confirmed_at=tape.candles[confirmed_index].timestamp,
        bar_index=index,
        confirmed_index=confirmed_index,
        endpoint_price=endpoint,
        body_edge_price=body_edge,
        corridor_low=corridor_low,
        corridor_high=corridor_high,
        scale=scale,
        prominence=prominence,
        rejection=rejection_value if rejection else 0.0,
        body_integrity=body_integrity,
        participation=features.participation[index] if index >= config.volume_baseline else None,
    )


def _cluster_atoms(atoms: list[EvidenceAtom], tape: CandleTape, features: FeatureTape) -> list[EvidenceCluster]:
    clusters: list[tuple[EvidenceAtom, list[EvidenceAtom]]] = []
    for atom in atoms:
        target: int | None = None
        for index, (representative, _members) in enumerate(clusters):
            if representative.kind != atom.kind or abs(representative.bar_index - atom.bar_index) > 2:
                continue
            tolerance = 0.25 * max(
                features.atr_scale(representative.bar_index, tape.candles[representative.bar_index].close),
                features.atr_scale(atom.bar_index, tape.candles[atom.bar_index].close),
            )
            corridor_overlap = max(representative.corridor_low, atom.corridor_low) <= min(representative.corridor_high, atom.corridor_high)
            if corridor_overlap or abs(representative.endpoint_price - atom.endpoint_price) <= tolerance:
                target = index
                break
        if target is None:
            clusters.append((atom, [atom]))
        else:
            clusters[target][1].append(atom)
    return [
        EvidenceCluster(
            cluster_id=stable_hash("nms", tape.symbol, tape.interval, representative.kind, representative.evidence_id),
            kind=representative.kind,
            representative=representative,
            confirmed_scales=tuple(sorted({member.scale for member in members})),
            last_confirmed_index=max(member.confirmed_index for member in members),
        )
        for representative, members in clusters
    ]


def _role_for_kind(kind: str):
    return {
        "rejectionLow": "support",
        "rejectionHigh": "resistance",
        "swingLow": "lower",
        "swingHigh": "upper",
    }.get(kind)
