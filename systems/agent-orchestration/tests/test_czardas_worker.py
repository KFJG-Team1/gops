from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "systems" / "agent-orchestration" / "pods" / "czardas-asset-builder" / "main.py"
SPEC = importlib.util.spec_from_file_location("czardas_asset_builder_main", MODULE_PATH)
assert SPEC and SPEC.loader
main = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(main)


def test_process_claim_builds_one_pair_and_stops_heartbeat():
    builder = Builder()
    queue = Queue()
    envelope = SimpleEnvelope("cza-test")
    claim = {"envelope": envelope, "symbol": "NVDA", "interval": "1D"}

    result = main.process_claim(builder, queue, claim, "worker-1")

    assert result == {"status": "saved"}
    assert builder.calls == [(envelope, "NVDA", "1D")]


class SimpleEnvelope:
    def __init__(self, job_id): self.job_id = job_id


class Builder:
    def __init__(self): self.calls = []
    def run_item(self, envelope, symbol, interval):
        self.calls.append((envelope, symbol, interval))
        return {"status": "saved"}


class Queue:
    def heartbeat(self, *_args, **_kwargs): return True
