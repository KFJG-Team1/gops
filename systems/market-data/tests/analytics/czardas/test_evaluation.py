from __future__ import annotations

from alfaka.analytics.czardas import AnalysisUnavailable, infer_czardas, project_czardas_sight
from alfaka.analytics.czardas.evaluation import (
    ResearchCzardasConfig,
    evaluate_walk_forward,
)

from .fixtures import oscillating_rows


def test_walk_forward_builds_independent_exact_240_and_keeps_future_in_evaluator():
    rows = oscillating_rows(count=242)
    report = evaluate_walk_forward(
        rows,
        as_of_indexes=[239, 240],
        future_horizon=1,
    )

    assert report["contract"] == "offline-independent-exact-240-v1"
    assert report["thresholdsAutoAdjusted"] is False
    assert report["readyCount"] == 2
    first, second = report["snapshots"]
    assert first["asOf"] == rows[239]["timestamp"]
    assert second["asOf"] == rows[240]["timestamp"]
    assert first["adjacent"] is None
    assert second["adjacent"]["fieldChurn"]["overlapBars"] == 239
    assert set(first["ablations"]) == {"response", "profile", "volume", "recency", "multiRadius"}
    assert first["ablations"]["volume"]["trendInvariant"] is True
    assert first["simpleBoundaryBaseline"]["method"] == "latest-confirmed-radius5-pivot"


def test_research_config_can_infer_but_cannot_be_projected_or_saved():
    inference = infer_czardas(
        oscillating_rows(),
        ResearchCzardasConfig(extrema_radii=(5,), study_label="single-radius"),
    )
    assert not isinstance(inference, AnalysisUnavailable)
    projected = project_czardas_sight(inference)
    assert isinstance(projected, AnalysisUnavailable)
    assert projected.reason == "research_config_not_storable"
