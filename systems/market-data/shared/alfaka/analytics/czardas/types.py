from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


Role = Literal["support", "resistance", "lower", "upper"]
ModeState = Literal["weak", "opposed", "coherent"]


@dataclass(frozen=True, slots=True)
class Candle:
    symbol: str
    interval: str
    candle_key: str
    timestamp: str
    index: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True, slots=True)
class EvidenceAtom:
    evidence_id: str
    kind: str
    candle_key: str
    observed_at: str
    confirmed_at: str
    bar_index: int
    confirmed_index: int
    endpoint_price: float
    body_edge_price: float
    corridor_low: float
    corridor_high: float
    scale: int
    prominence: float
    rejection: float
    body_integrity: float
    participation: float | None


@dataclass(frozen=True, slots=True)
class EvidenceCluster:
    cluster_id: str
    kind: str
    representative: EvidenceAtom
    confirmed_scales: tuple[int, ...]
    last_confirmed_index: int


@dataclass(frozen=True, slots=True)
class RoleBasis:
    basis_id: str
    cluster_id: str
    role: Role
    observed_at: str
    confirmed_at: str
    bar_index: int
    confirmed_index: int
    endpoint_price: float
    body_edge_price: float
    corridor_low: float
    corridor_high: float
    role_mass: float
    geometry_score: float
    rejection: float
    participation: float | None
    effective_scale: int


@dataclass(frozen=True, slots=True)
class FormationEpisode:
    episode_id: str
    field_mode_id: str
    role: Role
    member_basis_ids: tuple[str, ...]
    contribution_basis_id: str
    contribution_index: int
    observed_from_index: int
    observed_to_index: int
    confirmed_index: int
    contribution_price: float
    corridor_low: float
    corridor_high: float
    contribution_mass: float
    rejection: float
    participation: float | None


@dataclass(frozen=True, slots=True)
class InteractionEvent:
    interaction_id: str
    contact_index: int
    terminal_index: int | None
    leave_index: int | None
    outcome: Literal["response_pending", "neutral_response", "supported_response", "confirmed_break"]
    exploration_pressure: float
    acceptance_mass: float
    response_score: float


@dataclass(frozen=True, slots=True)
class FieldMode:
    field_mode_id: str
    derivation_digest: str
    kind: Literal["hline", "trend"]
    role: Role
    mode_state: ModeState
    geometry_state: Literal["provisional", "refined"]
    center_start: float
    center_end: float
    zone_half_width: float
    ridge_low: float | None
    ridge_high: float | None
    support_mass: float
    opposition_mass: float
    dispersion_start_atr: float
    dispersion_end_atr: float
    contributor_basis_ids: tuple[str, ...]
    episode_ids: tuple[str, ...]
    representative_hypotheses: tuple[dict[str, Any], ...] = ()
    origin_seed_basis_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class BoundaryCandidate:
    candidate_id: str
    kind: Literal["hline", "trend"]
    role: Role
    evidence_state: Literal["formed", "response_supported"]
    source_field_mode_id: str
    source_field_derivation_digest: str
    slope_per_bar: float
    index_origin: int
    intercept_at_origin: float
    price_at_as_of: float
    zone_half_width: float
    observed_from_index: int
    observed_to_index: int
    initial_episode_ids: tuple[str, str]
    fit_episode_ids: tuple[str, ...]
    fit_evidence_confirmed_index: int
    seed_quality: float
    integrity: float
    body_integrity: float
    close_integrity: float
    integrity_fact_count: int
    integrity_effective_fact_count: float
    integrity_coverage: float
    body_penetration_count: int
    close_penetration_count: int
    persistence: float
    interactions: tuple[InteractionEvent, ...]
    profile_confluence: float | None
    rank_score: float
    reject_reasons: tuple[str, ...] = ()
    fit_episodes: tuple[FormationEpisode, ...] = ()


@dataclass(frozen=True, slots=True)
class DetectorResult:
    candidates: tuple[BoundaryCandidate, ...]
    modes: tuple[FieldMode, ...]
    basis: tuple[RoleBasis, ...]
    response_segments: tuple[dict[str, Any], ...] = ()
    profile_bins: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True, slots=True)
class Ready:
    content: dict[str, Any]
    debug: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AnalysisUnavailable:
    reason: str
    details: dict[str, Any] = field(default_factory=dict)
