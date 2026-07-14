from __future__ import annotations

from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas.features import build_features
from alfaka.analytics.czardas.meaning import _robust_normalize
from alfaka.analytics.czardas.tape import CandleTape

from .fixtures import flat_rows


def test_atr_and_volume_baseline_are_trailing_and_finite():
    rows = flat_rows()
    rows[20]["volume"] = 100_000
    tape = CandleTape.from_rows(rows, DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    assert features.atr[12] is None
    assert features.atr[13] == 1.0
    assert features.effective_atr[:13] == (1.0,) * 13
    assert features.participation[19] == 0.5
    assert 0.5 < features.participation[20] <= 1.0


def test_semantic_floor_keeps_sub_resolution_and_flat_mad_near_neutral():
    tiny = _robust_normalize((100.0, 100.0004, 99.9996), "rangeAtr")
    assert tiny == (0.5, 0.5, 0.5)

    flat_with_signal = _robust_normalize((1.0, 1.0, 1.0, 1.002), "rangeAtr")
    assert flat_with_signal[:3] == (0.5, 0.5, 0.5)
    assert 0.5 < flat_with_signal[3] < 1.0

    volume_noise = _robust_normalize((0.50, 0.51, 0.49), "volumeRank")
    assert volume_noise == (0.5, 0.5, 0.5)
