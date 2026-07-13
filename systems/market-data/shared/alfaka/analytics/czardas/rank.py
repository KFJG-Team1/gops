from __future__ import annotations

import math

from .numeric import clamp
from .types import InteractionEvent


def boundary_rank(
    seed_quality: float,
    integrity: float,
    persistence: float,
    interactions: tuple[InteractionEvent, ...],
    *,
    profile_confluence: float | None = None,
) -> tuple[float, float, float]:
    response_mass = math.fsum(
        event.response_score for event in interactions if event.outcome == "supported_response"
    )
    response_bonus = 0.05 * min(response_mass, 2.0)
    profile_bonus = 0.05 * max(0.0, profile_confluence or 0.0)
    base = 0.50 * seed_quality + 0.30 * integrity + 0.20 * persistence
    return clamp(base + response_bonus + profile_bonus), response_mass, response_bonus
