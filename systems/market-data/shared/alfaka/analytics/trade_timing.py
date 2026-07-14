from __future__ import annotations

import statistics
from typing import Any


TRADE_TIMING_VERSION = "pattern-trade-timing-v3"
DEFAULT_BREAKOUT_BUFFER_ATR = 0.25
DEFAULT_STOP_DISTANCE_ATR = 1.0
DEFAULT_MINIMUM_REWARD_RISK = 2.0
DEFAULT_PROJECTION_BARS = 10
DEFAULT_VOLUME_CONFIRMATION_RATIO = 1.5
DEFAULT_HOLD_CONFIRMATION_BARS = 1
DEFAULT_RETEST_BARS = 5
DEFAULT_TARGET_ALLOCATION_PERCENT = 50
DEFAULT_MINIMUM_TARGET_ONE_R = 0.75

_BULLISH_KINDS = {
    "ascending_triangle",
    "bullish_flag",
    "bullish_pennant",
    "bullish_rectangle",
    "falling_wedge",
    "descending_channel_breakout",
}
_BEARISH_KINDS = {
    "descending_triangle",
    "bearish_flag",
    "bearish_pennant",
    "bearish_rectangle",
    "rising_wedge",
    "ascending_channel_breakdown",
}
_POLE_TARGET_KINDS = {"bullish_flag", "bearish_flag", "bullish_pennant", "bearish_pennant"}


