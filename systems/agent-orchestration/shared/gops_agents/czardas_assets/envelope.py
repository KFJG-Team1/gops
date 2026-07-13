from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from alfaka.analytics.czardas.data import SUPPORTED_INTERVALS


@dataclass(frozen=True, slots=True)
class CzardasBuildEnvelope:
    job_id: str
    requested_by: str
    submitted_at: str
    symbol: str
    interval: str
    force: bool = False

    @classmethod
    def create(
        cls,
        *,
        requested_by: str,
        symbol: str,
        interval: str,
        force: bool = False,
        job_id: str | None = None,
        submitted_at: str | None = None,
    ) -> "CzardasBuildEnvelope":
        normalized_symbol = str(symbol).strip().upper()
        normalized_interval = str(interval).strip()
        if not normalized_symbol or normalized_interval not in SUPPORTED_INTERVALS:
            raise ValueError("Czardas builds require one supported symbol and interval")
        return cls(
            job_id=job_id or f"cza-{uuid.uuid4()}",
            requested_by=str(requested_by or "unknown"),
            submitted_at=submitted_at or utc_now_iso(),
            symbol=normalized_symbol,
            interval=normalized_interval,
            force=bool(force),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "requestedBy": self.requested_by,
            "submittedAt": self.submitted_at,
            "symbol": self.symbol,
            "interval": self.interval,
            "force": self.force,
        }


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
