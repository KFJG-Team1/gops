from __future__ import annotations

from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas.evidence import build_evidence
from alfaka.analytics.czardas.features import build_features
from alfaka.analytics.czardas.tape import CandleTape

from .fixtures import oscillating_rows


def test_evidence_never_precedes_its_confirmation_prefix():
    tape = CandleTape.from_rows(oscillating_rows(), DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    _clusters, final_basis = build_evidence(tape, features, DEFAULT_CONFIG)
    for prefix in (20, 60, 120, 200):
        _prefix_clusters, prefix_basis = build_evidence(tape, features, DEFAULT_CONFIG, prefix_index=prefix)
        assert all(item.confirmed_index <= prefix for item in prefix_basis)
        assert {item.basis_id for item in prefix_basis}.issubset({item.basis_id for item in final_basis})
