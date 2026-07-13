from __future__ import annotations

import math
from dataclasses import dataclass

from .config import CzardasConfig
from .features import FeatureTape
from .numeric import bounded, clamp, stable_hash, weighted_median
from .tape import CandleTape
from .types import FormationEpisode, InteractionEvent, Role, RoleBasis


@dataclass(frozen=True, slots=True)
class LineProbe:
    role: Role
    slope: float
    intercept: float
    origin_index: int
    zone: float

    def price(self, index: int) -> float:
        return self.intercept + self.slope * (index - self.origin_index)

    @property
    def lower_side(self) -> bool:
        return self.role in {"support", "lower"}


def formation_episodes(
    tape: CandleTape,
    features: FeatureTape,
    basis: list[RoleBasis],
    probe: LineProbe,
    field_mode_id: str,
    config: CzardasConfig,
) -> list[FormationEpisode]:
    ordered = sorted(basis, key=lambda item: (item.bar_index, item.confirmed_index, item.cluster_id))
    if not ordered:
        return []
    groups: list[list[RoleBasis]] = [[ordered[0]]]
    for item in ordered[1:]:
        previous = groups[-1][-1]
        leave = _first_leave(tape, features, probe, previous.bar_index + 1, item.bar_index, config)
        if leave is not None and item.bar_index > leave:
            groups.append([item])
        else:
            groups[-1].append(item)
    episodes: list[FormationEpisode] = []
    for members in groups:
        median_price = weighted_median([(item.endpoint_price, item.role_mass, item.basis_id) for item in members])
        contribution = min(
            (item for item in members if item.endpoint_price == median_price),
            key=lambda item: item.basis_id,
        )
        atr = features.atr_scale(contribution.bar_index, tape.candles[contribution.bar_index].close)
        tolerance = max(2 * max(0.01, tape.candles[contribution.bar_index].close * 1e-6), config.touch_tolerance_atr * atr)
        episodes.append(FormationEpisode(
            episode_id=stable_hash(
                "formation", tape.symbol, tape.interval, probe.role, field_mode_id, members[0].cluster_id
            ),
            field_mode_id=field_mode_id,
            role=probe.role,
            member_basis_ids=tuple(item.basis_id for item in members),
            contribution_basis_id=contribution.basis_id,
            observed_from_index=min(item.bar_index for item in members),
            observed_to_index=max(item.bar_index for item in members),
            confirmed_index=max(item.confirmed_index for item in members),
            contribution_price=contribution.endpoint_price,
            corridor_low=contribution.corridor_low - tolerance,
            corridor_high=contribution.corridor_high + tolerance,
            contribution_mass=math.fsum(item.role_mass for item in members) / len(members),
            rejection=math.fsum(item.rejection for item in members) / len(members),
            participation=(
                None
                if all(item.participation is None for item in members)
                else math.fsum(item.participation or 0.0 for item in members) / len(members)
            ),
        ))
    return episodes


