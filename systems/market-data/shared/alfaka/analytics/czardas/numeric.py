from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, is_dataclass
from typing import Any


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    if not math.isfinite(value):
        return lower
    return min(upper, max(lower, value))


def bounded(value: float) -> float:
    value = max(0.0, value)
    return value / (1.0 + value)


def effective_tick(close: float) -> float:
    return max(0.01, abs(close) * 1e-6)


def stable_hash(*parts: Any) -> str:
    payload = "|".join(_stable_part(part) for part in parts)
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def weighted_quantile(values: Sequence[tuple[float, float, str]], q: float) -> float:
    ordered = sorted(
        ((float(value), max(0.0, float(weight)), str(stable_id)) for value, weight, stable_id in values),
        key=lambda item: (item[0], item[2]),
    )
    total = math.fsum(weight for _, weight, _ in ordered)
    if not ordered or total <= 0:
        raise ValueError("weighted_quantile requires positive total weight")
    target = clamp(float(q)) * total
    cumulative = 0.0
    for value, weight, _ in ordered:
        cumulative += weight
        if cumulative + 1e-15 >= target:
            return value
    return ordered[-1][0]


def weighted_median(values: Sequence[tuple[float, float, str]]) -> float:
    return weighted_quantile(values, 0.5)


def weighted_mad(values: Sequence[tuple[float, float, str]], center: float | None = None) -> float:
    if center is None:
        center = weighted_median(values)
    deviations = [(abs(value - center), weight, stable_id) for value, weight, stable_id in values]
    return weighted_median(deviations)


def median(values: Iterable[float]) -> float:
    ordered = sorted(float(value) for value in values if math.isfinite(float(value)))
    if not ordered:
        raise ValueError("median requires at least one finite value")
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return 0.5 * (ordered[middle - 1] + ordered[middle])


def harmonic_mean(values: Iterable[float]) -> float:
    items = [max(0.0, float(value)) for value in values]
    if not items or any(value == 0 for value in items):
        return 0.0
    return len(items) / math.fsum(1.0 / max(value, 1e-12) for value in items)


def huber(value: float, delta: float = 0.25) -> float:
    value = abs(float(value))
    return 0.5 * value * value if value <= delta else delta * (value - 0.5 * delta)


def canonicalize(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("canonical JSON cannot contain NaN or infinity")
        rounded = round(value, 8)
        return 0.0 if rounded == 0 else rounded
    if isinstance(value, Mapping):
        return {str(key): canonicalize(value[key]) for key in sorted(value, key=str)}
    if isinstance(value, (list, tuple)):
        return [canonicalize(item) for item in value]
    if is_dataclass(value):
        return canonicalize(asdict(value))
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(canonicalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _stable_part(value: Any) -> str:
    if isinstance(value, (list, tuple, set, frozenset)):
        return ",".join(_stable_part(item) for item in sorted(value, key=str))
    if isinstance(value, float):
        return format(canonicalize(value), ".8f")
    return str(value)
