from __future__ import annotations

import pytest

from types import SimpleNamespace

from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas.features import build_features
from alfaka.analytics.czardas.hline import _local_ridges, _piecewise_segments
from alfaka.analytics.czardas.interactions import LineProbe, _capped_simplex_weights, evaluate_interactions
from alfaka.analytics.czardas.tape import CandleTape
from alfaka.analytics.czardas.trend import _stratified_anchors, _weighted_medoid

from .fixtures import flat_rows


def test_hline_interval_sweep_does_not_treat_point_only_contact_as_overlap():
    segments = _piecewise_segments(
        [
            (100.0, 101.0, 1.0, "basis-a", "cluster-a"),
            (101.0, 102.0, 1.0, "basis-b", "cluster-b"),
        ]
    )

    assert segments == [
        (100.0, 101.0, 1.0, ("basis-a",)),
        (101.0, 102.0, 1.0, ("basis-b",)),
    ]
    assert _local_ridges(segments) == []


def test_hline_equal_response_plateau_is_one_ridge_even_when_membership_changes():
    segments = _piecewise_segments(
        [
            (100.0, 102.0, 1.0, "basis-a", "cluster-a"),
            (101.0, 103.0, 1.0, "basis-b", "cluster-b"),
            (102.0, 104.0, 1.0, "basis-c", "cluster-c"),
        ]
    )

    assert _local_ridges(segments) == [
        (101.0, 103.0, 2.0, ("basis-a", "basis-b", "basis-c")),
    ]


def test_disconnected_hline_landscapes_do_not_compete_across_empty_price_gap():
    segments = [
        (100.0, 101.0, 2.0, ("a", "b")),
        (110.0, 111.0, 3.0, ("c", "d")),
    ]
    assert _local_ridges(segments) == [
        (110.0, 111.0, 3.0, ("c", "d")),
        (100.0, 101.0, 2.0, ("a", "b")),
    ]


def test_integrity_recency_mass_is_a_capped_simplex():
    weights = _capped_simplex_weights([1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0], 0.15)
    assert sum(weights) == pytest.approx(1.0)
    assert max(weights) <= 0.15 + 1e-12


def test_trend_anchor_selection_caps_each_exact_80_bar_third_at_four():
    anchors = [
        SimpleNamespace(
            basis_id=f"basis-{third}-{ordinal}",
            bar_index=third * 80 + 5 + ordinal,
            geometry_score=1.0 - ordinal / 100.0,
            effective_scale=13,
        )
        for third in range(3)
        for ordinal in range(7)
    ]

    selected = _stratified_anchors(anchors, candle_count=240, cap=12)

    assert len(selected) == 12
    for third in range(3):
        selected_in_third = [
            item for item in selected if third * 80 <= item.bar_index < (third + 1) * 80
        ]
        assert [item.basis_id for item in selected_in_third] == [
            f"basis-{third}-{ordinal}" for ordinal in range(4)
        ]


def test_weighted_linf_medoid_uses_hypothesis_id_for_a_deterministic_tie():
    first = {
        "hypothesisId": "hypothesis-a",
        "yAtWindowStart": 100.0,
        "yAtWindowEnd": 102.0,
        "seedMass": 1.0,
    }
    second = {
        "hypothesisId": "hypothesis-b",
        "yAtWindowStart": 102.0,
        "yAtWindowEnd": 100.0,
        "seedMass": 1.0,
    }

    assert _weighted_medoid([second, first], scale=2.0)["hypothesisId"] == "hypothesis-a"
    assert _weighted_medoid([first, second], scale=2.0)["hypothesisId"] == "hypothesis-a"


def test_response_interactions_begin_strictly_after_fit_evidence_watermark():
    tape = CandleTape.from_rows(flat_rows(), DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    fit_evidence_confirmed_index = 100

    interactions = evaluate_interactions(
        tape,
        features,
        LineProbe("support", slope=0.0, intercept=100.0, origin_index=0, zone=0.2),
        candidate_id="candidate-under-test",
        fit_evidence_confirmed_index=fit_evidence_confirmed_index,
        formation_span=60,
        config=DEFAULT_CONFIG,
    )

    assert interactions
    assert interactions[0].contact_index == fit_evidence_confirmed_index + 1
    assert all(
        interaction.contact_index > fit_evidence_confirmed_index
        for interaction in interactions
    )
