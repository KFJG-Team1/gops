from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
MARKET_SHARED = ROOT / "systems" / "market-data" / "shared"
if str(MARKET_SHARED) not in sys.path:
    sys.path.insert(0, str(MARKET_SHARED))

from alfaka.analytics.trade_timing import evaluate_pattern_trade_timing  # noqa: E402


def test_confirmed_bullish_flag_becomes_buy_candidate_with_measured_move():
    rows = _rows([96.0, 96.5, 97.0, 97.5, 98.5])
    pattern = _pattern(
        "bullish_flag",
        rows,
        breakout_direction="up",
        upper=(98.0, 98.0),
        lower=(94.0, 96.0),
        pole=(88.0, 98.0),
    )

    plan = evaluate_pattern_trade_timing(rows, pattern, atr=1.0, symbol="aapl", interval="5m")

    assert plan is not None
    assert plan["action"] == "buy_candidate"
    assert plan["direction"] == "long"
    assert plan["signalAt"] == rows[-1]["timestamp"]
    assert plan["entryTrigger"] == 98.25
    assert plan["version"] == "pattern-trade-timing-v3"
    assert plan["confirmationConditions"] == [{
        "direction": "up",
        "boundary": "upper",
        "boundaryPrice": 98.0,
        "triggerPrice": 98.25,
        "bufferAtr": 0.25,
        "rule": "completed_close_above",
    }]
    assert plan["entryPrice"] == 98.5
    assert plan["stopPrice"] == 97.0
    assert plan["targetPrice"] == 108.0
    assert plan["rewardRiskRatio"] == 6.3333
    assert plan["entryPlan"] == {"mode": "confirmation_close", "at": rows[-1]["timestamp"], "price": 98.5}
    assert [target["id"] for target in plan["targets"]] == ["T1", "T2"]
    assert plan["targets"][0]["price"] == 100.0
    assert plan["targets"][0]["basis"] == "one_r"
    assert plan["stopPlan"]["basis"] == "breakout_boundary_atr"
    assert plan["reasons"] == [
        "confirmed_upward_breakout", "confirmation_hold", "confirmation_close_entry", "reward_risk_passed",
    ]


def test_forming_pattern_is_watch_only_and_never_marks_an_entry():
    rows = _rows([96.0, 96.5, 97.0, 97.5, 97.8])
    pattern = _pattern(
        "ascending_triangle",
        rows,
        state="forming",
        breakout_direction=None,
        upper=(98.0, 98.0),
        lower=(94.0, 96.0),
    )

    plan = evaluate_pattern_trade_timing(rows, pattern, atr=1.0, symbol="AAPL", interval="5m")

    assert plan is not None
    assert plan["action"] == "watch"
    assert plan["signalAt"] is None
    assert plan["entryTrigger"] == 98.25
    assert plan["entryPrice"] is None
    assert plan["stopPrice"] is None
    assert plan["targetPrice"] is None
    assert plan["rewardRiskRatio"] is None
    assert plan["confirmationConditions"][0]["triggerPrice"] == 98.25
    assert plan["reasons"] == ["pattern_not_confirmed"]


def test_forming_symmetrical_triangle_exposes_both_confirmation_sides():
    rows = _rows([96.0, 96.5, 97.0, 97.5, 97.8])
    pattern = _pattern(
        "symmetrical_triangle",
        rows,
        state="forming",
        breakout_direction=None,
        upper=(100.0, 98.0),
        lower=(94.0, 96.0),
    )

    plan = evaluate_pattern_trade_timing(rows, pattern, atr=1.0, symbol="AAPL", interval="5m")

    assert plan is not None
    assert plan["entryTrigger"] is None
    assert [(item["direction"], item["triggerPrice"], item["rule"]) for item in plan["confirmationConditions"]] == [
        ("up", 98.25, "completed_close_above"),
        ("down", 95.75, "completed_close_below"),
    ]


def test_bearish_pattern_defaults_to_long_position_exit_instead_of_short_entry():
    rows = _rows([104.0, 103.5, 103.0, 102.5, 101.5])
    pattern = _pattern(
        "bearish_flag",
        rows,
        breakout_direction="down",
        upper=(106.0, 104.0),
        lower=(102.0, 102.0),
        pole=(112.0, 102.0),
    )

    plan = evaluate_pattern_trade_timing(rows, pattern, atr=1.0, symbol="AAPL", interval="5m")
    short_plan = evaluate_pattern_trade_timing(
        rows,
        pattern,
        atr=1.0,
        symbol="AAPL",
        interval="5m",
        long_only=False,
    )

    assert plan is not None and short_plan is not None
    assert plan["action"] == "sell_candidate"
    assert plan["direction"] == "exit_long"
    assert plan["entryPrice"] is None
    assert plan["targets"] == []
    assert short_plan["action"] == "short_candidate"
    assert short_plan["direction"] == "short"
    assert short_plan["stopPrice"] == 103.0
    assert short_plan["targetPrice"] == 92.0


