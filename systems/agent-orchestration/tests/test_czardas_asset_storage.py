from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
for path in (Path(__file__).resolve().parent, ROOT / "systems" / "market-data" / "shared", ROOT / "systems" / "agent-orchestration" / "shared"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from gops_agents.czardas_assets.storage import (  # noqa: E402
    DeterminismConflict,
    PostgresCzardasAssetStorage,
    _pack_projection,
)
from czardas_test_support import valid_flat_pack  # noqa: E402


def _pack() -> dict:
    return valid_flat_pack()


def test_projection_keeps_generated_at_outside_deterministic_pack():
    first = _pack_projection(_pack(), "2026-07-11T00:00:00.000Z")
    second = _pack_projection(_pack(), "2026-07-12T00:00:00.000Z")

    assert first["content_digest"] == second["content_digest"]
    assert first["payload_bytes"] < 98_304
    assert first["field_bytes"] < 81_920


def test_projection_rejects_generated_at_inside_pack():
    pack = _pack()
    pack["generatedAt"] = "2026-07-11T00:00:00.000Z"
    with pytest.raises(ValueError, match="envelope"):
        _pack_projection(pack, pack["generatedAt"])


def test_storage_rejects_malformed_v4_pack_before_opening_a_transaction():
    pack = _pack()
    pack["czardasField"]["candleMeanings"]["timestamps"].pop()
    connection = Connection(fetches=[])
    storage = PostgresCzardasAssetStorage("postgresql://test", connect=lambda *_args, **_kwargs: connection)

    with pytest.raises(ValueError, match="240"):
        storage.save_if_active(pack, job_id="cza-job", generated_at="2026-07-11T00:00:00.000Z")

    assert connection.executions == []


def test_projection_rejects_oversized_field_and_layer_counts():
    oversized = _pack()
    oversized["czardasField"]["projection"]["padding"] = "x" * 81_920
    with pytest.raises(ValueError, match="Field exceeds"):
        _pack_projection(oversized, "2026-07-11T00:00:00.000Z")

    invalid_layers = _pack()
    invalid_layers["drawings"] = [{"czardasLayer": "hline"} for _ in range(5)]
    with pytest.raises(ValueError, match="boundaries and drawings|drawing"):
        _pack_projection(invalid_layers, "2026-07-11T00:00:00.000Z")


def test_atomic_save_returns_canceled_without_insert():
    connection = Connection(fetches=[{"cancel_requested": True}])
    storage = PostgresCzardasAssetStorage("postgresql://test", connect=lambda *_args, **_kwargs: connection)

    assert storage.save_if_active(_pack(), job_id="cza-job", generated_at="2026-07-11T00:00:00.000Z") == "canceled"
    assert not any("INSERT INTO chart_assets.czardas_latest" in query for query, _ in connection.executions)


def test_same_input_with_different_content_is_determinism_conflict():
    pack = _pack()
    connection = Connection(fetches=[
        {"cancel_requested": False},
        {
            "input_digest": pack["inputDigest"], "content_digest": "sha256:different",
            "last_candle_key": pack["lastCandleKey"], "as_of": None,
                "algorithm_version": pack["algorithmVersion"], "config_version": pack["configVersion"],
                "input_contract_version": pack["inputContractVersion"],
                "inference_config_digest": pack["inferenceConfigDigest"],
                "sight_projection_id": pack["sightProjectionId"],
                "time_contract_version": pack["timeContractVersion"], "calendar_version": pack["calendarVersion"],
        },
    ])
    storage = PostgresCzardasAssetStorage("postgresql://test", connect=lambda *_args, **_kwargs: connection)

    with pytest.raises(DeterminismConflict):
        storage.save_if_active(pack, job_id="cza-job", generated_at="2026-07-11T00:00:00.000Z")


def test_new_config_can_replace_the_same_candle_input():
    pack = _pack()
    connection = Connection(fetches=[
        {"cancel_requested": False},
        {
            "input_digest": pack["inputDigest"], "content_digest": "sha256:old",
            "last_candle_key": pack["lastCandleKey"], "as_of": None,
            "algorithm_version": "czardas-v2", "config_version": "czardas-config-v0",
            "time_contract_version": "market-time-v1", "calendar_version": "nyse-calendar-v1",
        },
    ])
    storage = PostgresCzardasAssetStorage("postgresql://test", connect=lambda *_args, **_kwargs: connection)

    assert storage.save_if_active(
        pack, job_id="cza-job", generated_at="2026-07-11T00:00:00.000Z"
    ) == "saved"
    assert any("INSERT INTO chart_assets.czardas_latest" in query for query, _ in connection.executions)


def test_delete_contract_is_exactly_one_symbol_interval_pair():
    connection = Connection(fetches=[])
    storage = PostgresCzardasAssetStorage("postgresql://test", connect=lambda *_args, **_kwargs: connection)

    assert storage.delete("nvda", "1D") == 0
    query, parameters = connection.executions[0]
    assert 'WHERE symbol = %s AND "interval" = %s' in query
    assert parameters == ("NVDA", "1D")
    with pytest.raises(ValueError, match="identity"):
        storage.delete("NVDA", "4H")


class Connection:
    def __init__(self, fetches):
        self.fetches = list(fetches)
        self.executions = []
        self.rowcount = 1

    def __enter__(self): return self
    def __exit__(self, *_args): return False
    def execute(self, query, parameters=()):
        self.executions.append((query, parameters))
        return self
    def fetchone(self): return self.fetches.pop(0) if self.fetches else None
    def fetchall(self): return []
    def commit(self): return None
    def rollback(self): return None
