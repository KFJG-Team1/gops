from __future__ import annotations

from typing import Any, Callable

from alfaka.analytics.czardas.data import SUPPORTED_INTERVALS

from .contract import is_valid_czardas_pack


def symbol_entries(
    symbol: str,
    records: dict[str, dict[str, Any] | None],
    identity_reader: Callable[[str, str], dict[str, Any] | None],
    intervals: tuple[str, ...] | None = None,
) -> dict[str, dict[str, Any]]:
    """Project stored records against a mutation-free current ClickHouse identity."""
    result: dict[str, dict[str, Any]] = {}
    for interval in intervals or SUPPORTED_INTERVALS:
        record = records.get(interval)
        if record is None:
            result[interval] = {
                "freshness": "missing",
                "freshnessReason": "asset_missing",
                "generatedAt": None,
                "pack": None,
            }
            continue
        pack = record.get("pack")
        if (
            not is_valid_czardas_pack(pack, expected_symbol=symbol, expected_interval=interval)
            or record.get("inputDigest") != pack.get("inputDigest")
            or record.get("lastCandleKey") != pack.get("lastCandleKey")
        ):
            freshness = "incompatible"
            reason = "contract_incompatible"
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
            reason = (
                "identity_match"
                if freshness == "current"
                else "identity_unavailable"
                if not identity
                else "input_changed"
            )
        result[interval] = {
            "freshness": freshness,
            "freshnessReason": reason,
            "generatedAt": record.get("generatedAt"),
            "pack": None if freshness == "incompatible" else pack,
        }
    return result
