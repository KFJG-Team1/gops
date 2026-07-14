from __future__ import annotations

from dataclasses import replace

from alfaka.analytics.czardas import DEFAULT_CONFIG, Ready, analyze_czardas, infer_czardas
from alfaka.analytics.czardas.numeric import quantize_number
from alfaka.analytics.czardas.relations import (
    PATTERN_NAMES,
    _active_relation_windows,
    _classify_boundary_pair,
    _classify_trend_relation,
    _contact_sequence,
)
from alfaka.analytics.czardas.structure import StructuralDomain
from alfaka.analytics.czardas.types import FormationEpisode, InteractionEvent

from .fixtures import flat_rows, oscillating_rows, regime_shift_rows


def test_pattern_family_grammar_names_existing_trend_relations_without_refitting():
    assert set(PATTERN_NAMES) == {"triangle", "channel", "rectangle", "wedge", "flag", "pennant"}
    cases = [
        ({"upper_norm": -0.03, "lower_norm": 0.03, "contraction": 0.5, "relation_bars": 80, "impulse_direction": None}, "triangle"),
        ({"upper_norm": 0.02, "lower_norm": 0.06, "contraction": 0.5, "relation_bars": 80, "impulse_direction": None}, "wedge"),
        ({"upper_norm": -0.03, "lower_norm": 0.03, "contraction": 0.5, "relation_bars": 48, "impulse_direction": 1}, "pennant"),
        ({"upper_norm": 0.0, "lower_norm": 0.03, "contraction": 0.5, "relation_bars": 60, "impulse_direction": None}, "triangle"),
        ({"upper_norm": -0.03, "lower_norm": 0.0, "contraction": 0.5, "relation_bars": 60, "impulse_direction": None}, "triangle"),
        ({"upper_norm": 0.02, "lower_norm": 0.021, "contraction": 1.0, "relation_bars": 60, "impulse_direction": None}, "channel"),
        ({"upper_norm": -0.03, "lower_norm": -0.029, "contraction": 1.0, "relation_bars": 36, "impulse_direction": 1}, "flag"),
    ]
    for values, expected in cases:
        classification = _classify_trend_relation(**values)
        assert classification is not None
        assert classification[0] == expected


def test_active_pattern_windows_include_only_domains_that_reach_as_of_plus_root():
    def domain(name: str, start: int, end: int, active: bool) -> StructuralDomain:
        return StructuralDomain(name, None, start, end, 0, 0, 100, 1, 1, active)

    windows = _active_relation_windows((
        domain("root", 0, 239, True),
        domain("current", 160, 239, True),
        domain("expired-active", 80, 180, True),
        domain("current-inactive", 190, 239, False),
    ), 239)

    assert windows == (160, 0)


def test_pattern_contacts_use_supported_responses_but_not_pending_neutral_or_breaks():
    inference = infer_czardas(oscillating_rows())
    base = inference.trend.candidates[0]

    def interaction(identifier: str, index: int, outcome: str) -> InteractionEvent:
        return InteractionEvent(identifier, index, index + 1, index + 1, outcome, 0.1, 0.1, 0.8)

    lower = replace(
        base,
        candidate_id="lower-contact-test",
        role="lower",
        fit_episodes=(),
        interactions=(
            interaction("lower-supported-1", 100, "supported_response"),
            interaction("lower-pending", 110, "response_pending"),
            interaction("lower-neutral", 130, "neutral_response"),
            interaction("lower-supported-2", 160, "supported_response"),
        ),
    )
    upper = replace(
        base,
        candidate_id="upper-contact-test",
        role="upper",
        fit_episodes=(),
        interactions=(
            interaction("upper-break", 120, "confirmed_break"),
            interaction("upper-supported", 140, "supported_response"),
        ),
    )

    sequence = _contact_sequence(inference.tape, (lower, upper), 0, 239)

    assert [item["index"] for item in sequence["anchors"]] == [100, 140, 160]
    assert sequence["contributingInteractionIds"] == [
        "lower-supported-1", "lower-supported-2", "upper-supported",
    ]


