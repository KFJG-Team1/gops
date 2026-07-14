from __future__ import annotations

import os
import sys
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
ALL_INTERVALS = ["1m", "5m", "10m", "1h", "4h", "1D", "1W"]
BUILD_HEADERS = {"Idempotency-Key": "czardas-route-test"}
for path in (
    ROOT / "systems" / "market-data" / "shared",
    ROOT / "systems" / "order" / "shared",
    ROOT / "systems" / "agent-orchestration" / "shared",
    ROOT / "systems" / "api-server" / "pods" / "api-server" / "gops-backend",
):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from fastapi.testclient import TestClient  # noqa: E402

from alfaka.analytics.czardas import Ready, analyze_czardas  # noqa: E402
from app.main import create_app  # noqa: E402
from gops_agents.czardas_assets.progress import InMemoryCzardasProgressStore  # noqa: E402
from gops_agents.czardas_assets.queue import InMemoryCzardasBuildQueue  # noqa: E402


class FakeStorage:
    def __init__(self):
        pack = _valid_pack()
        self.record = {
            "pack": pack,
            "generatedAt": "2026-07-11T00:00:00.000Z",
            "inputDigest": pack["inputDigest"],
            "lastCandleKey": pack["lastCandleKey"],
        }
        self.deleted = None

    def get_symbol_records(self, symbol):
        return {
            interval: self.record if symbol == "NVDA" and interval == "1D" else None
            for interval in ALL_INTERVALS
        }

    def delete(self, symbol, interval):
        self.deleted = (symbol, interval)
        return 1


class FakeIdentityReader:
    def __init__(self, record):
        self.record = record

    def current_identity(self, _symbol, interval):
        if interval != "1D":
            return None
        return {
            "inputDigest": self.record["inputDigest"],
            "lastCandleKey": self.record["lastCandleKey"],
            "actualCompleted": 240,
        }


def _valid_pack() -> dict:
    return deepcopy(_valid_pack_template())


@lru_cache(maxsize=1)
def _valid_pack_template() -> dict:
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    rows = []
    for index in range(240):
        timestamp = start + timedelta(days=index)
        rows.append({
            "symbol": "NVDA",
            "interval": "1D",
            "timestamp": timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "candleKey": timestamp.date().isoformat(),
            "open": 100.0,
            "high": 100.5,
            "low": 99.5,
            "close": 100.0,
            "volume": 1_000.0,
            "isClosed": True,
            "canonicalVersion": "v2",
            "priceAdjustment": "split",
            "marketSession": "regular",
        })
    result = analyze_czardas(rows)
    assert isinstance(result, Ready)
    return result.content


class FailingQueue:
    def __init__(self):
        self.envelope = None

    def submit_once(self, envelope, _progress):
        self.envelope = envelope
        raise RuntimeError("queue unavailable")


class FailingStorage:
    def get_symbol_records(self, _symbol):
        raise RuntimeError("database unavailable")

    def delete(self, _symbol, _interval):
        raise RuntimeError("database unavailable")


