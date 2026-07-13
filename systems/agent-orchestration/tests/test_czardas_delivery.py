from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
for path in (ROOT / "systems" / "market-data" / "shared", ROOT / "systems" / "agent-orchestration" / "shared"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from gops_agents.czardas_assets.delivery import symbol_entries  # noqa: E402


def test_freshness_is_read_only_identity_comparison_and_unknown_is_stale():
    records = {"1D": {
        "pack": {
            "algorithmVersion": "czardas-v1",
            "configVersion": "czardas-config-v1",
            "timeContractVersion": "market-time-v1",
            "calendarVersion": "nyse-calendar-v1",
        },
        "generatedAt": "2026-07-11T00:00:00.000Z",
        "inputDigest": "sha256:one",
        "lastCandleKey": "2026-07-10",
    }}
    current = symbol_entries("NVDA", records, lambda *_args: {
        "inputDigest": "sha256:one", "lastCandleKey": "2026-07-10",
    })
    stale = symbol_entries("NVDA", records, lambda *_args: None)

    assert current["1D"]["freshness"] == "current"
    assert stale["1D"]["freshness"] == "stale"
    assert current["1m"] == {"freshness": "missing", "generatedAt": None, "pack": None}


def test_incompatible_content_is_not_returned_to_the_browser():
    records = {"1D": {
        "pack": {"algorithmVersion": "czardas-v0"},
        "generatedAt": "2026-07-11T00:00:00.000Z",
        "inputDigest": "sha256:one",
        "lastCandleKey": "2026-07-10",
    }}

    result = symbol_entries("NVDA", records, lambda *_args: None)

    assert result["1D"] == {
        "freshness": "incompatible",
        "generatedAt": "2026-07-11T00:00:00.000Z",
        "pack": None,
    }