def evaluate_pattern_trade_timing(
    candles: list[dict[str, Any]],
    pattern: dict[str, Any] | None,
    *,
    atr: float,
    symbol: str,
    interval: str,
    supports: list[dict[str, Any]] | None = None,
    resistances: list[dict[str, Any]] | None = None,
    minimum_reward_risk: float = DEFAULT_MINIMUM_REWARD_RISK,
    long_only: bool = True,
    projection_bars: int = DEFAULT_PROJECTION_BARS,
    retest_bars: int = DEFAULT_RETEST_BARS,
) -> dict[str, Any] | None:
    """Convert one detected pattern into a closed-candle chart scenario.

    The payload is an annotation plan only. It never places an order and never
    invents future candles; projection is expressed as a bar count.
    """

    if pattern is None:
        return None
    rows = [dict(row) for row in candles if row.get("isClosed", row.get("is_closed", True)) is not False]
    normalized_symbol = symbol.strip().upper()
    if not rows:
        return _empty_plan(
            pattern, minimum_reward_risk, projection_bars, "no_completed_candles",
            symbol=normalized_symbol, interval=interval,
        )

    kind = str(pattern.get("kind") or "")
    state = str(pattern.get("state") or "")
    atr_value = float(atr)
    if atr_value <= 0:
        return _empty_plan(
            pattern, minimum_reward_risk, projection_bars, "invalid_atr",
            symbol=normalized_symbol, interval=interval,
        )
    if not pattern.get("upper") or not pattern.get("lower"):
        return _empty_plan(
            pattern, minimum_reward_risk, projection_bars, "missing_pattern_boundaries",
            symbol=normalized_symbol, interval=interval,
        )

    if state == "forming":
        return _forming_plan(
            rows,
            pattern,
            atr=atr_value,
            symbol=normalized_symbol,
            interval=interval,
            minimum_reward_risk=minimum_reward_risk,
            projection_bars=projection_bars,
        )
    if state != "confirmed":
        return _empty_plan(
            pattern, minimum_reward_risk, projection_bars, "pattern_not_active",
            symbol=normalized_symbol, interval=interval,
            phase="invalidated" if state == "invalidated" else "expired",
            confirmation_conditions=_confirmation_conditions(rows, pattern, atr=atr_value),
        )

    expected_direction = _expected_direction(kind, pattern.get("breakoutDirection"))
    actual_direction = pattern.get("breakoutDirection")
    if expected_direction is None or actual_direction != expected_direction:
        return _empty_plan(
            pattern, minimum_reward_risk, projection_bars, "breakout_direction_mismatch",
            symbol=normalized_symbol, interval=interval,
            phase="invalidated",
        )

    signal = _resolve_confirmed_breakout(rows, pattern, direction=str(actual_direction), atr=atr_value)
    if signal is None:
        return _empty_plan(
            pattern, minimum_reward_risk, projection_bars, "confirmed_state_without_current_breakout",
            symbol=normalized_symbol, interval=interval,
        )
    breakout_index, confirmed_index, breakout_level, confirmation_method, volume_ratio = signal
    breakout_row = rows[breakout_index]
    confirmed_row = rows[confirmed_index]
    condition = _confirmation_condition(direction=str(actual_direction), boundary_price=breakout_level, atr=atr_value)
    confirmation_evidence = _confirmation_evidence(
        condition,
        breakout_at=str(breakout_row["timestamp"]),
        confirmed_at=str(confirmed_row["timestamp"]),
        method=confirmation_method,
        volume_ratio=volume_ratio,
    )
    reasons = [
        "confirmed_upward_breakout" if actual_direction == "up" else "confirmed_downward_breakout",
        f"confirmation_{confirmation_method}",
    ]

    if actual_direction == "down" and long_only:
        reasons.append("long_position_exit_only")
        return _empty_plan(
            pattern, minimum_reward_risk, projection_bars, reasons[0],
            symbol=normalized_symbol,
            interval=interval,
            action="sell_candidate",
            direction="exit_long",
            phase="confirmed",
            signal_at=str(confirmed_row["timestamp"]),
            confirmation_conditions=[condition],
            confirmation_evidence=confirmation_evidence,
            reasons=reasons,
        )

    retest = _find_retest(
        rows,
        pattern,
        confirmed_index=confirmed_index,
        direction=str(actual_direction),
        atr=atr_value,
        max_bars=max(1, int(retest_bars)),
    )
    if retest["state"] == "confirmed":
        entry_index = int(retest["barIndex"])
        entry_mode = "retest_close"
        reasons.append("retest_entry")
    else:
        entry_index = confirmed_index
        entry_mode = "confirmation_close"
        reasons.append("confirmation_close_entry")
    entry_row = rows[entry_index]
    entry_price = float(entry_row["close"])

    upper_price = _boundary_price(pattern["upper"], rows, entry_index)
    lower_price = _boundary_price(pattern["lower"], rows, entry_index)
    measured_move = _measured_move(pattern)
    if upper_price is None or lower_price is None or measured_move <= 0:
        return _empty_plan(
            pattern, minimum_reward_risk, projection_bars, "invalid_pattern_geometry",
            symbol=normalized_symbol,
            interval=interval,
            phase="invalidated",
            signal_at=str(confirmed_row["timestamp"]),
            confirmation_conditions=[condition],
            confirmation_evidence=confirmation_evidence,
        )

    buffer = DEFAULT_BREAKOUT_BUFFER_ATR * atr_value
    if actual_direction == "up":
        structural_stop = lower_price - buffer
        tactical_stop = (
            float(entry_row["low"]) - buffer
            if entry_mode == "retest_close"
            else breakout_level - DEFAULT_STOP_DISTANCE_ATR * atr_value
        )
        stop_price = max(structural_stop, tactical_stop)
        stop_basis = "pattern_structure" if stop_price == structural_stop else (
            "retest_swing_atr" if entry_mode == "retest_close" else "breakout_boundary_atr"
        )
        target_two_price = breakout_level + measured_move
        direction = "long"
        action = "buy_candidate"
    else:
        structural_stop = upper_price + buffer
        tactical_stop = (
            float(entry_row["high"]) + buffer
            if entry_mode == "retest_close"
            else breakout_level + DEFAULT_STOP_DISTANCE_ATR * atr_value
        )
        stop_price = min(structural_stop, tactical_stop)
        stop_basis = "pattern_structure" if stop_price == structural_stop else (
            "retest_swing_atr" if entry_mode == "retest_close" else "breakout_boundary_atr"
        )
        target_two_price = breakout_level - measured_move
        direction = "short"
        action = "short_candidate"

    risk = abs(entry_price - stop_price)
    valid_orientation = (
        stop_price < entry_price <= target_two_price
        if actual_direction == "up"
        else target_two_price <= entry_price < stop_price
    )
    if not valid_orientation or risk <= 0:
        return _empty_plan(
            pattern, minimum_reward_risk, projection_bars, "invalid_risk_geometry",
            symbol=normalized_symbol,
            interval=interval,
            phase="invalidated",
            signal_at=str(confirmed_row["timestamp"]),
            confirmation_conditions=[condition],
            confirmation_evidence=confirmation_evidence,
        )

    target_one_price, target_one_basis = _target_one(
        entry_price,
        risk,
        direction=str(actual_direction),
        supports=supports or [],
        resistances=resistances or [],
    )
    target_one_r = abs(target_one_price - entry_price) / risk
    target_two_r = abs(target_two_price - entry_price) / risk
    reward = abs(target_two_price - entry_price)
    targets = [
        _target("T1", target_one_price, target_one_basis, target_one_r),
        _target("T2", target_two_price, "measured_move", target_two_r),
    ]
    target_ladder_valid = (
        entry_price < target_one_price < target_two_price
        if actual_direction == "up"
        else target_two_price < target_one_price < entry_price
    )
    if target_one_r < DEFAULT_MINIMUM_TARGET_ONE_R:
        action = "no_trade"
        direction = None
        reasons.append("opposing_level_too_close")
    elif not target_ladder_valid:
        action = "no_trade"
        direction = None
        reasons.append("target_ladder_invalid")
    elif target_two_r < minimum_reward_risk:
        action = "no_trade"
        direction = None
        reasons.append("reward_risk_below_minimum")
    else:
        reasons.append("reward_risk_passed")

    phase = "retest_confirmed" if entry_mode == "retest_close" else "confirmed"
    active_stop_price = stop_price
    if action in {"buy_candidate", "short_candidate"}:
        phase = _scenario_phase(
            rows,
            entry_index=entry_index,
            direction=str(actual_direction),
            stop_price=stop_price,
            target_one_price=target_one_price,
            target_two_price=target_two_price,
            projection_bars=max(1, int(projection_bars)),
            fallback=phase,
        )
        if phase in {"t1_reached", "t2_reached"}:
            active_stop_price = entry_price
            reasons.append("protective_stop_moved_to_entry")
        elif phase == "invalidated":
            reasons.append("stop_reached")
        elif phase == "expired":
            action = "no_trade"
            direction = None
            reasons.append("scenario_expired")

    return {
        "version": TRADE_TIMING_VERSION,
        "symbol": normalized_symbol,
        "interval": interval,
        "patternId": str(pattern.get("id") or pattern.get("geometryHash") or kind),
        "patternKind": kind,
        "patternState": state,
        "action": action,
        "direction": direction,
        "phase": phase,
        "signalAt": str(confirmed_row["timestamp"]),
        "entryTrigger": condition["triggerPrice"],
        "confirmationConditions": [condition],
        "confirmationEvidence": confirmation_evidence,
        "entryPlan": {
            "mode": entry_mode,
            "at": str(entry_row["timestamp"]),
            "price": _rounded(entry_price),
        },
        "stopPlan": {
            "initialPrice": _rounded(stop_price),
            "activePrice": _rounded(active_stop_price),
            "basis": stop_basis,
            "bufferAtr": DEFAULT_BREAKOUT_BUFFER_ATR if entry_mode == "retest_close" else DEFAULT_STOP_DISTANCE_ATR,
        },
        "targets": targets,
        "retest": _public_retest(retest),
        "entryPrice": _rounded(entry_price),
        "stopPrice": _rounded(active_stop_price),
        "targetPrice": _rounded(target_two_price),
        "riskPerShare": _rounded(risk),
        "rewardPerShare": _rounded(reward),
        "rewardRiskRatio": round(target_two_r, 4),
        "minimumRewardRisk": float(minimum_reward_risk),
        "projectionBars": max(1, int(projection_bars)),
        "reasons": reasons,
    }


