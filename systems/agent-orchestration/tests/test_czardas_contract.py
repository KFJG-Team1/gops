from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
for path in (Path(__file__).resolve().parent, ROOT / "systems" / "market-data" / "shared", ROOT / "systems" / "agent-orchestration" / "shared"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from gops_agents.czardas_assets.contract import (  # noqa: E402
    CzardasPackValidationError,
    validate_czardas_pack,
)
from czardas_test_support import valid_flat_pack, valid_market_pack  # noqa: E402


def test_current_kernel_pack_satisfies_authoritative_wire_contract():
    pack = valid_flat_pack()

    assert validate_czardas_pack(pack, expected_symbol="NVDA", expected_interval="1D") is pack


def test_non_flat_market_pack_satisfies_authoritative_wire_contract():
    pack = valid_market_pack()

    assert validate_czardas_pack(pack, expected_symbol="MSFT", expected_interval="1D") is pack


def test_shared_json_schema_pins_v5_relation_and_field_shapes():
    schema = json.loads((ROOT / "shared" / "chart-contract" / "chart-czardas-pack.schema.json").read_text())

    assert schema["properties"]["algorithmVersion"]["const"] == "czardas-v5"
    assert schema["properties"]["configVersion"]["const"] == "czardas-config-v5"
    assert schema["$defs"]["field"]["properties"]["schemaVersion"]["const"] == 5
    assert set(schema["$defs"]["patternRelationGlyph"]["required"]) == {
        "relationId", "contactSequence", "priceTrace",
    }
    assert schema["$defs"]["patternPriceTrace"]["properties"]["method"]["const"] == "close-rdp-atr-v1"


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda pack: pack.update(inferenceId="sha256:" + "0" * 64), "inferenceId"),
        (lambda pack: pack.update(sightProjectionVersion="czardas-sight-v1"), "sightProjectionVersion"),
        (lambda pack: pack["coverage"].update(actualCompleted=239), "exact-240"),
        (lambda pack: pack["czardasField"].update(fieldRevision=1), "historical"),
        (lambda pack: pack["czardasField"].update(originFieldModeId="legacy"), "historical"),
        (lambda pack: pack["czardasField"].update(roleMassAtRevision=0.5), "historical"),
        (lambda pack: pack["czardasField"].update(verificationCount=1), "historical"),
        (lambda pack: pack["czardasField"]["candleMeanings"]["timestamps"].pop(), "240 values"),
        (lambda pack: pack["czardasField"]["candleMeanings"]["factors"].update(rangeAtr="AAAA"), "invalid base64"),
    ],
)
def test_contract_rejects_identity_history_and_meaning_corruption(mutate, message):
    pack = valid_flat_pack()
    mutate(pack)

    with pytest.raises(CzardasPackValidationError, match=message):
        validate_czardas_pack(pack)


def test_contract_rejects_unknown_selected_mode_provenance():
    # Flat fixtures intentionally have no selected modes. Injecting a selected
    # reference without a boundary proves that closure is checked before save.
    pack = valid_flat_pack()
    pack["czardasField"]["selectedModeRefs"].append({
        "candidateId": "sha256:" + "1" * 64,
        "kind": "hline",
        "sourceInferenceId": pack["inferenceId"],
        "sourceFieldModeId": "sha256:" + "2" * 64,
        "sourceFieldDerivationDigest": "sha256:" + "3" * 64,
    })

    with pytest.raises(CzardasPackValidationError, match="missing mode"):
        validate_czardas_pack(pack)


def test_raw_factor_scale_range_and_normalized_bounds_are_enforced():
    pack = valid_flat_pack()
    meanings = pack["czardasField"]["candleMeanings"]
    meanings["rawFactorScales"]["rangeAtr"] += 1

    with pytest.raises(CzardasPackValidationError, match="factorCodebook transport is inconsistent"):
        validate_czardas_pack(pack)


def test_contract_rejects_oversized_pack_on_the_shared_read_write_boundary():
    pack = valid_flat_pack()
    pack["rejectSummary"]["oversized"] = "x" * (97 * 1024)

    with pytest.raises(CzardasPackValidationError, match="96 KiB"):
        validate_czardas_pack(pack)


