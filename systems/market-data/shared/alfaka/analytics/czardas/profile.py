from __future__ import annotations

import math

from .config import CzardasConfig
from .numeric import clamp
from .tape import CandleTape


def estimated_volume_profile(tape: CandleTape, config: CzardasConfig) -> tuple[dict, ...]:
    low = min(item.low for item in tape.candles)
    high = max(item.high for item in tape.candles)
    if high <= low:
        width = max(0.01, abs(tape.candles[-1].close) * 1e-6)
        low -= width / 2
        high += width / 2
        count = 1
    else:
        count = config.profile_target_bins
    bin_width = (high - low) / count
    volumes = [0.0] * count
    for candle in tape.candles:
        if candle.volume <= 0:
            continue
        if candle.high <= candle.low:
            index = min(count - 1, max(0, int((candle.close - low) / bin_width)))
            volumes[index] += candle.volume
            continue
        span = candle.high - candle.low
        for index in range(count):
            bin_low = low + index * bin_width
            bin_high = high if index == count - 1 else bin_low + bin_width
            overlap = max(0.0, min(candle.high, bin_high) - max(candle.low, bin_low))
            if overlap > 0:
                volumes[index] += candle.volume * overlap / span
    maximum = max(volumes, default=0.0)
    return tuple({
        "binIndex": index,
        "lowPrice": low + index * bin_width,
        "highPrice": high if index == count - 1 else low + (index + 1) * bin_width,
        "normalizedVolume": 0.0 if maximum <= 0 else clamp(volume / maximum),
    } for index, volume in enumerate(volumes))


def profile_confluence(profile: tuple[dict, ...], center: float, zone: float) -> float:
    best = 0.0
    zone_low, zone_high = center - zone, center + zone
    for item in profile:
        low, high = float(item["lowPrice"]), float(item["highPrice"])
        width = max(1e-12, high - low)
        overlap = max(0.0, min(high, zone_high) - max(low, zone_low)) / width
        best = max(best, overlap * float(item["normalizedVolume"]))
    return clamp(best)