def test_mixed_lower_trend_and_resistance_hline_form_triangle_without_refitting():
    inference = infer_czardas(oscillating_rows())
    base = inference.trend.candidates[0]

    def episode(identifier: str, role: str, index: int, price: float) -> FormationEpisode:
        return FormationEpisode(
            identifier, f"mode-{role}", role, (f"basis-{identifier}",),
            f"basis-{identifier}", index, index, index, index + 2, price,
            price - 0.5, price + 0.5, 0.8, 0.5, None,
        )

    lower_episodes = (
        episode("lower-1", "lower", 30, 98.6),
        episode("lower-2", "lower", 90, 99.8),
    )
    resistance_episodes = (
        episode("resistance-1", "resistance", 60, 110.8),
        episode("resistance-2", "resistance", 120, 109.6),
    )
    common = {
        "index_origin": 0,
        "zone_half_width": 0.8,
        "observed_from_index": 30,
        "observed_to_index": 120,
        "fit_evidence_confirmed_index": 122,
        "interactions": (),
        "rank_score": 0.82,
    }
    lower = replace(
        base,
        candidate_id="mixed-lower",
        kind="trend",
        role="lower",
        slope_per_bar=0.02,
        intercept_at_origin=98.0,
        price_at_as_of=102.78,
        initial_episode_ids=("lower-1", "lower-2"),
        fit_episode_ids=("lower-1", "lower-2"),
        fit_episodes=lower_episodes,
        **common,
    )
    resistance = replace(
        base,
        candidate_id="mixed-resistance",
        kind="hline",
        role="resistance",
        slope_per_bar=-0.02,
        intercept_at_origin=112.0,
        price_at_as_of=107.22,
        initial_episode_ids=("resistance-1", "resistance-2"),
        fit_episode_ids=("resistance-1", "resistance-2"),
        fit_episodes=resistance_episodes,
        **common,
    )

    relation = _classify_boundary_pair(
        inference.tape,
        inference.features,
        lower,
        resistance,
        inference.domains,
        inference.regression_flows,
        inference.structural_facts,
        DEFAULT_CONFIG,
        window_start=0,
        allowed_kinds={"triangle"},
    )

    assert relation is not None
    assert relation["kind"] == "triangle"
    assert set(relation["boundaryCandidateIds"]) == {"mixed-lower", "mixed-resistance"}


def test_patterns_are_relations_of_existing_field_boundaries_and_facts():
    rows = oscillating_rows()
    result = analyze_czardas(rows)
    assert isinstance(result, Ready)
    content = result.content
    field = content["czardasField"]
    refs = {item["candidateId"]: item for item in field["selectedModeRefs"]}
    relations = content["patternRelations"]
    glyphs = {item["relationId"]: item for item in field["patternRelationGlyphs"]}
    drawings = {
        item["sourceRelationId"]: item
        for item in content["drawings"]
        if item["czardasLayer"] == "pattern"
    }

    assert 0 < len(relations) <= 2
    assert set(glyphs) == set(drawings) == {item["relationId"] for item in relations}
    used_boundaries: set[str] = set()
    for relation in relations:
        boundary_ids = set(relation["boundaryCandidateIds"])
        assert len(boundary_ids) == 2
        assert boundary_ids.isdisjoint(used_boundaries)
        used_boundaries.update(boundary_ids)
        assert all(refs[candidate_id]["patternSupporting"] for candidate_id in boundary_ids)

        glyph = glyphs[relation["relationId"]]
        contacts = glyph["contactSequence"]
        trace = glyph["priceTrace"]
        assert trace["method"] == "close-rdp-atr-v1"
        assert 3 <= len(contacts["indexes"]) <= 16
        assert 3 <= len(trace["indexes"]) <= 16
        assert all(left < right for left, right in zip(trace["indexes"], trace["indexes"][1:]))
        assert trace["prices"] == [quantize_number(rows[index]["close"]) for index in trace["indexes"]]
        assert trace["indexes"][0] == relation["domain"]["fromIndex"]
        assert trace["indexes"][-1] == relation["domain"]["toIndex"]
        expected = [
            {"timestamp": field["candleMeanings"]["timestamps"][index], "price": price}
            for index, price in zip(trace["indexes"], trace["prices"], strict=True)
        ]
        drawing = drawings[relation["relationId"]]
        assert drawing["type"] == "polyline"
        assert drawing["anchors"] == expected
        assert drawing["style"]["extension"] == "none"


def test_pattern_layer_abstains_without_a_hard_relation():
    result = analyze_czardas(flat_rows())
    assert isinstance(result, Ready)
    assert result.content["patternRelations"] == []
    assert result.content["czardasField"]["patternRelationGlyphs"] == []
    assert all(item["czardasLayer"] != "pattern" for item in result.content["drawings"])
    assert result.content["selection"]["pattern"]["actualCount"] == 0


def test_unpromoted_relation_evidence_remains_visible_without_a_pattern_name_or_drawing():
    result = analyze_czardas(regime_shift_rows())
    assert isinstance(result, Ready)
    content = result.content
    field = content["czardasField"]

    assert content["patternRelations"] == []
    assert all(item["czardasLayer"] != "pattern" for item in content["drawings"])
    assert field["patternRelationGlyphs"] == []
    assert field["patternEvidenceGlyphs"]
    refs = {item["candidateId"]: item for item in field["selectedModeRefs"]}
    for evidence in field["patternEvidenceGlyphs"]:
        assert 3 <= len(evidence["contactSequence"]["indexes"]) <= 16
        assert all(refs[candidate_id]["patternSupporting"] for candidate_id in evidence["boundaryCandidateIds"])


def test_pattern_explanation_reports_ols_consensus_or_conflict_without_refitting():
    result = analyze_czardas(oscillating_rows())
    assert isinstance(result, Ready)
    flow_ids = {item["flowId"] for item in result.content["czardasField"]["regressionFlows"]}
    assert flow_ids
    for relation in result.content["patternRelations"]:
        assert relation["flowRelations"]
        assert all(item["flowId"] in flow_ids for item in relation["flowRelations"])
        assert all(item["state"] in {"consensus", "conflict"} for item in relation["flowRelations"])
        because = " ".join(relation["explanation"]["because"])
        assert "OLS" in because
