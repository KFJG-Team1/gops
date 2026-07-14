from __future__ import annotations

from alfaka.analytics.czardas import CzardasInference, Ready, analyze_czardas, infer_czardas

from .fixtures import oscillating_rows, regime_shift_rows


def test_adaptive_domains_keep_long_and_current_local_flows_together():
    inference = infer_czardas(regime_shift_rows())
    assert isinstance(inference, CzardasInference)

    active = [item for item in inference.domains if item.active]
    assert any(item.start_index == 0 and item.end_index == 239 for item in active)
    current_local = [
        item for item in active
        if item.end_index == 239 and item.start_index > 0
    ]
    assert current_local
    assert any(item.start_index <= 160 <= item.end_index for item in current_local)

    flow_domains = {item.domain_id for item in inference.regression_flows}
    assert {item.domain_id for item in current_local}.issubset(flow_domains)


def test_price_memory_projection_keeps_lossless_contributor_closure():
    result = analyze_czardas(oscillating_rows())
    assert isinstance(result, Ready)
    ridges = result.content["czardasField"]["priceMemoryRidges"]
    assert ridges
    assert all(item["contributorCount"] == len(item["contributorIndexes"]) for item in ridges)


def test_structural_fact_tape_is_the_shared_endpoint_source():
    inference = infer_czardas(oscillating_rows())
    assert isinstance(inference, CzardasInference)
    assert inference.structural_facts.basis == inference.basis
    assert tuple(sorted(inference.structural_facts.basis, key=lambda item: (
        item.role, item.confirmed_index, item.basis_id,
    ))) == inference.structural_facts.basis
