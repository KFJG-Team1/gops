from __future__ import annotations

from dataclasses import replace

from alfaka.analytics.czardas import infer_czardas
from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas.select import (
    _best_subset,
    boundary_present_relevance,
    boundary_selection_utility,
)

from .fixtures import oscillating_rows


def _inference():
    return infer_czardas(oscillating_rows())


def test_recent_confirmation_is_capped_inside_selection_utility():
    inference = _inference()
    candidate = inference.hline.candidates[0]
    current_index = len(inference.tape.candles) - 1
    common = {
        "rank_score": 0.75,
        "price_at_as_of": inference.tape.candles[-1].close,
        "fit_episodes": (),
        "interactions": (),
    }
    old = replace(candidate, candidate_id="old", fit_evidence_confirmed_index=0, **common)
    recent = replace(candidate, candidate_id="recent", fit_evidence_confirmed_index=current_index, **common)

    assert boundary_selection_utility(
        inference.tape, inference.features, recent, DEFAULT_CONFIG,
    ) > boundary_selection_utility(
        inference.tape, inference.features, old, DEFAULT_CONFIG,
    )

    strong_old = replace(old, rank_score=0.95)
    weak_recent = replace(recent, rank_score=0.50)
    assert boundary_selection_utility(
        inference.tape, inference.features, strong_old, DEFAULT_CONFIG,
    ) > boundary_selection_utility(
        inference.tape, inference.features, weak_recent, DEFAULT_CONFIG,
    )

    half_life_old = replace(
        candidate,
        fit_episodes=(),
        interactions=(),
        fit_evidence_confirmed_index=current_index - 48,
    )
    assert abs(boundary_present_relevance(
        half_life_old, current_index, DEFAULT_CONFIG,
    ) - 0.5) < 1e-12


def test_hline_subset_prefers_bracketing_roles_only_when_strength_is_close():
    inference = _inference()
    base = inference.hline.candidates[0]
    current = inference.tape.candles[-1].close
    common = {
        "fit_episodes": (),
        "interactions": (),
        "fit_evidence_confirmed_index": len(inference.tape.candles) - 1,
        "observed_from_index": 20,
        "observed_to_index": 220,
    }
    support = replace(
        base, candidate_id="support-primary", role="support",
        rank_score=0.90, price_at_as_of=current - 1.0,
        intercept_at_origin=current - 1.0, **common,
    )
    adjacent = replace(
        base, candidate_id="support-adjacent", role="support",
        rank_score=0.89, price_at_as_of=current - 1.1,
        intercept_at_origin=current - 1.1, **common,
    )
    opposite = replace(
        base, candidate_id="resistance-opposite", role="resistance",
        rank_score=0.86, price_at_as_of=current + 1.0,
        intercept_at_origin=current + 1.0, **common,
    )

    selected = _best_subset(
        inference.tape, inference.features, (support, adjacent, opposite), 2,
        require_both_roles=False, config=DEFAULT_CONFIG, kind="hline",
    )
    assert {item.role for item in selected} == {"support", "resistance"}

    weak_opposite = replace(opposite, candidate_id="resistance-weak", rank_score=0.45)
    selected = _best_subset(
        inference.tape, inference.features, (support, adjacent, weak_opposite), 2,
        require_both_roles=False, config=DEFAULT_CONFIG, kind="hline",
    )
    assert {item.role for item in selected} == {"support"}
