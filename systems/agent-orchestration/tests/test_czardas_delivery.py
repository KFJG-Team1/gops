from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
for path in (Path(__file__).resolve().parent, ROOT / "systems" / "market-data" / "shared", ROOT / "systems" / "agent-orchestration" / "shared"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from gops_agents.czardas_assets.delivery import symbol_entries  # noqa: E402
from czardas_test_support import stored_record, valid_flat_pack  # noqa: E402


def test_freshness_is_read_only_identity_comparison_and_unknown_is_stale():
    pack = valid_flat_pack()
    records = {"1D": stored_record(pack)}
    current = symbol_entries("NVDA", records, lambda *_args: {
        "inputDigest": pack["inputDigest"], "lastCandleKey": pack["lastCandleKey"],
    })
    stale = symbol_entries("NVDA", records, lambda *_args: None)

    assert current["1D"]["freshness"] == "current"
    assert stale["1D"]["freshness"] == "stale"
    assert current["1m"] == {
        "freshness": "missing", "freshnessReason": "asset_missing", "generatedAt": None, "pack": None,
    }
    assert current["1D"]["freshnessReason"] == "identity_match"
    assert stale["1D"]["freshnessReason"] == "identity_unavailable"


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
        "freshnessReason": "contract_incompatible",
        "generatedAt": "2026-07-11T00:00:00.000Z",
        "pack": None,
    }


def test_malformed_current_version_pack_is_incompatible():
    pack = valid_flat_pack()
    pack["czardasField"]["candleMeanings"]["timestamps"].pop()
    record = stored_record(pack)

    result = symbol_entries("NVDA", {"1D": record}, lambda *_args: None)

    assert result["1D"]["freshness"] == "incompatible"
    assert result["1D"]["pack"] is None


def test_oversized_stored_pack_is_incompatible_on_delivery():
    pack = valid_flat_pack()
    pack["rejectSummary"]["oversized"] = "x" * (97 * 1024)

    result = symbol_entries("NVDA", {"1D": stored_record(pack)}, lambda *_args: None)

    assert result["1D"]["freshness"] == "incompatible"
    assert result["1D"]["pack"] is None
