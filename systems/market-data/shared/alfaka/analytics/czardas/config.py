from __future__ import annotations

from dataclasses import asdict, dataclass

from .numeric import identity_digest, quantize_number


@dataclass(frozen=True, slots=True)
class CzardasConfig:
    algorithm_version: str = "czardas-v3"
    config_version: str = "czardas-config-v3"
    input_contract_version: str = "canonical-ohlcv-q8-v1"
    time_contract_version: str = "market-time-v1"
    calendar_version: str = "nyse-calendar-v1"
    sight_projection_version: str = "czardas-sight-v2"
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
    response_min_excursion_atr: float = 0.25
    response_min_score: float = 0.45
    max_current_distance_atr: float = 3.0
    recent_evidence_bars: int = 120
    profile_target_bins: int = 48
    hline_display_count: int = 2
    trend_display_count: int = 2
    display_min_rank_score: float = 0.45
    target_field_bytes: int = 77_824
    max_field_bytes: int = 81_920
    max_payload_bytes: int = 98_304

    @property
    def production_storable(self) -> bool:
        return True

    @property
    def inference_digest(self) -> str:
        values = asdict(self)
        for key in ("target_field_bytes", "max_field_bytes", "max_payload_bytes", "sight_projection_version"):
            values.pop(key)
        return identity_digest(_effective_values(values))

    @property
    def projection_digest(self) -> str:
        return identity_digest(_effective_values({
            "sightProjectionVersion": self.sight_projection_version,
            "targetFieldBytes": self.target_field_bytes,
            "maxFieldBytes": self.max_field_bytes,
            "maxPayloadBytes": self.max_payload_bytes,
            "landscapeModeCapPerRole": 1,
            "responseSegmentCapPerRole": 8,
            "representativeHypothesisCap": 1,
        }))

    @property
    def digest(self) -> str:
        return self.inference_digest

    def validate(self) -> None:
        for key, value in asdict(self).items():
            if isinstance(value, float) and value != quantize_number(value):
                raise ValueError(f"config_numeric_not_q8:{key}")
        if self.target_completed_bars != 240:
            raise ValueError("target_completed_bars_must_be_240")
        if self.production_storable and self.extrema_radii != (2, 5, 13):
            raise ValueError("extrema_radii_must_be_2_5_13")
        if not self.extrema_radii or any(radius not in {2, 5, 13} for radius in self.extrema_radii):
            raise ValueError("unsupported_extrema_radius")
        if self.atr_period != 14 or self.volume_baseline != 20:
            raise ValueError("feature_period_contract_mismatch")
        if self.recency_half_life_bars <= 0:
            raise ValueError("recency_half_life_must_be_positive")
        if not (1 <= self.hline_display_count <= 4 and 1 <= self.trend_display_count <= 3):
            raise ValueError("display_count_out_of_range")
        if not (0 < self.target_field_bytes <= self.max_field_bytes <= 80 * 1024):
            raise ValueError("field_budget_out_of_range")
        if not (0 < self.max_payload_bytes <= 96 * 1024):
            raise ValueError("payload_budget_out_of_range")
        if not (0 < self.max_single_bar_integrity_influence <= 1):
            raise ValueError("integrity_influence_out_of_range")
        for value in (
            self.trend_hypothesis_mode_tolerance_atr,
            self.touch_tolerance_atr,
            self.max_zone_atr,
            self.approach_atr,
            self.episode_leave_atr,
            self.break_close_atr,
            self.response_min_excursion_atr,
            self.max_current_distance_atr,
        ):
            if value < 0:
                raise ValueError("negative_threshold")
        if self.production_storable and asdict(self) != asdict(CzardasConfig()):
            raise ValueError("production_config_is_sealed")


def _effective_values(values):
    return {
        key: quantize_number(value) if isinstance(value, float) else value
        for key, value in values.items()
    }


DEFAULT_CONFIG = CzardasConfig()
