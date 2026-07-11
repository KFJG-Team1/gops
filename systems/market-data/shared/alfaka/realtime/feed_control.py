from __future__ import annotations

import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from alfaka.alpaca.feed_profiles import market_session_for_datetime
from alfaka.common.redis_keys import RedisKeyBuilder


MARKET_TIMEZONE = ZoneInfo("America/New_York")


def active_feed_profile_for(now: datetime | None = None) -> str | None:
    current = now or datetime.now(timezone.utc)
    session = market_session_for_datetime(current, timezone=MARKET_TIMEZONE)
    if session in {"pre", "regular", "after"}:
        return "sip"
    if session == "overnight":
        return "boats"
    return None


def select_simulation_feed(active_profile: str | None) -> str:
    """현재 live profile을 시뮬레이터 transport로 사용하고 휴장 시 SIP를 사용합니다."""
    normalized = str(active_profile or "").strip().lower()
    return normalized if normalized in {"sip", "boats"} else "sip"


def read_simulation_feed_override(redis_client, keys: RedisKeyBuilder | None = None) -> dict[str, object] | None:
    keys = keys or RedisKeyBuilder()
    try:
        raw = redis_client.get(keys.simulation_feed_override())
    except Exception:
        return None
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) and payload.get("runId") else None


def write_simulation_feed_override(
    redis_client,
    *,
    run_id: str,
    selected_feed_profile: str,
    websocket_base_url: str,
    symbols: list[str],
    keys: RedisKeyBuilder | None = None,
) -> dict[str, object]:
    keys = keys or RedisKeyBuilder()
    selected = select_simulation_feed(selected_feed_profile)
    payload = {
        "runId": str(run_id),
        "selectedFeedProfile": selected,
        "websocketBaseUrl": str(websocket_base_url).rstrip("/"),
        "symbols": [str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()],
        "channels": ["trades"],
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }
    redis_client.set(keys.simulation_feed_override(), json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return payload


def clear_simulation_feed_override(redis_client, run_id: str | None = None, keys: RedisKeyBuilder | None = None) -> bool:
    keys = keys or RedisKeyBuilder()
    existing = read_simulation_feed_override(redis_client, keys)
    if run_id and existing and str(existing.get("runId")) != str(run_id):
        return False
    return bool(redis_client.delete(keys.simulation_feed_override()))


def simulation_override_for_profile(override: dict[str, object] | None, profile_id: str) -> dict[str, object] | None:
    if not override:
        return None
    if str(override.get("selectedFeedProfile") or "").lower() != str(profile_id or "").lower():
        return None
    return override


def simulation_websocket_url(feed_profile, base_url: str) -> str:
    base = str(base_url).rstrip("/")
    if feed_profile.websocket_path:
        return f"{base}/{feed_profile.websocket_path.lstrip('/')}"
    return f"{base}/v2/{feed_profile.websocket_feed}"


def simulation_run_rolled_back(redis_client, run_id: str | None, keys: RedisKeyBuilder | None = None) -> bool:
    """원복이 시작됐거나 끝난 run의 Kafka 재처리를 차단합니다."""
    if not redis_client or not run_id:
        return False
    keys = keys or RedisKeyBuilder()
    try:
        raw = redis_client.get(keys.simulation_rollback(str(run_id)))
    except Exception:
        return False
    if not raw:
        return False
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return True
    return str(payload.get("rollbackState") or "").lower() in {"running", "completed"}


def market_session_for_profile(profile: str | None) -> str:
    if not profile:
        return "closed"
    return "extended" if profile == "sip" else "overnight"


def reconcile_active_feed(redis_client, now: datetime | None = None, keys: RedisKeyBuilder | None = None) -> dict[str, str]:
    keys = keys or RedisKeyBuilder()
    current = now or datetime.now(timezone.utc)
    profile = active_feed_profile_for(current)
    profile_value = profile or "none"
    current_profile = read_string(redis_client.get(keys.feed_active_profile()))
    if current_profile != profile_value:
        epoch = int(redis_client.incr(keys.feed_active_epoch()))
    else:
        epoch = int(read_string(redis_client.get(keys.feed_active_epoch())) or 0)

    payload = {
        "activeFeedProfile": profile_value,
        "marketSession": market_session_for_datetime(current, timezone=MARKET_TIMEZONE),
        "epoch": str(epoch),
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "policy": "sip=04:00-20:00 ET, boats=20:00-04:00 ET on active 24/5 equity sessions, none=closed",
    }
    redis_client.set(keys.feed_active_profile(), profile_value)
    redis_client.set(keys.feed_active_epoch(), str(epoch))
    redis_client.set(keys.feed_active(), json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    if profile:
        redis_client.set(keys.feed_lease(profile), payload["updatedAt"])
        redis_client.expire(keys.feed_lease(profile), 120)
    redis_client.set(keys.feed_switch_state(), json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return payload


def read_string(value) -> str | None:
    if value is None:
        return None
    return value.decode("utf-8") if isinstance(value, bytes) else str(value)