def test_low_reward_risk_rejects_new_long_entry():
    rows = _rows([96.0, 96.5, 97.0, 97.5, 98.5])
    pattern = _pattern(
        "bullish_flag",
        rows,
        breakout_direction="up",
        upper=(98.0, 98.0),
        lower=(94.0, 96.0),
        pole=(97.5, 98.0),
    )

    plan = evaluate_pattern_trade_timing(rows, pattern, atr=1.0, symbol="AAPL", interval="5m")

    assert plan is not None
    assert plan["action"] == "no_trade"
    assert plan["rewardRiskRatio"] == 0.0
    assert plan["reasons"][-1] == "target_ladder_invalid"


def test_unclosed_candle_is_never_used_as_signal_time_or_entry_price():
    rows = _rows([96.0, 96.5, 97.0, 97.5, 98.5])
    open_row = dict(rows[-1])
    open_row.update({
        "timestamp": _timestamp(5),
        "candleKey": _timestamp(5),
        "close": 150.0,
        "high": 151.0,
        "low": 149.0,
        "isClosed": False,
    })
    pattern = _pattern(
        "bullish_flag",
        rows,
        breakout_direction="up",
        upper=(98.0, 98.0),
        lower=(94.0, 96.0),
        pole=(88.0, 98.0),
    )

    plan = evaluate_pattern_trade_timing([*rows, open_row], pattern, atr=1.0, symbol="AAPL", interval="5m")

    assert plan is not None
    assert plan["signalAt"] == rows[-1]["timestamp"]
    assert plan["entryPrice"] == 98.5


def test_every_supported_directional_pattern_maps_to_the_expected_entry_side():
    bullish_kinds = (
        "ascending_triangle",
        "bullish_flag",
        "bullish_pennant",
        "bullish_rectangle",
        "falling_wedge",
        "descending_channel_breakout",
    )
    bearish_kinds = (
        "descending_triangle",
        "bearish_flag",
        "bearish_pennant",
        "bearish_rectangle",
        "rising_wedge",
        "ascending_channel_breakdown",
    )
    bullish_rows = _rows([96.0, 96.5, 97.0, 97.5, 98.5])
    bearish_rows = _rows([104.0, 103.5, 103.0, 102.5, 101.5])

    for kind in bullish_kinds:
        pole = (88.0, 98.0) if kind in {"bullish_flag", "bullish_pennant"} else None
        plan = evaluate_pattern_trade_timing(
            bullish_rows,
            _pattern(kind, bullish_rows, breakout_direction="up", upper=(98.0, 98.0), lower=(94.0, 96.0), pole=pole),
            atr=1.0,
            symbol="AAPL",
            interval="5m",
        )
        assert plan is not None and plan["action"] == "buy_candidate", kind

    for kind in bearish_kinds:
        pole = (112.0, 102.0) if kind in {"bearish_flag", "bearish_pennant"} else None
        plan = evaluate_pattern_trade_timing(
            bearish_rows,
            _pattern(kind, bearish_rows, breakout_direction="down", upper=(106.0, 104.0), lower=(102.0, 102.0), pole=pole),
            atr=1.0,
            symbol="AAPL",
            interval="5m",
            long_only=False,
        )
        assert plan is not None and plan["action"] == "short_candidate", kind


def test_price_breakout_without_volume_or_hold_is_confirmation_pending():
    rows = _rows([96.0, 96.5, 97.0, 98.5])
    pattern = _pattern(
        "bullish_flag", rows, state="forming", breakout_direction="up",
        upper=(98.0, 98.0), lower=(94.0, 96.0), pole=(88.0, 98.0),
    )
    pattern.update({
        "breakoutAt": rows[-1]["timestamp"], "confirmedAt": None,
        "confirmationMethod": None, "volumeRatio": 1.1,
    })

    plan = evaluate_pattern_trade_timing(rows, pattern, atr=1.0, symbol="AAPL", interval="5m")

    assert plan is not None
    assert plan["action"] == "watch"
    assert plan["phase"] == "confirmation_pending"
    assert plan["signalAt"] == rows[-1]["timestamp"]
    assert plan["confirmationEvidence"]["method"] is None
    assert plan["entryPlan"] is None


