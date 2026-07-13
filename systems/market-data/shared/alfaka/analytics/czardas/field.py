from __future__ import annotations

from dataclasses import dataclass

from .types import FieldMode, RoleBasis


@dataclass(frozen=True, slots=True)
class FieldSnapshot:
    prefix_index: int
    basis: tuple[RoleBasis, ...]
    hline_modes: tuple[FieldMode, ...]
    trend_modes: tuple[FieldMode, ...]


def field_snapshot_at(
    prefix_index: int,
    basis: tuple[RoleBasis, ...],
    hline_modes: tuple[FieldMode, ...],
    trend_modes: tuple[FieldMode, ...],
) -> FieldSnapshot:
    """Return an immutable view; candidate mutation is deliberately outside this function."""
    visible_basis = tuple(item for item in basis if item.confirmed_index <= prefix_index)
    visible_ids = {item.basis_id for item in visible_basis}

    def visible_mode(item: FieldMode) -> bool:
        seeds = item.origin_seed_basis_ids
        return bool(seeds) and all(seed_id in visible_ids for seed_id in seeds)

    return FieldSnapshot(
        prefix_index,
        visible_basis,
        tuple(item for item in hline_modes if visible_mode(item)),
        tuple(item for item in trend_modes if visible_mode(item)),
    )