class CzardasAssetsRoutesTest(unittest.TestCase):
    def setUp(self):
        os.environ["AUTH_ENABLED"] = "false"
        self.storage = FakeStorage()
        self.progress = InMemoryCzardasProgressStore()
        self.queue = InMemoryCzardasBuildQueue()
        self.patches = [
            patch("app.routes.czardas_assets.czardas_asset_storage", return_value=self.storage),
            patch("app.routes.czardas_assets.czardas_asset_progress_store", return_value=self.progress),
            patch("app.routes.czardas_assets.czardas_asset_build_queue", return_value=self.queue),
            patch("app.routes.czardas_assets.czardas_identity_reader", return_value=FakeIdentityReader(self.storage.record)),
            patch("app.routes.czardas_assets.sp500_universe_symbols", return_value=["NVDA", "AAPL"]),
            patch("app.routes.czardas_assets.configured_universe_symbols", return_value=["NVDA", "AAPL"]),
        ]
        for current in self.patches:
            current.start()
        self.client = TestClient(create_app())

    def tearDown(self):
        for current in reversed(self.patches):
            current.stop()

    def test_get_returns_freshness_entries_without_asset_kind(self):
        response = self.client.get("/api/charts/czardas-assets", params={"symbol": "NVDA"})

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("assetKind", response.json())
        self.assertEqual(response.json()["assets"]["1D"]["freshness"], "current")
        self.assertEqual(response.json()["assets"]["1m"]["freshness"], "missing")

    def test_old_geometry_and_coverage_routes_are_gone(self):
        self.assertEqual(
            self.client.get("/api/charts/analysis-assets", params={"symbol": "NVDA"}).status_code,
            404,
        )
        self.assertEqual(self.client.get("/api/charts/czardas-assets/coverage").status_code, 404)

    def test_delete_uses_one_symbol_interval_pair(self):
        response = self.client.delete(
            "/api/charts/czardas-assets",
            params={"symbol": "nvda", "interval": "1D"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"symbol": "NVDA", "interval": "1D", "deleted": 1})
        self.assertEqual(self.storage.deleted, ("NVDA", "1D"))

    def test_delete_rejects_invalid_interval(self):
        response = self.client.delete(
            "/api/charts/czardas-assets",
            params={"symbol": "NVDA", "interval": "4H"},
        )
        self.assertEqual(response.status_code, 400)

    def test_build_status_and_cancel_use_only_cza_jobs(self):
        submitted = self.client.post(
            "/api/charts/czardas-assets/build",
            json={"symbol": "NVDA", "interval": "1D", "force": True},
            headers=BUILD_HEADERS,
        )

        self.assertEqual(submitted.status_code, 202)
        self.assertNotIn("assetKind", submitted.json())
        self.assertFalse(submitted.json()["coalesced"])
        job_id = submitted.json()["jobId"]
        self.assertTrue(job_id.startswith("cza-"))
        self.assertEqual(self.queue.items[-1]["symbol"], "NVDA")
        self.assertEqual(self.queue.items[-1]["interval"], "1D")
        self.assertEqual(
            submitted.json()["status_url"],
            f"/api/charts/czardas-assets/build/{job_id}",
        )
        status = self.client.get(f"/api/charts/czardas-assets/build/{job_id}")
        self.assertEqual(status.json()["requested"]["symbol"], "NVDA")
        self.assertNotIn("assetKind", status.json())
        canceled = self.client.post(f"/api/charts/czardas-assets/build/{job_id}/cancel")
        self.assertTrue(canceled.json()["cancelRequested"])

    def test_build_contract_rejects_geometry_and_plural_shapes(self):
        plural = self.client.post(
            "/api/charts/czardas-assets/build",
            json={"symbols": ["NVDA"], "intervals": ["1D"]},
            headers=BUILD_HEADERS,
        )
        geometry = self.client.post(
            "/api/charts/czardas-assets/build",
            json={"symbol": "NVDA", "interval": "1D", "assetKind": "geometry"},
            headers=BUILD_HEADERS,
        )
        self.assertEqual(plural.status_code, 422)
        self.assertEqual(geometry.status_code, 422)

    def test_build_requires_session_when_auth_is_enabled(self):
        from app.auth.config import AuthConfig
        from app.auth.session_store import MemorySessionStore

        with patch.dict(
            os.environ,
            {"AUTH_ENABLED": "true", "AUTH_SESSION_SECRET": "test-session-secret"},
            clear=False,
        ):
            self.client.app.state.auth_session_store = MemorySessionStore(AuthConfig.from_env())
            response = self.client.post(
                "/api/charts/czardas-assets/build",
                json={"symbol": "NVDA", "interval": "1D"},
                headers=BUILD_HEADERS,
            )
        self.assertEqual(response.status_code, 401)

    def test_storage_failures_return_503(self):
        with patch("app.routes.czardas_assets.czardas_asset_storage", return_value=FailingStorage()):
            read = self.client.get("/api/charts/czardas-assets", params={"symbol": "NVDA"})
            deleted = self.client.delete(
                "/api/charts/czardas-assets",
                params={"symbol": "NVDA", "interval": "1D"},
            )
        self.assertEqual(read.status_code, 503)
        self.assertEqual(deleted.status_code, 503)

    def test_maintenance_keeps_read_live_and_blocks_mutations(self):
        with patch.dict(os.environ, {"CZARDAS_ASSET_STORAGE_MAINTENANCE": "true"}):
            read = self.client.get("/api/charts/czardas-assets", params={"symbol": "NVDA"})
            build = self.client.post(
                "/api/charts/czardas-assets/build",
                json={"symbol": "NVDA", "interval": "1D"},
                headers=BUILD_HEADERS,
            )
            deleted = self.client.delete(
                "/api/charts/czardas-assets",
                params={"symbol": "NVDA", "interval": "1D"},
            )
        self.assertEqual(read.status_code, 200)
        self.assertEqual(build.status_code, 503)
        self.assertEqual(deleted.status_code, 503)

    def test_enqueue_failure_is_not_reported_as_queued(self):
        queue = FailingQueue()
        with patch("app.routes.czardas_assets.czardas_asset_build_queue", return_value=queue):
            response = self.client.post(
                "/api/charts/czardas-assets/build",
                json={"symbol": "NVDA", "interval": "1D"},
                headers=BUILD_HEADERS,
            )
        self.assertEqual(response.status_code, 503)
        self.assertIsNone(self.progress.get(queue.envelope.job_id))

    def test_build_rejects_unregistered_symbol(self):
        response = self.client.post(
            "/api/charts/czardas-assets/build",
            json={"symbol": "ZZZZ", "interval": "1D"},
            headers=BUILD_HEADERS,
        )
        self.assertEqual(response.status_code, 400)

    def test_build_requires_idempotency_key(self):
        response = self.client.post(
            "/api/charts/czardas-assets/build",
            json={"symbol": "NVDA", "interval": "1D"},
        )
        self.assertEqual(response.status_code, 422)

    def test_idempotency_and_same_owner_pair_coalesce_without_second_enqueue(self):
        first = self.client.post(
            "/api/charts/czardas-assets/build",
            json={"symbol": "NVDA", "interval": "1D"},
            headers={"Idempotency-Key": "same-request"},
        )
        replay = self.client.post(
            "/api/charts/czardas-assets/build",
            json={"symbol": "NVDA", "interval": "1D"},
            headers={"Idempotency-Key": "same-request"},
        )
        coalesced = self.client.post(
            "/api/charts/czardas-assets/build",
            json={"symbol": "NVDA", "interval": "1D"},
            headers={"Idempotency-Key": "different-request"},
        )
        self.assertEqual((first.status_code, replay.status_code), (202, 202))
        self.assertEqual(first.json()["jobId"], replay.json()["jobId"])
        self.assertEqual(first.json()["jobId"], coalesced.json()["jobId"])
        self.assertFalse(first.json()["coalesced"])
        self.assertTrue(replay.json()["coalesced"])
        self.assertTrue(coalesced.json()["coalesced"])
        self.assertEqual(len(self.queue.items), 1)

    def test_force_mismatch_and_delete_during_active_build_are_busy(self):
        first = self.client.post(
            "/api/charts/czardas-assets/build",
            json={"symbol": "NVDA", "interval": "1D", "force": False},
            headers={"Idempotency-Key": "non-force"},
        )
        busy = self.client.post(
            "/api/charts/czardas-assets/build",
            json={"symbol": "NVDA", "interval": "1D", "force": True},
            headers={"Idempotency-Key": "force"},
        )
        deleted = self.client.delete(
            "/api/charts/czardas-assets", params={"symbol": "NVDA", "interval": "1D"}
        )
        self.assertEqual(first.status_code, 202)
        self.assertEqual(busy.status_code, 409)
        self.assertEqual(busy.json()["detail"], "czardas_pair_busy")
        self.assertEqual(deleted.status_code, 409)

    def test_terminal_cancel_is_noop_and_owner_lookup_is_private(self):
        submitted = self.client.post(
            "/api/charts/czardas-assets/build",
            json={"symbol": "NVDA", "interval": "1D"},
            headers={"Idempotency-Key": "terminal"},
        )
        job_id = submitted.json()["jobId"]
        self.progress.record_item(job_id, {
            "symbol": "NVDA", "interval": "1D", "status": "saved", "stage": "storage", "error": None,
        })
        before = self.client.get(f"/api/charts/czardas-assets/build/{job_id}").json()
        after = self.client.post(f"/api/charts/czardas-assets/build/{job_id}/cancel").json()
        self.assertEqual(before["status"], after["status"])
        self.assertEqual(after["status"], "completed")
        self.assertFalse(after["cancelRequested"])
        owner = self.progress.get(job_id)["_requestedBy"]
        self.assertIsNone(self.progress.get_for_owner(job_id, owner + "-other"))
        self.assertIsNone(self.progress.request_cancel(job_id, requested_by=owner + "-other"))

    def test_interval_get_returns_only_requested_entry(self):
        response = self.client.get(
            "/api/charts/czardas-assets",
            params={"symbol": "NVDA", "interval": "1D"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()["assets"]), {"1D"})
        self.assertEqual(response.json()["assets"]["1D"]["freshnessReason"], "identity_match")


if __name__ == "__main__":
    unittest.main()
