from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "systems" / "agent-orchestration" / "jobs" / "czardas-asset-migrations"


def test_czardas_migration_is_additive_and_contains_no_geometry_schema():
    files = sorted(path.name for path in MIGRATIONS.iterdir() if path.is_file())
    assert files == ["004_czardas_assets.sql", "005_czardas_v3_identity_and_ops.sql", "main.py"]

    sql = (MIGRATIONS / "004_czardas_assets.sql").read_text(encoding="utf-8")
    normalized = sql.lower()
    assert "czardas_latest" in normalized
    assert "czardas_build_jobs" in normalized
    assert "czardas_build_items" in normalized
    assert "geometry" not in normalized
    assert "drop table" not in normalized
    assert "field_bytes between 0 and 81920" in normalized
    assert "payload_bytes between 0 and 98304" in normalized


def test_czardas_migration_runner_executes_004_then_005():
    runner = (MIGRATIONS / "main.py").read_text(encoding="utf-8")
    assert 'Path(__file__).parent / "004_czardas_assets.sql"' in runner
    assert 'Path(__file__).parent / "005_czardas_v3_identity_and_ops.sql"' in runner
    assert "003_geometry_assets" not in runner
    assert "gops_agents.chart_assets" not in runner
