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
    verification_mass = math.fsum(
        event.response_score for event in interactions if event.outcome == "verified_response"
    )
    verification_bonus = 0.05 * min(verification_mass, 2.0)
    profile_bonus = 0.05 * max(0.0, profile_confluence or 0.0)
    base = 0.50 * seed_quality + 0.30 * integrity + 0.20 * persistence
    return clamp(base + verification_bonus + profile_bonus), verification_mass, verification_bonus
