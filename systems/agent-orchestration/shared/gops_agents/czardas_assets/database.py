"""Czardas-owned PostgreSQL connection contract."""

from __future__ import annotations

import os

from psycopg.conninfo import make_conninfo


def database_conninfo() -> str:
    if os.getenv("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    required = ("DATABASE_HOST", "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASSWORD")
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"Czardas PostgreSQL settings missing: {','.join(missing)}")
    return make_conninfo(
        host=os.environ["DATABASE_HOST"],
        port=os.getenv("DATABASE_PORT", "5432"),
        dbname=os.environ["DATABASE_NAME"],
        user=os.environ["DATABASE_USER"],
        password=os.environ["DATABASE_PASSWORD"],
    )


__all__ = ["database_conninfo"]