def integrity_for_domain(
    tape: CandleTape,
    features: FeatureTape,
    probe: LineProbe,
    start_index: int,
    end_index: int,
    config: CzardasConfig,
) -> tuple[float, float, float, int, int]:
    fact_indexes: list[int] = []
    raw_facts: list[float] = []
    body_facts: list[float] = []
    close_facts: list[float] = []
    body_penetrations = close_penetrations = 0
    candles = tape.candles
    atr_values = features.effective_atr
    body_lows = features.body_low
    body_highs = features.body_high
    slope = probe.slope
    intercept = probe.intercept
    origin = probe.origin_index
    zone = probe.zone
    lower_side = probe.role in {"support", "lower"}
    start = max(0, start_index)
    stop = min(end_index, len(candles) - 1) + 1
    for index in range(start, stop):
        candle = candles[index]
        atr = atr_values[index]
        y = intercept + slope * (index - origin)
        if lower_side:
            lower_edge = y - zone
            wick_depth = max(0.0, lower_edge - candle.low) / atr
            body_depth = max(0.0, lower_edge - body_lows[index]) / atr
            close_depth = max(0.0, lower_edge - candle.close) / atr
            distance = max(0.0, candle.low - (y + zone), lower_edge - candle.high) / atr
        else:
            upper_edge = y + zone
            wick_depth = max(0.0, candle.high - upper_edge) / atr
            body_depth = max(0.0, body_highs[index] - upper_edge) / atr
            close_depth = max(0.0, candle.close - upper_edge) / atr
            distance = max(0.0, candle.low - upper_edge, (y - zone) - candle.high) / atr
        if distance > 1.0 and wick_depth == 0 and body_depth == 0 and close_depth == 0:
            continue
        if body_depth > 0:
            body_penetrations += 1
        if close_depth > 0:
            close_penetrations += 1
        raw = max(wick_depth, 4.0 * body_depth, 8.0 * close_depth)
        body_raw = 4.0 * body_depth
        close_raw = 8.0 * close_depth
        fact_indexes.append(index)
        raw_facts.append(raw / (1.0 + raw))
        body_facts.append(body_raw / (1.0 + body_raw))
        close_facts.append(close_raw / (1.0 + close_raw))
    if not fact_indexes:
        return 0.0, 0.0, 0.0, 0, 0
    raw_weights = [2.0 ** (-(end_index - index) / config.recency_half_life_bars) for index in fact_indexes]
    total = math.fsum(raw_weights)
    influences = [min(weight / total, config.max_single_bar_integrity_influence) for weight in raw_weights]
    integrity = clamp(1.0 - math.fsum(weight * raw_facts[index] for index, weight in enumerate(influences)))
    body_integrity = clamp(1.0 - math.fsum(weight * body_facts[index] for index, weight in enumerate(influences)))
    close_integrity = clamp(1.0 - math.fsum(weight * close_facts[index] for index, weight in enumerate(influences)))
    return integrity, body_integrity, close_integrity, body_penetrations, close_penetrations


def has_open_break(
    tape: CandleTape,
    features: FeatureTape,
    probe: LineProbe,
    end_index: int,
    config: CzardasConfig,
) -> bool:
    if end_index < 1:
        return False
    return all(
        _close_depth(tape, features, probe, index) > config.break_close_atr
        for index in (end_index - 1, end_index)
    )