def _forming_plan(
    rows: list[dict[str, Any]],
    pattern: dict[str, Any],
    *,
    atr: float,
    symbol: str,
    interval: str,
    minimum_reward_risk: float,
    projection_bars: int,
) -> dict[str, Any]:
    breakout_at = pattern.get("breakoutAt")
    breakout_direction = pattern.get("breakoutDirection")
    breakout_index = _index_for_timestamp(rows, breakout_at)
    pending = breakout_index is not None and breakout_direction in {"up", "down"}
    if pending:
        boundary_name = "upper" if breakout_direction == "up" else "lower"
        boundary_price = _boundary_price(pattern[boundary_name], rows, breakout_index)
        condition = (
            _confirmation_condition(direction=str(breakout_direction), boundary_price=boundary_price, atr=atr)
            if boundary_price is not None else None
        )
        conditions = [condition] if condition else []
        evidence = (
            _confirmation_evidence(
                condition,
                breakout_at=str(breakout_at),
                confirmed_at=None,
                method=None,
                volume_ratio=float(pattern.get("volumeRatio") or 0),
            )
            if condition else None
        )
        return _empty_plan(
            pattern, minimum_reward_risk, projection_bars, "breakout_confirmation_pending",
            symbol=symbol,
            interval=interval,
            action="watch",
            phase="confirmation_pending",
            signal_at=str(breakout_at),
            confirmation_conditions=conditions,
            confirmation_evidence=evidence,
        )
    return _empty_plan(
        pattern, minimum_reward_risk, projection_bars, "pattern_not_confirmed",
        symbol=symbol,
        interval=interval,
        action="watch",
        phase="forming",
        confirmation_conditions=_confirmation_conditions(rows, pattern, atr=atr),
    )


