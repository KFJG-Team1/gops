from __future__ import annotations

from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas.features import build_features
from alfaka.analytics.czardas.tape import CandleTape

from .fixtures import flat_rows


def test_atr_and_volume_baseline_are_trailing_and_finite():
    rows = flat_rows()
    rows[20]["volume"] = 100_000
    tape = CandleTape.from_rows(rows, DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    assert features.atr[12] is None
    assert features.atr[13] == 1.0
    assert features.participation[19] == 0.5
    assert 0.5 < features.participation[20] <= 1.0
