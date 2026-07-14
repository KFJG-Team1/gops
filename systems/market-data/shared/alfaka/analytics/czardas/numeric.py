from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, is_dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN
from typing import Any


CANONICAL_NUMERIC_QUANTUM = Decimal("0.00000001")


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    if not math.isfinite(value):
        return lower
    return min(upper, max(lower, value))


def bounded(value: float) -> float:
    value = max(0.0, value)
    return value / (1.0 + value)


def effective_tick(close: float) -> float:
    return max(0.01, abs(close) * 1e-6)


def quantize_number(value: Any) -> float:
    """Seal public numeric input into Czardas' code-owned decimal domain."""
    try:
        decimal = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("invalid_numeric") from exc
    if not decimal.is_finite():
        raise ValueError("invalid_numeric")
    quantized = decimal.quantize(CANONICAL_NUMERIC_QUANTUM, rounding=ROUND_HALF_EVEN)
    result = float(quantized)
    return 0.0 if result == 0 else result


def stable_hash(*parts: Any) -> str:
    return identity_digest(list(parts))


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
    ordered: list[float] = []
    append = ordered.append
    for value in values:
        numeric = float(value)
        if math.isfinite(numeric):
            append(numeric)
    ordered.sort()
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
        rounded = quantize_number(value)
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


def identity_digest(value: Any) -> str:
    """Hash semantic identity without the wire JSON's eight-decimal rounding.

    Public OHLCV and config values are quantized before reaching this function.
    Derived floats use their exact IEEE-754 value so provenance cannot alias two
    different computations merely because their presentation rounds equally.
    """
    encoded = json.dumps(
        _identity_value(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _identity_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("identity cannot contain NaN or infinity")
        normalized = 0.0 if value == 0 else value
        return {"$float64": normalized.hex()}
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("identity cannot contain NaN or infinity")
        return {"$decimal": format(value, "f")}
    if isinstance(value, Mapping):
        return {str(key): _identity_value(value[key]) for key in sorted(value, key=str)}
    if isinstance(value, (list, tuple)):
        return [_identity_value(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return [_identity_value(item) for item in sorted(value, key=str)]
    if is_dataclass(value):
        return _identity_value(asdict(value))
    return str(value)