def _resolve_confirmed_breakout(
    rows: list[dict[str, Any]], pattern: dict[str, Any], *, direction: str, atr: float,
) -> tuple[int, int, float, str, float] | None:
    breakout_index = _index_for_timestamp(rows, pattern.get("breakoutAt"))
    confirmed_index = _index_for_timestamp(rows, pattern.get("confirmedAt"))
    method = pattern.get("confirmationMethod")
    if breakout_index is None:
        fallback = _find_current_breakout(rows, pattern, direction=direction, buffer=DEFAULT_BREAKOUT_BUFFER_ATR * atr)
        if fallback is None:
            return None
        breakout_index, breakout_level = fallback
        confirmed_index = breakout_index
        volume_ratio = _volume_ratio(rows, breakout_index)
        method = "volume" if volume_ratio >= DEFAULT_VOLUME_CONFIRMATION_RATIO else "hold"
        return breakout_index, confirmed_index, breakout_level, str(method), volume_ratio
    boundary_name = "upper" if direction == "up" else "lower"
    breakout_level = _boundary_price(pattern[boundary_name], rows, breakout_index)
    if breakout_level is None:
        return None
    if confirmed_index is None:
        confirmed_index = breakout_index + (1 if method == "hold" else 0)
    if confirmed_index >= len(rows):
        return None
    resolved_method = str(method) if method in {"volume", "hold"} else "hold"
    return (
        breakout_index,
        confirmed_index,
        breakout_level,
        resolved_method,
        float(pattern.get("volumeRatio") or _volume_ratio(rows, breakout_index)),
    )


def _find_retest(
    rows: list[dict[str, Any]],
    pattern: dict[str, Any],
    *,
    confirmed_index: int,
    direction: str,
    atr: float,
    max_bars: int,
) -> dict[str, Any]:
    boundary_name = "upper" if direction == "up" else "lower"
    end = min(len(rows), confirmed_index + max_bars + 1)
    for index in range(confirmed_index + 1, end):
        boundary = _boundary_price(pattern[boundary_name], rows, index)
        if boundary is None:
            continue
        trigger = boundary + DEFAULT_BREAKOUT_BUFFER_ATR * atr if direction == "up" else boundary - DEFAULT_BREAKOUT_BUFFER_ATR * atr
        row = rows[index]
        if direction == "up":
            valid = (
                float(row["low"]) <= trigger
                and float(row["low"]) >= boundary - DEFAULT_BREAKOUT_BUFFER_ATR * atr
                and float(row["close"]) >= trigger
            )
            zone_low, zone_high = boundary - DEFAULT_BREAKOUT_BUFFER_ATR * atr, trigger
        else:
            valid = (
                float(row["high"]) >= trigger
                and float(row["high"]) <= boundary + DEFAULT_BREAKOUT_BUFFER_ATR * atr
                and float(row["close"]) <= trigger
            )
            zone_low, zone_high = trigger, boundary + DEFAULT_BREAKOUT_BUFFER_ATR * atr
        if valid:
            return {
                "state": "confirmed",
                "barIndex": index,
                "at": str(row["timestamp"]),
                "zoneLow": _rounded(zone_low),
                "zoneHigh": _rounded(zone_high),
                "observedBars": index - confirmed_index,
                "maxBars": max_bars,
            }
    observed = max(0, len(rows) - 1 - confirmed_index)
    return {
        "state": "expired" if observed >= max_bars else "pending",
        "barIndex": None,
        "at": None,
        "zoneLow": None,
        "zoneHigh": None,
        "observedBars": min(observed, max_bars),
        "maxBars": max_bars,
    }


