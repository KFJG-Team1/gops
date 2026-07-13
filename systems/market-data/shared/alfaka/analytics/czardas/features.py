from __future__ import annotations

import math
from dataclasses import dataclass

from .config import CzardasConfig
from .numeric import clamp, median
from .tape import CandleTape


@dataclass(frozen=True, slots=True)
class FeatureTape:
    atr: tuple[float | None, ...]
    effective_atr: tuple[float, ...]
    body_low: tuple[float, ...]
    body_high: tuple[float, ...]
    lower_wick: tuple[float, ...]
    upper_wick: tuple[float, ...]
    returns: tuple[float, ...]
    volume_rank: tuple[float, ...]
    volume_z: tuple[float, ...]
    participation: tuple[float, ...]

    def atr_scale(self, index: int, close: float) -> float:
        return self.effective_atr[index]


def build_features(tape: CandleTape, config: CzardasConfig) -> FeatureTape:
    candles = tape.candles
    body_low = tuple(min(item.open, item.close) for item in candles)
    body_high = tuple(max(item.open, item.close) for item in candles)
    lower_wick = tuple(body_low[index] - item.low for index, item in enumerate(candles))
    upper_wick = tuple(item.high - body_high[index] for index, item in enumerate(candles))
    returns = tuple(
        0.0 if index == 0 or candles[index - 1].close == 0 else item.close / candles[index - 1].close - 1.0
        for index, item in enumerate(candles)
    )
    true_ranges: list[float] = []
    for index, item in enumerate(candles):
        previous_close = candles[index - 1].close if index else item.close
        true_ranges.append(max(item.high - item.low, abs(item.high - previous_close), abs(item.low - previous_close)))
    atr: list[float | None] = [None] * len(candles)
    period = config.atr_period
    if len(candles) >= period:
        atr[period - 1] = math.fsum(true_ranges[:period]) / period
        for index in range(period, len(candles)):
            atr[index] = ((atr[index - 1] or 0.0) * (period - 1) + true_ranges[index]) / period
    volume_rank: list[float] = []
    volume_z: list[float] = []
    participation: list[float] = []
    logs = [math.log1p(item.volume) for item in candles]
    for index, item in enumerate(candles):
        previous = candles[max(0, index - config.volume_baseline):index]
        if len(previous) < config.volume_baseline:
            rank = 0.5
            z = 0.0
        else:
            lower = sum(1 for other in previous if other.volume < item.volume)
            equal = sum(1 for other in previous if other.volume == item.volume)
            rank = (lower + 0.5 * equal) / len(previous)
            baseline = logs[index - config.volume_baseline:index]
            center = median(baseline)
            mad = median(abs(value - center) for value in baseline)
            z = 0.0 if mad == 0 else clamp((logs[index] - center) / (1.4826 * mad), -3.0, 3.0)
        anomaly = clamp(0.5 + z / 6.0)
        volume_rank.append(rank)
        volume_z.append(z)
        participation.append(0.5 * rank + 0.5 * anomaly)
    effective_atr = tuple(
        max(0.01, abs(item.close) * 1e-6, atr[index] or 0.0)
        for index, item in enumerate(candles)
    )
    return FeatureTape(
        tuple(atr), effective_atr, body_low, body_high, lower_wick, upper_wick, returns,
        tuple(volume_rank), tuple(volume_z), tuple(participation),
    )
