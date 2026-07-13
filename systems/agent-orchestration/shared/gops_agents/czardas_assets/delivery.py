from __future__ import annotations

from typing import Any, Callable

from alfaka.analytics.czardas import DEFAULT_CONFIG
from alfaka.analytics.czardas.data import SUPPORTED_INTERVALS


def symbol_entries(
    symbol: str,
    records: dict[str, dict[str, Any] | None],
    identity_reader: Callable[[str, str], dict[str, Any] | None],
) -> dict[str, dict[str, Any]]:
    """Project stored records against a mutation-free current ClickHouse identity."""
    result: dict[str, dict[str, Any]] = {}
    for interval in SUPPORTED_INTERVALS:
        record = records.get(interval)
        if record is None:
            result[interval] = {"freshness": "missing", "generatedAt": None, "pack": None}
            continue
        pack = record.get("pack")
        if not isinstance(pack, dict) or any((
            pack.get("algorithmVersion") != DEFAULT_CONFIG.algorithm_version,
            pack.get("configVersion") != DEFAULT_CONFIG.config_version,
            pack.get("timeContractVersion") != DEFAULT_CONFIG.time_contract_version,
            pack.get("calendarVersion") != DEFAULT_CONFIG.calendar_version,
        )):
            freshness = "incompatible"
        else:
            try:
                identity = identity_reader(symbol, interval)
            except Exception:
                identity = None
            freshness = "current" if (
                identity
                and identity.get("inputDigest") == record.get("inputDigest")
                and identity.get("lastCandleKey") == record.get("lastCandleKey")
            ) else "stale"
        result[interval] = {
            "freshness": freshness,
            "generatedAt": record.get("generatedAt"),
            "pack": None if freshness == "incompatible" else pack,
        }
    return result