def _target_one(
    entry_price: float,
    risk: float,
    *,
    direction: str,
    supports: list[dict[str, Any]],
    resistances: list[dict[str, Any]],
) -> tuple[float, str]:
    if direction == "up":
        one_r = entry_price + risk
        obstacles = sorted(
            float(item.get("zoneLow", item.get("price")))
            for item in resistances
            if item.get("zoneLow", item.get("price")) is not None
            and float(item.get("zoneLow", item.get("price"))) > entry_price
        )
        if obstacles and obstacles[0] < one_r:
            return obstacles[0], "nearest_opposing_level"
        return one_r, "one_r"
    one_r = entry_price - risk
    obstacles = sorted((
        float(item.get("zoneHigh", item.get("price")))
        for item in supports
        if item.get("zoneHigh", item.get("price")) is not None
        and float(item.get("zoneHigh", item.get("price"))) < entry_price
    ), reverse=True)
    if obstacles and obstacles[0] > one_r:
        return obstacles[0], "nearest_opposing_level"
    return one_r, "one_r"


def _scenario_phase(
    rows: list[dict[str, Any]],
    *,
    entry_index: int,
    direction: str,
    stop_price: float,
    target_one_price: float,
    target_two_price: float,
    projection_bars: int,
    fallback: str,
) -> str:
    for row in rows[entry_index + 1:]:
        if direction == "up":
            if float(row["low"]) <= stop_price:
                return "invalidated"
            if float(row["high"]) >= target_two_price:
                return "t2_reached"
            if float(row["high"]) >= target_one_price:
                return "t1_reached"
        else:
            if float(row["high"]) >= stop_price:
                return "invalidated"
            if float(row["low"]) <= target_two_price:
                return "t2_reached"
            if float(row["low"]) <= target_one_price:
                return "t1_reached"
    if len(rows) - 1 - entry_index >= projection_bars:
        return "expired"
    return fallback


def _confirmation_conditions(
    rows: list[dict[str, Any]], pattern: dict[str, Any], *, atr: float,
) -> list[dict[str, Any]]:
    if atr <= 0 or not rows or not pattern.get("upper") or not pattern.get("lower"):
        return []
    kind = str(pattern.get("kind") or "")
    breakout_direction = pattern.get("breakoutDirection")
    expected = _expected_direction(kind, breakout_direction)
    directions = [expected] if expected in {"up", "down"} else ["up", "down"] if kind == "symmetrical_triangle" else []
    result: list[dict[str, Any]] = []
    for direction in directions:
        boundary_name = "upper" if direction == "up" else "lower"
        boundary_price = _boundary_price(pattern[boundary_name], rows, len(rows) - 1)
        if boundary_price is not None:
            result.append(_confirmation_condition(direction=direction, boundary_price=boundary_price, atr=atr))
    return result


def _confirmation_condition(*, direction: str, boundary_price: float, atr: float) -> dict[str, Any]:
    buffer = DEFAULT_BREAKOUT_BUFFER_ATR * atr
    trigger_price = boundary_price + buffer if direction == "up" else boundary_price - buffer
    return {
        "direction": direction,
        "boundary": "upper" if direction == "up" else "lower",
        "boundaryPrice": _rounded(boundary_price),
        "triggerPrice": _rounded(trigger_price),
        "bufferAtr": DEFAULT_BREAKOUT_BUFFER_ATR,
        "rule": "completed_close_above" if direction == "up" else "completed_close_below",
    }


def _confirmation_evidence(
    condition: dict[str, Any],
    *,
    breakout_at: str,
    confirmed_at: str | None,
    method: str | None,
    volume_ratio: float,
) -> dict[str, Any]:
    return {
        "direction": condition["direction"],
        "boundaryPrice": condition["boundaryPrice"],
        "triggerPrice": condition["triggerPrice"],
        "breakoutAt": breakout_at,
        "confirmedAt": confirmed_at,
        "method": method,
        "volumeRatio": round(float(volume_ratio), 4),
        "requiredVolumeRatio": DEFAULT_VOLUME_CONFIRMATION_RATIO,
        "holdBars": DEFAULT_HOLD_CONFIRMATION_BARS,
    }


def _target(identifier: str, price: float, basis: str, r_multiple: float) -> dict[str, Any]:
    return {
        "id": identifier,
        "price": _rounded(price),
        "basis": basis,
        "allocationPercent": DEFAULT_TARGET_ALLOCATION_PERCENT,
        "rMultiple": round(r_multiple, 4),
    }


def _public_retest(value: dict[str, Any]) -> dict[str, Any]:
    return {key: value[key] for key in ("state", "at", "zoneLow", "zoneHigh", "observedBars", "maxBars")}


