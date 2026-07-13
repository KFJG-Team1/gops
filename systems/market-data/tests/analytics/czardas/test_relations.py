from __future__ import annotations

from types import SimpleNamespace

import pytest

from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas.features import build_features
from alfaka.analytics.czardas.relations import select_triangle_relation
from alfaka.analytics.czardas.tape import CandleTape

from .fixtures import flat_rows


def _line(candidate_id: str, role: str, start: float, end: float):
    return SimpleNamespace(
        candidate_id=candidate_id,
        role=role,
        observed_from_index=0,
        slope_per_bar=(end - start) / 239.0,
        intercept_at_origin=start,
        index_origin=0,
        zone_half_width=0.05,
        rank_score=0.9,
    )


@pytest.mark.parametrize(
    ("expected", "upper", "lower"),
    (
        ("ascending_triangle", (101.25, 101.25), (91.25, 98.75)),
        ("descending_triangle", (108.75, 101.25), (98.75, 98.75)),
        ("symmetrical_triangle", (106.25, 101.25), (93.75, 98.75)),
    ),
)
def test_triangle_is_a_pure_relation_of_selected_upper_and_lower_trends(expected, upper, lower):
    tape = CandleTape.from_rows(flat_rows(), DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    relation = select_triangle_relation(
        tape,
        features,
        (
            _line("upper", "upper", *upper),
            _line("lower", "lower", *lower),
        ),
    )

    assert relation is not None
    assert relation["kind"] == expected
    assert relation["upperCandidateId"] == "upper"
    assert relation["lowerCandidateId"] == "lower"
    assert relation["lineWidth"] == 3


@pytest.mark.parametrize(
    ("upper", "lower"),
    (
        ((105.0, 105.0), (95.0, 95.0)),
        ((104.0, 108.0), (96.0, 92.0)),
    ),
)
def test_parallel_or_divergent_trends_do_not_become_a_triangle(upper, lower):
    tape = CandleTape.from_rows(flat_rows(), DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    relation = select_triangle_relation(
        tape,
        features,
        (
            _line("upper", "upper", *upper),
            _line("lower", "lower", *lower),
        ),
    )

    assert relation is None