def test_contract_rejects_post_asof_drawing_anchor():
    pack = valid_market_pack()
    pack["drawings"][0]["anchors"][1]["timestamp"] = "2099-01-01T00:00:00.000Z"

    with pytest.raises(CzardasPackValidationError, match="after asOf"):
        validate_czardas_pack(pack)


def test_contract_rejects_hline_response_outside_exact_window():
    pack = valid_market_pack()
    pack["czardasField"]["hlineResponseSegments"] = [{
        "segmentId": "sha256:" + "1" * 64,
        "derivationDigest": "sha256:" + "2" * 64,
        "role": "support",
        "lowPrice": 350.0,
        "highPrice": 351.0,
        "responseMass": 1.0,
        "activeBasisCount": 2,
        "windowFromTimestamp": "2099-01-01T00:00:00.000Z",
        "windowToTimestamp": "2099-01-02T00:00:00.000Z",
    }]

    with pytest.raises(CzardasPackValidationError, match="window is inconsistent"):
        validate_czardas_pack(pack)


def test_contract_rejects_missing_selected_candidate_formation_closure():
    pack = valid_market_pack()
    assert pack["boundaries"]
    pack["czardasField"]["derivationEpisodes"]["initialFormationMasks"][0] = 0

    with pytest.raises(CzardasPackValidationError, match="two initial formation episodes"):
        validate_czardas_pack(pack)


def test_contract_rejects_interaction_before_fit_watermark():
    pack = valid_market_pack()
    interaction = next(
        glyph for glyph in pack["czardasField"]["validationGlyphs"]
        if glyph["kind"] == "interaction"
    )
    interaction["observedAt"] = pack["czardasField"]["windowFromTimestamp"]

    with pytest.raises(CzardasPackValidationError, match="after fit evidence"):
        validate_czardas_pack(pack)


def test_contract_rejects_implicit_nullable_interaction_corridor():
    pack = valid_market_pack()
    interaction = next(
        glyph for glyph in pack["czardasField"]["validationGlyphs"]
        if glyph["kind"] == "interaction"
    )
    interaction.pop("corridorLow")

    with pytest.raises(CzardasPackValidationError, match="corridorLow"):
        validate_czardas_pack(pack)


def test_contract_rejects_orphan_structural_domain_parent():
    pack = valid_market_pack()
    child = next(
        domain for domain in pack["czardasField"]["structuralDomains"]
        if domain["parentId"] is not None
    )
    child["parentId"] = "sha256:" + "f" * 64

    with pytest.raises(CzardasPackValidationError, match="parent is missing"):
        validate_czardas_pack(pack)


def test_contract_rejects_pattern_impulse_that_does_not_precede_consolidation():
    pack = valid_market_pack()
    relation = pack["patternRelations"][0]
    assert relation["impulse"]
    relation["kind"] = "flag"
    relation["impulse"]["toTimestamp"] = relation["domain"]["fromTimestamp"]

    with pytest.raises(CzardasPackValidationError, match="must precede its consolidation"):
        validate_czardas_pack(pack)


def test_contract_rejects_v4_pack_after_immediate_v5_cutover():
    pack = valid_market_pack()
    pack["algorithmVersion"] = "czardas-v4"

    with pytest.raises(CzardasPackValidationError, match="algorithmVersion is incompatible"):
        validate_czardas_pack(pack)


def test_contract_rejects_boundary_selection_scores_outside_unit_interval():
    pack = valid_market_pack()
    pack["boundaries"][0]["rank"]["presentRelevance"] = 1.01

    with pytest.raises(CzardasPackValidationError, match="presentRelevance is invalid"):
        validate_czardas_pack(pack)


def test_contract_rejects_pattern_drawing_that_does_not_match_price_trace():
    pack = valid_market_pack()
    drawing = next(item for item in pack["drawings"] if item["czardasLayer"] == "pattern")
    drawing["anchors"][1]["price"] += 0.01

    with pytest.raises(CzardasPackValidationError, match="does not match PatternTrace"):
        validate_czardas_pack(pack)


def test_contract_rejects_legacy_or_missing_pattern_trace_shape():
    pack = valid_market_pack()
    glyph = pack["czardasField"]["patternRelationGlyphs"][0]
    glyph["trace"] = glyph.pop("priceTrace")

    with pytest.raises(CzardasPackValidationError, match="pattern price trace must be an object"):
        validate_czardas_pack(pack)