def test_volume_and_hold_confirmation_keep_the_exact_confirmation_reason():
    rows = _rows([96.0, 96.5, 97.0, 98.5, 98.7])
    volume_pattern = _pattern(
        "bullish_flag", rows, breakout_direction="up",
        upper=(98.0, 98.0), lower=(94.0, 96.0), pole=(88.0, 98.0),
    )
    volume_pattern.update({
        "breakoutAt": rows[-2]["timestamp"], "confirmedAt": rows[-2]["timestamp"],
        "confirmationMethod": "volume", "volumeRatio": 1.8,
    })
    hold_pattern = {
        **volume_pattern,
        "confirmedAt": rows[-1]["timestamp"],
        "confirmationMethod": "hold",
        "volumeRatio": 1.1,
    }

    volume_plan = evaluate_pattern_trade_timing(rows[:-1], volume_pattern, atr=1.0, symbol="AAPL", interval="5m")
    hold_plan = evaluate_pattern_trade_timing(rows, hold_pattern, atr=1.0, symbol="AAPL", interval="5m")

    assert volume_plan is not None and hold_plan is not None
    assert volume_plan["confirmationEvidence"]["method"] == "volume"
    assert volume_plan["confirmationEvidence"]["volumeRatio"] == 1.8
    assert hold_plan["confirmationEvidence"]["method"] == "hold"
    assert hold_plan["entryPlan"]["at"] == rows[-1]["timestamp"]


def test_retest_entry_replaces_confirmation_close_and_uses_retest_stop():
    rows = _rows([96.0, 96.5, 97.0, 97.5, 98.5, 99.0, 98.3, 98.5])
    rows[5].update({"low": 98.5, "high": 99.4})
    rows[6].update({"low": 98.1, "high": 98.7, "close": 98.3})
    rows[7].update({"low": 98.3, "high": 98.7})
    pattern = _pattern(
        "bullish_flag", rows, breakout_direction="up",
        upper=(98.0, 98.0), lower=(94.0, 96.0), pole=(88.0, 98.0),
    )
    pattern.update({
        "breakoutAt": rows[4]["timestamp"], "confirmedAt": rows[4]["timestamp"],
        "confirmationMethod": "volume", "volumeRatio": 2.0,
    })

    plan = evaluate_pattern_trade_timing(rows, pattern, atr=1.0, symbol="AAPL", interval="5m")

    assert plan is not None
    assert plan["phase"] == "retest_confirmed"
    assert plan["entryPlan"] == {"mode": "retest_close", "at": rows[6]["timestamp"], "price": 98.3}
    assert plan["stopPlan"]["basis"] == "retest_swing_atr"
    assert plan["stopPlan"]["initialPrice"] == 97.85
    assert plan["retest"]["state"] == "confirmed"


def test_retest_remains_pending_then_expires_after_five_completed_bars():
    base_rows = _rows([96.0, 96.5, 97.0, 97.5, 98.5])
    pending_rows = [*base_rows, *_rows_from(5, [99.0, 99.0])]
    expired_rows = [*base_rows, *_rows_from(5, [99.0] * 5)]
    pattern = _pattern(
        "bullish_flag", expired_rows, breakout_direction="up",
        upper=(98.0, 98.0), lower=(94.0, 96.0), pole=(88.0, 98.0),
    )
    pattern.update({
        "breakoutAt": base_rows[-1]["timestamp"], "confirmedAt": base_rows[-1]["timestamp"],
        "confirmationMethod": "volume", "volumeRatio": 2.0,
    })

    pending = evaluate_pattern_trade_timing(pending_rows, pattern, atr=1.0, symbol="AAPL", interval="5m")
    expired = evaluate_pattern_trade_timing(expired_rows, pattern, atr=1.0, symbol="AAPL", interval="5m")

    assert pending is not None and expired is not None
    assert pending["retest"]["state"] == "pending"
    assert pending["retest"]["observedBars"] == 2
    assert expired["retest"]["state"] == "expired"
    assert expired["retest"]["observedBars"] == 5


def test_target_one_uses_nearest_resistance_and_rejects_an_obstacle_inside_point_seven_five_r():
    rows = _rows([96.0, 96.5, 97.0, 97.5, 98.5])
    pattern = _pattern(
        "bullish_flag", rows, breakout_direction="up",
        upper=(98.0, 98.0), lower=(94.0, 96.0), pole=(88.0, 98.0),
    )

    valid = evaluate_pattern_trade_timing(
        rows, pattern, atr=1.0, symbol="AAPL", interval="5m",
        resistances=[{"price": 99.7, "zoneLow": 99.7}],
    )
    blocked = evaluate_pattern_trade_timing(
        rows, pattern, atr=1.0, symbol="AAPL", interval="5m",
        resistances=[{"price": 99.5, "zoneLow": 99.5}],
    )

    assert valid is not None and blocked is not None
    assert valid["targets"][0]["basis"] == "nearest_opposing_level"
    assert valid["targets"][0]["price"] == 99.7
    assert valid["action"] == "buy_candidate"
    assert blocked["targets"][0]["rMultiple"] < 0.75
    assert blocked["action"] == "no_trade"
    assert blocked["reasons"][-1] == "opposing_level_too_close"


