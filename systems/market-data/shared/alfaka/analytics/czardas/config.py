from __future__ import annotations

from dataclasses import asdict, dataclass

from .numeric import canonical_digest


@dataclass(frozen=True, slots=True)
class CzardasConfig:
    algorithm_version: str = "czardas-v1"
    config_version: str = "czardas-config-v1"
    time_contract_version: str = "market-time-v1"
    calendar_version: str = "nyse-calendar-v1"
    target_completed_bars: int = 240
    atr_period: int = 14
    volume_baseline: int = 20
    extrema_radii: tuple[int, ...] = (2, 5, 13)
    recency_half_life_bars: int = 120
    hline_evidence_cap_per_role: int = 48
    trend_anchor_cap_per_side: int = 12
    trend_min_pair_separation: int = 12
    trend_pair_full_weight_bars: int = 96
    trend_hypothesis_mode_tolerance_atr: float = 0.50
    touch_tolerance_atr: float = 0.25
    max_zone_atr: float = 0.35
    approach_atr: float = 1.00
    episode_leave_atr: float = 0.75
    break_close_atr: float = 0.25
    break_consecutive_closes: int = 2
    max_single_bar_integrity_influence: float = 0.15
    verification_min_excursion_atr: float = 0.25
    verification_min_response: float = 0.45
    max_current_distance_atr: float = 3.0
    recent_evidence_bars: int = 120
    profile_target_bins: int = 48
    hline_display_count: int = 2
    trend_display_count: int = 2
    display_min_rank_score: float = 0.45
    max_field_bytes: int = 32_768
    max_payload_bytes: int = 65_536

    @property
    def digest(self) -> str:
        return canonical_digest(asdict(self))


DEFAULT_CONFIG = CzardasConfig()
