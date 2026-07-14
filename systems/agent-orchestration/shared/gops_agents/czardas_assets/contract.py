from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping

from .contract_v5 import V5ContractError, validate_v5_pack


FIELD_SCHEMA_VERSION = 5
TARGET_BARS = 240
MAX_DRAWINGS = 9
MAX_HLINES = 4
MAX_TRENDS = 3
MAX_PATTERNS = 2
MAX_FIELD_BYTES = 80 * 1024
MAX_PACK_BYTES = 96 * 1024


class CzardasPackValidationError(ValueError):
    """The deterministic Czardas pack does not satisfy the v5 wire contract."""


def validate_czardas_pack(
    pack: Any,
    *,
    expected_symbol: str | None = None,
    expected_interval: str | None = None,
) -> dict[str, Any]:
    try:
        return validate_v5_pack(
            pack,
            expected_symbol=expected_symbol,
            expected_interval=expected_interval,
        )
    except V5ContractError as exc:
        raise CzardasPackValidationError(str(exc)) from exc


def is_valid_czardas_pack(
    pack: Any,
    *,
    expected_symbol: str | None = None,
    expected_interval: str | None = None,
) -> bool:
    try:
        validate_czardas_pack(
            pack,
            expected_symbol=expected_symbol,
            expected_interval=expected_interval,
        )
    except (CzardasPackValidationError, TypeError, ValueError):
        return False
    return True


def canonical_pack_json(pack: Mapping[str, Any]) -> str:
    return json.dumps(
        pack, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    )


def canonical_pack_digest(pack: Mapping[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(canonical_pack_json(pack).encode("utf-8")).hexdigest()
