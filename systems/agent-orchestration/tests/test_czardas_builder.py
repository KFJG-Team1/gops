from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
for path in (ROOT / "systems" / "market-data" / "shared", ROOT / "systems" / "agent-orchestration" / "shared"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from alfaka.analytics.czardas.types import Ready  # noqa: E402
from gops_agents.czardas_assets.builder import CzardasAssetBuilder  # noqa: E402
from gops_agents.czardas_assets.envelope import CzardasBuildEnvelope  # noqa: E402
from gops_agents.czardas_assets.progress import InMemoryCzardasProgressStore  # noqa: E402


class Repair:
    def __init__(self, ready=True): self.ready = ready
    def ensure_exact(self, *_args, **_kwargs):
        window = SimpleNamespace(
            ready=self.ready,
            rows=tuple({"row": index} for index in range(240 if self.ready else 239)),
            input_digest="sha256:input" if self.ready else None,
            last_candle_key="2026-07-10" if self.ready else None,
        )
        return SimpleNamespace(window=window, reason="coverage_complete" if self.ready else "exact_240_unavailable", metrics=lambda: {})


class Loader:
    def __init__(self, *, digests=("sha256:input",)):
        self.digests = list(digests)
        self.calls = 0
    def load(self, *_args):
        digest = self.digests[min(self.calls, len(self.digests) - 1)]
        self.calls += 1
        return SimpleNamespace(
            ready=True,
            rows=tuple({"row": index} for index in range(240)),
            input_digest=digest,
            last_candle_key="2026-07-10",
        )


class Storage:
    def __init__(self): self.saved = []; self.existing = None
    def get(self, *_args): return self.existing
    def save_if_active(self, pack, **kwargs): self.saved.append((pack, kwargs)); return "saved"


def _content():
    return {
        "algorithmVersion": "czardas-v1",
        "symbol": "NVDA",
        "interval": "1D",
        "drawings": [{"id": "one"}],
    }


def test_builder_saves_only_ready_exact_window():
    envelope = CzardasBuildEnvelope.create(requested_by="test", symbol="NVDA", interval="1D")
    progress = InMemoryCzardasProgressStore()
    progress.initialize(envelope)
    storage = Storage()
    builder = CzardasAssetBuilder(loader=Loader(), repair=Repair(), storage=storage, progress=progress)

    with patch("gops_agents.czardas_assets.builder.analyze_czardas", return_value=Ready(_content())):
        item = builder.run_item(envelope, "NVDA", "1D")

    assert item["status"] == "saved"
    assert item["createdEntities"] == 1
    assert len(storage.saved) == 1


def test_exact_239_failure_preserves_existing_asset():
    envelope = CzardasBuildEnvelope.create(requested_by="test", symbol="NVDA", interval="1D")
    progress = InMemoryCzardasProgressStore()
    progress.initialize(envelope)
    storage = Storage()
    storage.existing = {"pack": {"old": True}}
    builder = CzardasAssetBuilder(loader=Loader(), repair=Repair(ready=False), storage=storage, progress=progress)

    item = builder.run_item(envelope, "NVDA", "1D")

    assert item["status"] == "failed"
    assert item["reason"] == "exact_240_unavailable"
    assert storage.saved == []


def test_snapshot_change_is_retried_once_and_never_saved_if_it_keeps_moving():
    envelope = CzardasBuildEnvelope.create(requested_by="test", symbol="NVDA", interval="1D")
    progress = InMemoryCzardasProgressStore()
    progress.initialize(envelope)
    storage = Storage()
    builder = CzardasAssetBuilder(
        loader=Loader(digests=("sha256:newer", "sha256:newer-again")),
        repair=Repair(),
        storage=storage,
        progress=progress,
    )

    with patch("gops_agents.czardas_assets.builder.analyze_czardas", return_value=Ready(_content())):
        item = builder.run_item(envelope, "NVDA", "1D")

    assert item["status"] == "failed"
    assert item["reason"] == "snapshot_changed_during_build"
    assert storage.saved == []