def test_target_two_below_two_r_is_no_trade_even_with_a_valid_target_ladder():
    rows = _rows([96.0, 96.5, 97.0, 97.5, 98.5])
    pattern = _pattern(
        "bullish_flag", rows, breakout_direction="up",
        upper=(98.0, 98.0), lower=(94.0, 96.0), pole=(95.25, 98.0),
    )

    plan = evaluate_pattern_trade_timing(rows, pattern, atr=1.0, symbol="AAPL", interval="5m")

    assert plan is not None
    assert plan["targets"][0]["rMultiple"] == 1.0
    assert plan["targets"][1]["rMultiple"] == 1.5
    assert plan["action"] == "no_trade"
    assert plan["reasons"][-1] == "reward_risk_below_minimum"


def test_t1_moves_active_stop_to_entry_and_same_bar_stop_wins_conservatively():
    base_rows = _rows([96.0, 96.5, 97.0, 97.5, 98.5, 99.0])
    base_rows[5].update({"low": 98.4, "high": 100.2})
    pattern = _pattern(
        "bullish_flag", base_rows, breakout_direction="up",
        upper=(98.0, 98.0), lower=(94.0, 96.0), pole=(88.0, 98.0),
    )
    pattern.update({
        "breakoutAt": base_rows[4]["timestamp"], "confirmedAt": base_rows[4]["timestamp"],
        "confirmationMethod": "volume", "volumeRatio": 2.0,
    })

    reached = evaluate_pattern_trade_timing(base_rows, pattern, atr=1.0, symbol="AAPL", interval="5m")
    same_bar_rows = [dict(row) for row in base_rows]
    same_bar_rows[5].update({"low": 96.8, "high": 100.2})
    stopped = evaluate_pattern_trade_timing(same_bar_rows, pattern, atr=1.0, symbol="AAPL", interval="5m")

    assert reached is not None and stopped is not None
    assert reached["phase"] == "t1_reached"
    assert reached["stopPlan"]["activePrice"] == reached["entryPrice"]
    assert stopped["phase"] == "invalidated"
    assert stopped["stopPlan"]["activePrice"] == stopped["stopPlan"]["initialPrice"]


def _pattern(
    kind: str,
    rows: list[dict],
    *,
    state: str = "confirmed",
    breakout_direction: str | None,
    upper: tuple[float, float],
    lower: tuple[float, float],
    pole: tuple[float, float] | None = None,
) -> dict:
    pattern = {
        "id": f"pattern-{kind}",
        "kind": kind,
        "state": state,
        "breakoutDirection": breakout_direction,
        "score": 0.91,
        "geometryHash": f"hash-{kind}",
        "upper": {
            "start": {"timestamp": rows[0]["timestamp"], "price": upper[0]},
            "end": {"timestamp": rows[-1]["timestamp"], "price": upper[1]},
        },
        "lower": {
            "start": {"timestamp": rows[0]["timestamp"], "price": lower[0]},
            "end": {"timestamp": rows[-1]["timestamp"], "price": lower[1]},
        },
    }
    if pole:
        pattern["pole"] = {
            "start": {"timestamp": rows[0]["timestamp"], "price": pole[0]},
            "end": {"timestamp": rows[-2]["timestamp"], "price": pole[1]},
        }
    return pattern


def _rows(closes: list[float]) -> list[dict]:
    return [
        {
            "timestamp": _timestamp(index),
            "candleKey": _timestamp(index),
            "barIndex": index,
            "open": close - 0.2,
            "high": close + 0.5,
            "low": close - 0.5,
            "close": close,
            "volume": 1_000,
            "isClosed": True,
            "interval": "5m",
        }
        for index, close in enumerate(closes)
    ]


def _rows_from(start_index: int, closes: list[float]) -> list[dict]:
    rows = _rows(closes)
    for offset, row in enumerate(rows):
        row["timestamp"] = _timestamp(start_index + offset)
        row["candleKey"] = row["timestamp"]
    return rows


def _timestamp(index: int) -> str:
    value = datetime(2026, 7, 13, 13, 30, tzinfo=timezone.utc) + timedelta(minutes=5 * index)
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
