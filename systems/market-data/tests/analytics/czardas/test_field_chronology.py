from __future__ import annotations

import pytest

from alfaka.analytics.czardas import Ready, analyze_czardas
from alfaka.analytics.czardas.config import DEFAULT_CONFIG
from alfaka.analytics.czardas.evidence import build_evidence
from alfaka.analytics.czardas.features import build_features
from alfaka.analytics.czardas.field import field_snapshot_at
from alfaka.analytics.czardas.hline import detect_hlines
from alfaka.analytics.czardas.tape import CandleTape
from alfaka.analytics.czardas.trend import detect_trends

from .fixtures import oscillating_rows


def test_field_modes_exist_only_after_every_frozen_origin_seed_is_confirmed():
    tape = CandleTape.from_rows(oscillating_rows(), DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    _clusters, basis = build_evidence(tape, features, DEFAULT_CONFIG)
    hline = detect_hlines(tape, features, basis, DEFAULT_CONFIG)
    trend = detect_trends(tape, features, basis, DEFAULT_CONFIG)
    basis_by_id = {item.basis_id: item for item in basis}

    assert hline.modes and trend.modes
    for mode in (*hline.modes, *trend.modes):
        assert len(mode.origin_seed_basis_ids) == 2
        formed_index = max(basis_by_id[item].confirmed_index for item in mode.origin_seed_basis_ids)
        before = field_snapshot_at(formed_index - 1, basis, hline.modes, trend.modes)
        at_formation = field_snapshot_at(formed_index, basis, hline.modes, trend.modes)
        before_modes = (*before.hline_modes, *before.trend_modes)
        formed_modes = (*at_formation.hline_modes, *at_formation.trend_modes)
        assert all(item.field_mode_id != mode.field_mode_id for item in before_modes)
        assert any(item.field_mode_id == mode.field_mode_id for item in formed_modes)
        assert mode.first_seen_at == tape.candles[formed_index].timestamp


def test_current_distance_is_atr_normalized():
    rows = oscillating_rows()
    result = analyze_czardas(rows)
    assert isinstance(result, Ready)
    tape = CandleTape.from_rows(rows, DEFAULT_CONFIG)
    features = build_features(tape, DEFAULT_CONFIG)
    atr = features.atr_scale(239, tape.candles[-1].close)

    for boundary in result.content["boundaries"]:
        expected = min(1.0, abs(boundary["line"]["priceAtAsOf"] - tape.candles[-1].close) / (3 * atr))
        assert boundary["normalizedCurrentDistance"] == pytest.approx(expected)
