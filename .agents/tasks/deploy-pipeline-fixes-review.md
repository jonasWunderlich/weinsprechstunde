# Deploy pipeline: browser build root + local pre-deploy backup (v2)

This pass addresses the six findings from the prior review (`6b005f6`). The pre-deploy backup was re-implemented as a recursive **local download** of `remote_path` into `backup.backup_dir/predeploy-<ts>/` for both SFTP and FTP, replacing the server-side `cp -a` approach the task never asked for. Backup failures now raise a dedicated `PreDeployBackupError` with its own message, an empty server is tolerated, a genuine failure aborts fail-closed before the prune, and the FTP path is real (no more unconditional abort). requirements.md Req 15–18 and the design.md deploy section were rewritten to the local-download wording, matching the code. Task 1 (browser build-root resolution) is unchanged and still passing.

Watch for:
- **confirmed** — the backup downloads `remote_path` *after* the dist upload has run, so the snapshot reflects post-upload server state, not the pristine pre-deploy state. This is harmless for the fail-closed guarantee (it still precedes the destructive prune) and matches the task wording ("VOR dem Prune"), but it is worth a one-line awareness: a rolled-back restore would carry the newly uploaded files too.

**Verdict**: APPROVED

## High-level view

Task 1 is unchanged from the approved build-root work: `_resolve_dist_dir()` picks the `*/browser` folder containing `index.html`, falls back to the flat `frontend/dist`, and both deploy paths call it so `index.html`/`assets/` land directly under `remote_path`. No regressions in this area.

Task 2 now does what the brief asked. `_predeploy_local_backup_sftp`/`_ftp` resolve a timestamped target under `backup.backup_dir` and recursively download `remote_path` into it using the pre-existing, already-tested `_sftp_download_dir`/`_ftp_download_dir` helpers. The same mechanism works over plain FTP, so the backup genuinely covers SFTP and FTP — the previous unconditional FTP abort is gone.

Failure handling is fail-closed and now legible. Both backup helpers wrap the download in a try/except that re-raises any error as `PreDeployBackupError`; `phase_deploy` catches that distinct type and prints a backup-specific message ("Prune übersprungen") instead of the generic connection-failure text, then exits 1 before any prune runs. A missing `backup` config is treated as a hard backup failure for the same reason. An empty server simply yields an empty backup folder and is not an error.

The old server-side machinery (`_predeploy_remote_backup_*`, `_transport_exec`, `_shq`, `_prune_predeploy_backups_sftp`, and the `FakeTransport`/`FakeChannel` exec harness) is fully removed, so the earlier "cp -a || true masks real errors" hole no longer exists. The separate import-backup mechanism (`_remote_backup`/`phase_backup`, keyed on `backup.remote_backup_dir`) is untouched and remains distinct from the predeploy snapshot, which keeps its own newest-5 rolling window via `_prune_predeploy_backups_local`.

The specs were corrected to describe the local download rather than justify the server-side copy, so requirements.md and design.md are now consistent with the code and with the task.

<details>
<summary>Issues (1)</summary>

1. **Snapshot is post-upload, not pristine** — the backup downloads `remote_path` after the dist upload step, so it captures the server with the newly uploaded files already in place. Harmless for fail-closed safety (it still runs before the destructive prune) and consistent with the task's "VOR dem Prune" wording; flag only so a future restore-from-backup isn't assumed to be the untouched pre-deploy state. No change required.

</details>

<details>
<summary>Details</summary>

### Pre-deploy backup is now a local recursive download (SFTP and FTP)

`_predeploy_backup_target(config)` returns `Path(backup.backup_dir) / f"predeploy-{YYYYmmdd-HHMMSS}"`, or raises `PreDeployBackupError` when `config.backup` is absent — a missing backup config is a hard failure precisely so the prune cannot run without a backup target. `_predeploy_local_backup_sftp` and `_predeploy_local_backup_ftp` create that directory and recurse into it with `_sftp_download_dir`/`_ftp_download_dir`, the same helpers already used by the remote-import download path. This is exactly the local-download mechanism the task specified ("remote_path rekursiv per SFTP/FTP heruntergeladen und lokal unter backup_dir ... abgelegt"), and because it is a plain recursive download it is portable across both protocols — resolving the prior FTP gap without a protocol-specific trick.

### Ordering and fail-closed behavior

In both `_deploy_sftp` and `_deploy_ftp` the backup call sits after the upload loop and immediately before `_sftp_prune`/`_ftp_prune`. Any download error is re-raised as `PreDeployBackupError` from inside the helper, propagates uncaught through the deploy function, and is handled in `phase_deploy`:

