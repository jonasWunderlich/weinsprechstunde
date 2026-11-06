"""Property-Based-Tests (hypothesis) für das Backup (phase_backup).
Properties 20, 21 aus design.md „Correctness Properties".
Jede Property läuft mit mindestens 100 Iterationen (@settings(max_examples=100)).
"""
from datetime import datetime

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from conftest import fresh_dir, make_config, write_json
from conftest import weinimport as wi
from weinlib import backup as backup_mod


# ---------------------------------------------------------------------------
# Property 20 + 21: Backup Rolling Window / Archival-Intervall
# ---------------------------------------------------------------------------


class _Frozen(datetime):
    _now = datetime(2024, 1, 1, 12, 0, 0)

    @classmethod
    def now(cls, tz=None):
        return cls._now


# Feature: weinliste, Property 20: Last-Backup Rolling Window
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
@given(
    max_last=st.integers(min_value=1, max_value=6),
    runs=st.integers(min_value=1, max_value=12),
)
def test_property_20_last_rolling_window(tmp_path, monkeypatch, max_last, runs):
    import_dir = fresh_dir(tmp_path)
    write_json(import_dir / "w.json", {"name": "A"})
    backup_dir = import_dir.parent / f"backup_{import_dir.name}"

    backup = wi.BackupConfig(
        backup_dir=str(backup_dir),
        max_last_backups=max_last,
        max_archival_backups=100,
        archival_interval_days=0,
        remote_backup_dir=None,
    )
    config = make_config(import_dir=str(import_dir), backup=backup)

    monkeypatch.setattr(backup_mod, "datetime", _Frozen)
    base = datetime(2024, 1, 1, 12, 0, 0)
    import datetime as _dt

    for i in range(runs):
        # eindeutige Timestamps erzwingen über ansteigende Sekunden
        _Frozen._now = base + _dt.timedelta(seconds=i)
        wi.phase_backup(config)
        count = len([d for d in backup_dir.iterdir() if d.is_dir() and d.name.startswith("last_")])
        assert count <= max_last


# Feature: weinliste, Property 21: Archival-Backup Intervall-Invariante
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
@given(
    interval_days=st.integers(min_value=1, max_value=60),
    offsets=st.lists(st.integers(min_value=0, max_value=200), min_size=1, max_size=8),
)
def test_property_21_archival_interval_invariant(tmp_path, monkeypatch, interval_days, offsets):
    import datetime as _dt

    import_dir = fresh_dir(tmp_path)
    write_json(import_dir / "w.json", {"name": "A"})
    backup_dir = import_dir.parent / f"backup_{import_dir.name}"

    backup = wi.BackupConfig(
        backup_dir=str(backup_dir),
        max_last_backups=1000,
        max_archival_backups=1000,
        archival_interval_days=interval_days,
        remote_backup_dir=None,
    )
    config = make_config(import_dir=str(import_dir), backup=backup)
    monkeypatch.setattr(backup_mod, "datetime", _Frozen)

    base = datetime(2024, 1, 1, 12, 0, 0)
    archival_times = []
    for off in sorted(offsets):
        _Frozen._now = base + _dt.timedelta(days=off, seconds=off)
        before = _list_archival(backup_dir)
        wi.phase_backup(config)
        after = _list_archival(backup_dir)
        if len(after) > len(before):
            archival_times.append(_Frozen._now)

    # Abstand zwischen aufeinanderfolgenden Archival-Backups >= interval_days
    for earlier, later in zip(archival_times, archival_times[1:]):
        assert (later - earlier) >= _dt.timedelta(days=interval_days)


def _list_archival(backup_dir):
    if not backup_dir.exists():
        return []
    return sorted(d.name for d in backup_dir.iterdir() if d.is_dir() and d.name.startswith("archival_"))