def evaluate_interactions(
    tape: CandleTape,
    features: FeatureTape,
    probe: LineProbe,
    candidate_id: str,
    fit_evidence_confirmed_index: int,
    formation_span: int,
    config: CzardasConfig,
) -> tuple[InteractionEvent, ...]:
    horizon = 3 if formation_span < 48 else 5 if formation_span < 96 else 8
    events: list[InteractionEvent] = []
    cursor = fit_evidence_confirmed_index + 1
    while cursor < len(tape.candles):
        contact = None
        for index in range(cursor, len(tape.candles)):
            if _is_contact(tape, features, probe, index):
                contact = index
                break
        if contact is None:
            break
        break_index = _break_index(tape, features, probe, contact, len(tape.candles) - 1, config)
        terminal_target = contact + horizon
        if break_index is not None and break_index <= terminal_target:
            events.append(InteractionEvent(
                stable_hash(candidate_id, probe.role, tape.candles[contact].candle_key),
                contact, break_index, None, "confirmed_break", 0.0, 1.0, 0.0,
            ))
            break
        if terminal_target >= len(tape.candles):
            events.append(InteractionEvent(
                stable_hash(candidate_id, probe.role, tape.candles[contact].candle_key),
                contact, None, None, "response_pending", 0.0, 0.0, 0.0,
            ))
            break
        atr = features.atr_scale(contact, tape.candles[contact].close)
        pressures: list[float] = []
        acceptances: list[float] = []
        excursions: list[float] = []
        reclaim_lag: int | None = None
        for index in range(contact, terminal_target + 1):
            candle = tape.candles[index]
            y = probe.price(index)
            if probe.lower_side:
                wick_depth = max(0.0, y - probe.zone - candle.low) / atr
                body_depth = max(0.0, y - probe.zone - features.body_low[index]) / atr
                close_depth = max(0.0, y - probe.zone - candle.close) / atr
                valid_close = candle.close >= y - probe.zone
                excursion = max(0.0, candle.close - y) / atr
            else:
                wick_depth = max(0.0, candle.high - y - probe.zone) / atr
                body_depth = max(0.0, features.body_high[index] - y - probe.zone) / atr
                close_depth = max(0.0, candle.close - y - probe.zone) / atr
                valid_close = candle.close <= y + probe.zone
                excursion = max(0.0, y - candle.close) / atr
            pressures.append(bounded(wick_depth))
            acceptances.append(max(bounded(4 * body_depth), bounded(8 * close_depth)))
            if index > contact:
                excursions.append(excursion)
            if valid_close and reclaim_lag is None:
                reclaim_lag = index - contact
        pressure = max(pressures, default=0.0)
        acceptance = math.fsum(acceptances) / len(acceptances)
        reclaim_speed = 0.0 if reclaim_lag is None else 1.0 - reclaim_lag / (horizon + 1)
        excursion = max(excursions, default=0.0)
        score = clamp(0.45 * excursion + 0.30 * (1.0 - acceptance) + 0.25 * pressure * reclaim_speed * (1.0 - acceptance))
        outcome = "supported_response" if excursion >= config.response_min_excursion_atr and score >= config.response_min_score else "neutral_response"
        leave = _first_leave(tape, features, probe, terminal_target + 1, len(tape.candles), config)
        events.append(InteractionEvent(
            stable_hash(candidate_id, probe.role, tape.candles[contact].candle_key),
            contact, terminal_target, leave, outcome, pressure, acceptance, score,
        ))
        if break_index is not None and (leave is None or break_index <= leave):
            events.append(InteractionEvent(
                stable_hash(candidate_id, probe.role, tape.candles[break_index - 1].candle_key),
                break_index - 1, break_index, None, "confirmed_break", 0.0, 1.0, 0.0,
            ))
            break
        if leave is None:
            break
        cursor = leave + 1
    return tuple(events)


def _first_leave(
    tape: CandleTape,
    features: FeatureTape,
    probe: LineProbe,
    start: int,
    stop: int,
    config: CzardasConfig,
) -> int | None:
    valid_run = 0
    for index in range(max(0, start), min(stop, len(tape.candles))):
        candle = tape.candles[index]
        atr = features.atr_scale(index, candle.close)
        y = probe.price(index)
        if probe.lower_side:
            far = candle.close >= y + probe.zone + config.episode_leave_atr * atr
            outside = candle.close > y + probe.zone
        else:
            far = candle.close <= y - probe.zone - config.episode_leave_atr * atr
            outside = candle.close < y - probe.zone
        valid_run = valid_run + 1 if outside else 0
        if far or valid_run >= 3:
            return index
    return None


def _is_contact(tape: CandleTape, features: FeatureTape, probe: LineProbe, index: int) -> bool:
    candle = tape.candles[index]
    y = probe.price(index)
    return candle.low <= y + probe.zone and candle.high >= y - probe.zone


def _close_depth(tape: CandleTape, features: FeatureTape, probe: LineProbe, index: int) -> float:
    candle = tape.candles[index]
    atr = features.atr_scale(index, candle.close)
    y = probe.price(index)
    if probe.lower_side:
        return max(0.0, y - probe.zone - candle.close) / atr
    return max(0.0, candle.close - y - probe.zone) / atr


def _break_index(
    tape: CandleTape,
    features: FeatureTape,
    probe: LineProbe,
    start: int,
    end: int,
    config: CzardasConfig,
) -> int | None:
    run = 0
    for index in range(start, end + 1):
        run = run + 1 if _close_depth(tape, features, probe, index) > config.break_close_atr else 0
        if run >= config.break_consecutive_closes:
            return index
    return None