```python
except PreDeployBackupError as e:
    sys.stderr.write(
        f"FEHLER: Pre-Deploy-Backup von {config.deploy.remote_path} "
        f"fehlgeschlagen: {e}. Es wurde nichts auf dem Server gelöscht "
        f"(Prune übersprungen). ..."
    )
    sys.exit(1)
```

Because this handler precedes the generic `except Exception` (connection-failure) branch, a backup failure no longer masquerades as a hostname/password/protocol problem — the fourth prior finding. The exit happens before the prune, so the server is never pruned without a completed backup. `test_deploy_does_not_prune_when_backup_fails` and `test_ftp_deploy_does_not_prune_when_backup_fails` assert `SystemExit(1)` with `removed == []` / `deleted == []`; `test_backup_failure_message_is_distinct_from_connection_error` asserts the stderr contains "Pre-Deploy-Backup" and "Prune übersprungen" and does **not** contain "Verbindung zum Server".

### Empty server and retention

An empty server produces an empty listing from `listdir_attr`/`nlst`, so the backup folder is created but nothing is downloaded — `test_predeploy_backup_empty_server_is_ok` confirms `downloaded == []` and no abort. Retention is local: `_prune_predeploy_backups_local` lexically sorts the `predeploy-*` dirs (timestamp names sort chronologically) and `rmtree`s the oldest beyond `MAX_PREDEPLOY_BACKUPS` (5), swallowing deletion errors as a warning so cleanup never fails an already-successful deploy. `test_predeploy_backup_retention_keeps_five` seeds 7 old dirs and asserts exactly 5 remain after the run.

### Separation from the existing import-backup mechanism

The predeploy snapshot and the import backup are kept fully distinct. `_remote_backup`/`phase_backup` still key off `backup.remote_backup_dir` and run their own two-tier `last_`/`archival_` rolling windows; the diff does not touch them, and `remote_backup_dir` remains a valid, separate config field. The predeploy path uses only `backup.backup_dir` and its own `MAX_PREDEPLOY_BACKUPS` window, so the two never mix — satisfying the task's "getrennt vom bestehenden _remote_backup/phase_backup" constraint.

### Removal of the server-side approach

`_predeploy_remote_backup_sftp`/`_ftp`, `_transport_exec`, `_shq`, and `_prune_predeploy_backups_sftp` are deleted, along with the `FakeTransport`/`FakeChannel` exec harness in the tests. The prior finding about `cp -a ... 2>/dev/null || true` masking a real copy failure is moot because there is no shell copy anymore; failures surface as Python exceptions from the download helpers.

### Build-root resolution (Task 1, unchanged)

`_resolve_dist_dir()` and its callers are not modified in this commit. It remains correctly tested by `test_deploy_uploads_browser_build_as_remote_root` and `test_resolve_dist_dir_flat_and_nested`, which confirm `index.html` lands at `remote_path/index.html`, nothing carries an `ng-weinsprechstunde/browser` prefix, and both the flat and nested dist shapes resolve. No new concern.

### Specs updated consistently

requirements.md Req 15–18 and the design.md deploy section were rewritten from the server-side wording to the local-download wording: Req 15 now states the content is downloaded to `backup.backup_dir/predeploy-<ts>/`; Req 16 covers empty-server tolerance plus fail-closed abort; Req 17 mandates the distinct (non-connection) error message; Req 18 states retention of 5 and that the behavior is identical for SFTP and FTP. This matches the implemented code and the task. The remaining `remote_backup_dir` references in both specs belong to the separate import-backup requirement (Req 20 / 19.7) and are correctly left in place.

### Bundled config change

No new config change in this commit beyond the already-reviewed tracked `weinsprechstunde.config.json` (real host/paths, `password` empty, resolved from `WEINSPRECHSTUNDE_DEPLOY_PASSWORD`). The secret-handling constraint holds.

</details>

<details>
<summary>Files changed</summary>

- `scripts/weinimport.py` — `PreDeployBackupError`; `_predeploy_backup_target`, `_predeploy_local_backup_sftp`/`_ftp`, `_prune_predeploy_backups_local`; both deploy paths call the local-download backup before prune; server-side backup helpers and `_transport_exec`/`_shq` removed; distinct backup-failure handler in `phase_deploy`.
- `scripts/tests/test_deploy.py` — `FakeSFTP.get`/`download_fail_on`; new `FakeFTP` with `retrbinary`; tests for local SFTP/FTP download-before-prune, empty server, retention, fail-closed abort, and distinct failure message; old `FakeTransport`/`FakeChannel` exec harness removed.
- `.kiro/specs/weinliste/requirements.md` — Req 15–18 rewritten to the local-download wording.
- `.kiro/specs/weinliste/design.md` — deploy section rewritten to match.

Full diff: `git -C /Users/za_jonas/repos/weinsprechstunde2 diff HEAD~1...HEAD`

</details>
