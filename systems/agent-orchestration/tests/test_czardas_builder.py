from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest


ROOT = Path(__file__).resolve().parents[3]
for path in (Path(__file__).resolve().parent, ROOT / "systems" / "market-data" / "shared", ROOT / "systems" / "agent-orchestration" / "shared"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from alfaka.analytics.czardas import DEFAULT_CONFIG  # noqa: E402
from alfaka.analytics.czardas.tape import CandleTape  # noqa: E402
from alfaka.analytics.czardas.types import Ready  # noqa: E402
from gops_agents.czardas_assets.builder import CzardasAssetBuilder  # noqa: E402
from gops_agents.czardas_assets.envelope import CzardasBuildEnvelope  # noqa: E402
from gops_agents.czardas_assets.progress import InMemoryCzardasProgressStore  # noqa: E402
from czardas_test_support import stored_record, valid_flat_pack, valid_flat_rows  # noqa: E402


class Repair:
    def __init__(self, ready=True): self.ready = ready; self.calls = 0
    def ensure_exact(self, *_args, **_kwargs):
        self.calls += 1
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
        "algorithmVersion": "czardas-v2",
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


def test_snapshot_change_is_rejected_without_retry_or_save():
    envelope = CzardasBuildEnvelope.create(requested_by="test", symbol="NVDA", interval="1D")
    progress = InMemoryCzardasProgressStore()
    progress.initialize(envelope)
    storage = Storage()
    repair = Repair()
    loader = Loader(digests=("sha256:newer",))
    builder = CzardasAssetBuilder(
        loader=loader,
        repair=repair,
        storage=storage,
        progress=progress,
    )

    with patch("gops_agents.czardas_assets.builder.analyze_czardas", return_value=Ready(_content())):
        item = builder.run_item(envelope, "NVDA", "1D")

    assert item["status"] == "failed"
    assert item["reason"] == "snapshot_changed_during_build"
    assert storage.saved == []
    assert repair.calls == 1
    assert loader.calls == 1


def test_post_asof_completed_row_is_not_mixed_and_precommit_audit_rejects_save():
    """A row completed after capture changes the next snapshot, not the frozen kernel input."""

    envelope = CzardasBuildEnvelope.create(requested_by="test", symbol="NVDA", interval="1D")
    progress = InMemoryCzardasProgressStore()
    progress.initialize(envelope)
    storage = Storage()
    frozen_rows = valid_flat_rows()
    frozen_tape = CandleTape.from_rows(frozen_rows, DEFAULT_CONFIG)
    new_row = deepcopy(frozen_rows[-1])
    new_time = datetime.fromisoformat(new_row["timestamp"].replace("Z", "+00:00")) + timedelta(days=1)
    new_row["timestamp"] = new_time.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    new_row["candleKey"] = new_time.date().isoformat()
    current_rows = frozen_rows[1:] + [new_row]
    current_tape = CandleTape.from_rows(current_rows, DEFAULT_CONFIG)
    assert current_tape.input_digest != frozen_tape.input_digest

    class SnapshotRepair:
        def ensure_exact(self, *_args, **_kwargs):
            window = SimpleNamespace(
                ready=True,
                rows=tuple(frozen_rows),
                input_digest=frozen_tape.input_digest,
                last_candle_key=frozen_tape.last_candle_key,
            )
            return SimpleNamespace(window=window, reason="coverage_complete", metrics=lambda: {})

    class PostAsOfLoader:
        def load(self, *_args):
            return SimpleNamespace(
                ready=True,
                rows=tuple(current_rows),
                input_digest=current_tape.input_digest,
                last_candle_key=current_tape.last_candle_key,
            )

    builder = CzardasAssetBuilder(
        loader=PostAsOfLoader(), repair=SnapshotRepair(), storage=storage, progress=progress
    )
    item = builder.run_item(envelope, "NVDA", "1D")

    assert item["status"] == "failed"
    assert item["reason"] == "snapshot_changed_during_build"
    assert storage.saved == []


def test_unchanged_requires_valid_pack_and_all_versions_and_schema_two():
    envelope = CzardasBuildEnvelope.create(requested_by="test", symbol="NVDA", interval="1D")
    progress = InMemoryCzardasProgressStore()
    progress.initialize(envelope)
    pack = valid_flat_pack()
    storage = Storage()
    storage.existing = stored_record(pack)
    repair = Repair()
    repair.ensure_exact = lambda *_args, **_kwargs: SimpleNamespace(
        window=SimpleNamespace(
            ready=True,
            rows=tuple({"row": index} for index in range(240)),
            input_digest=pack["inputDigest"],
            last_candle_key=pack["lastCandleKey"],
        ),
        reason="coverage_complete",
        metrics=lambda: {},
    )
    loader = Loader(digests=(pack["inputDigest"],))
    loader.load = lambda *_args: SimpleNamespace(
        ready=True,
        rows=tuple({"row": index} for index in range(240)),
        input_digest=pack["inputDigest"],
        last_candle_key=pack["lastCandleKey"],
    )
    builder = CzardasAssetBuilder(loader=loader, repair=repair, storage=storage, progress=progress)

    with patch("gops_agents.czardas_assets.builder.analyze_czardas") as analyze:
        item = builder.run_item(envelope, "NVDA", "1D")

    assert item["status"] == "unchanged"
    assert item["reason"] == "input_unchanged"
    analyze.assert_not_called()
    assert storage.saved == []


@pytest.mark.parametrize(
    ("metadata_key", "old_value"),
    [
        ("algorithmVersion", "czardas-v1"),
        ("configVersion", "czardas-config-v1"),
        ("timeContractVersion", "market-time-v0"),
        ("calendarVersion", "nyse-calendar-v0"),
        ("fieldSchemaVersion", 1),
    ],
)
def test_version_or_field_schema_mismatch_forces_current_snapshot_reanalysis(metadata_key, old_value):
    envelope = CzardasBuildEnvelope.create(requested_by="test", symbol="NVDA", interval="1D")
    progress = InMemoryCzardasProgressStore()
    progress.initialize(envelope)
    pack = valid_flat_pack()
    storage = Storage()
    storage.existing = stored_record(pack)
    storage.existing[metadata_key] = old_value
    repair = Repair()
    repair.ensure_exact = lambda *_args, **_kwargs: SimpleNamespace(
        window=SimpleNamespace(
            ready=True,
            rows=tuple({"row": index} for index in range(240)),
            input_digest=pack["inputDigest"],
            last_candle_key=pack["lastCandleKey"],
        ),
        reason="coverage_complete",
        metrics=lambda: {},
    )
    loader = Loader(digests=(pack["inputDigest"],))
    loader.load = lambda *_args: SimpleNamespace(
        ready=True,
        rows=tuple({"row": index} for index in range(240)),
        input_digest=pack["inputDigest"],
        last_candle_key=pack["lastCandleKey"],
    )
    builder = CzardasAssetBuilder(loader=loader, repair=repair, storage=storage, progress=progress)

    with patch("gops_agents.czardas_assets.builder.analyze_czardas", return_value=Ready(_content())) as analyze:
        item = builder.run_item(envelope, "NVDA", "1D")

    assert item["status"] == "saved"
    analyze.assert_called_once()
    assert len(storage.saved) == 1