def _expected_direction(kind: str, breakout_direction: Any) -> str | None:
    if kind in _BULLISH_KINDS:
        return "up"
    if kind in _BEARISH_KINDS:
        return "down"
    if kind == "symmetrical_triangle" and breakout_direction in {"up", "down"}:
        return str(breakout_direction)
    return None


def _find_current_breakout(
    rows: list[dict[str, Any]], pattern: dict[str, Any], *, direction: str, buffer: float,
) -> tuple[int, float] | None:
    for index in range(max(0, len(rows) - 2), len(rows)):
        boundary_name = "upper" if direction == "up" else "lower"
        boundary_price = _boundary_price(pattern[boundary_name], rows, index)
        if boundary_price is None:
            continue
        close = float(rows[index]["close"])
        if (direction == "up" and close > boundary_price + buffer) or (
            direction == "down" and close < boundary_price - buffer
        ):
            return index, boundary_price
    return None


def _boundary_price(boundary: dict[str, Any], rows: list[dict[str, Any]], index: int) -> float | None:
    start = boundary.get("start") or {}
    end = boundary.get("end") or {}
    try:
        start_price = float(start["price"])
        end_price = float(end["price"])
    except (KeyError, TypeError, ValueError):
        return None
    indexes = {str(row.get("timestamp")): position for position, row in enumerate(rows)}
    start_index = indexes.get(str(start.get("timestamp")))
    end_index = indexes.get(str(end.get("timestamp")))
    if start_index is None or end_index is None or end_index <= start_index:
        return end_price
    slope = (end_price - start_price) / (end_index - start_index)
    return start_price + slope * (index - start_index)


def _measured_move(pattern: dict[str, Any]) -> float:
    if pattern.get("kind") in _POLE_TARGET_KINDS and pattern.get("pole"):
        pole = pattern["pole"]
        try:
            return abs(float(pole["end"]["price"]) - float(pole["start"]["price"]))
        except (KeyError, TypeError, ValueError):
            return 0.0
    try:
        upper, lower = pattern["upper"], pattern["lower"]
        start_width = abs(float(upper["start"]["price"]) - float(lower["start"]["price"]))
        end_width = abs(float(upper["end"]["price"]) - float(lower["end"]["price"]))
        return max(start_width, end_width)
    except (KeyError, TypeError, ValueError):
        return 0.0


def _empty_plan(
    pattern: dict[str, Any],
    minimum_reward_risk: float,
    projection_bars: int,
    reason: str,
    *,
    symbol: str,
    interval: str,
    action: str = "no_trade",
    direction: str | None = None,
    phase: str = "forming",
    signal_at: str | None = None,
    confirmation_conditions: list[dict[str, Any]] | None = None,
    confirmation_evidence: dict[str, Any] | None = None,
    reasons: list[str] | None = None,
) -> dict[str, Any]:
    conditions = confirmation_conditions or []
    return {
        "version": TRADE_TIMING_VERSION,
        "symbol": symbol,
        "interval": interval,
        "patternId": str(pattern.get("id") or pattern.get("geometryHash") or pattern.get("kind") or "unknown"),
        "patternKind": str(pattern.get("kind") or "unknown"),
        "patternState": str(pattern.get("state") or "unknown"),
        "action": action,
        "direction": direction,
        "phase": phase,
        "signalAt": signal_at,
        "entryTrigger": conditions[0]["triggerPrice"] if len(conditions) == 1 else None,
        "confirmationConditions": conditions,
        "confirmationEvidence": confirmation_evidence,
        "entryPlan": None,
        "stopPlan": None,
        "targets": [],
        "retest": None,
        "entryPrice": None,
        "stopPrice": None,
        "targetPrice": None,
        "riskPerShare": None,
        "rewardPerShare": None,
        "rewardRiskRatio": None,
        "minimumRewardRisk": float(minimum_reward_risk),
        "projectionBars": max(1, int(projection_bars)),
        "reasons": reasons or [reason],
    }


def _index_for_timestamp(rows: list[dict[str, Any]], timestamp: Any) -> int | None:
    if not timestamp:
        return None
    target = str(timestamp)
    return next((index for index, row in enumerate(rows) if str(row.get("timestamp")) == target), None)


def _volume_ratio(rows: list[dict[str, Any]], index: int) -> float:
    baseline = [float(row.get("volume") or 0) for row in rows[max(0, index - 20):index]]
    median = statistics.median(baseline) if baseline else 0.0
    return float(rows[index].get("volume") or 0) / median if median > 0 else 0.0


def _rounded(value: float) -> float:
    return round(float(value), 6)
