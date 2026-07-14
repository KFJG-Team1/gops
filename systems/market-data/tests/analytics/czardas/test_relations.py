from __future__ import annotations

from alfaka.analytics.czardas import Ready, analyze_czardas
from alfaka.analytics.czardas.relations import _classify_trend_relation

from .fixtures import flat_rows, oscillating_rows, regime_shift_rows


def test_pattern_family_grammar_names_existing_trend_relations_without_refitting():
    cases = [
        ({"upper_norm": -0.03, "lower_norm": 0.03, "contraction": 0.5, "relation_bars": 80, "impulse_direction": None}, "triangle"),
        ({"upper_norm": 0.02, "lower_norm": 0.06, "contraction": 0.5, "relation_bars": 80, "impulse_direction": None}, "wedge"),
        ({"upper_norm": -0.03, "lower_norm": 0.03, "contraction": 0.5, "relation_bars": 48, "impulse_direction": 1}, "pennant"),
        ({"upper_norm": 0.02, "lower_norm": 0.021, "contraction": 1.0, "relation_bars": 60, "impulse_direction": None}, "channel"),
        ({"upper_norm": -0.03, "lower_norm": -0.029, "contraction": 1.0, "relation_bars": 36, "impulse_direction": 1}, "flag"),
    ]
    for values, expected in cases:
        classification = _classify_trend_relation(**values)
        assert classification is not None
        assert classification[0] == expected


def test_patterns_are_relations_of_existing_field_boundaries_and_facts():
    result = analyze_czardas(oscillating_rows())
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

        trace = glyphs[relation["relationId"]]["trace"]
        assert 3 <= len(trace["indexes"]) <= 16
        assert all(left < right for left, right in zip(trace["indexes"], trace["indexes"][1:]))
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
        assert 3 <= len(evidence["trace"]["indexes"]) <= 16
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
