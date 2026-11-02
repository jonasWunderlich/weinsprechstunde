# Pre-Deploy-Backup reworked to a server-side copy

The deploy phase no longer downloads `remote_path` to the local `backup_dir` before pruning. It now copies the current server contents into a timestamped `<remote_backup_dir>/predeploy-<YYYYmmdd-HHMMSS>/` folder that stays entirely on the server: SFTP drives it through an SSH-exec `cp -a` over the same paramiko transport, FTP through `SITE CPFR`/`SITE CPTO`. Retention keeps the five most recent predeploy folders server-side via the named constant `MAX_PREDEPLOY_BACKUPS` (overridable with an optional `backup.max_predeploy_backups`, default 5, no config change required), independent of the import-backup limits. A backup failure raises `PreDeployBackupError`, which aborts the deploy with a distinct message before any prune runs. The Build-Pfad-Fix (AUFGABE 1) and the existing `_remote_backup`/`phase_backup` import-backup mechanism are untouched, and both spec files were updated to the server-side variant.

Watch for: the FTP server-side copy depends on the server supporting the non-standard `SITE CPFR`/`SITE CPTO` extension (documented fail-closed, likely); `_ssh_exec` reads stdout fully before stderr, which can deadlock on large output with real paramiko (possible); the empty-server-is-ok case (Req 6.16) is no longer asserted by any test (likely gap).

**Verdict**: APPROVED

## High-level view

The data path reversed direction: instead of `_sftp_download_dir` / `_ftp_download_dir` pulling bytes to a local `predeploy-` folder, `_predeploy_server_backup_sftp` issues `mkdir -p … && cp -a <remote_path>/. <target>/` over an SSH-exec channel on the same transport, and `_predeploy_server_backup_ftp` walks the tree issuing `SITE CPFR`/`SITE CPTO` per file. Nothing is written into the local `backup_dir`, which is exactly the behavior the prior pass got wrong.

Ordering and fail-closed semantics are correct in both protocols: the backup call sits after upload and before the prune call in `_deploy_sftp` and `_deploy_ftp`, and any backup error propagates as `PreDeployBackupError`, caught in `phase_deploy` with its own "Prune übersprungen" message distinct from the Req 6.12 connection error. No deletion can happen without a preceding backup.

Retention is server-side and correctly decoupled: `MAX_PREDEPLOY_BACKUPS = 5` with an optional `backup.max_predeploy_backups` override, resolved by `_max_predeploy_backups`. It never touches `max_last_backups`/`max_archival_backups`. Deletion of the oldest folders is best-effort (`rm -rf` over SSH, recursive FTP delete) so a stale-folder cleanup failure doesn't fail a successful backup.

AUFGABE 1 is genuinely unchanged — `_resolve_dist_dir` and its two tests still assert `index.html` lands directly under `remote_path`. The import-backup mechanism (`_remote_backup`, `_download_sftp`, `_download_ftp`) is reused only by `phase_backup`/`download_remote_import`, not by the predeploy path, so the leftover download helpers are legitimate rather than orphaned.

The soft spots are environmental: FTP server-side copy requires a `mod_copy`-style extension, and the `_ssh_exec` output handling is fragile under real paramiko.

<details>
<summary>Issues (4)</summary>

1. **FTP SITE CPFR/CPTO dependency** — the FTP server-side copy only works where the server offers the non-standard `SITE CPFR`/`SITE CPTO` extension; on servers without it the backup fails closed (no prune), which is safe but means FTP deploys silently require that extension. Documented in design.md; confirm the target FTP server supports it before relying on the FTP path.
2. **`_ssh_exec` read ordering** — it reads the full stdout stream before reading stderr; with real paramiko a large stderr (or stdout) can fill the channel buffer and deadlock. Fine for the small `cp`/`ls`/`rm` output here, but prefer setting a combined stderr or draining both via `select` if command output could grow.
3. **Empty-server case no longer tested** — the old `test_predeploy_backup_empty_server_is_ok` tests (SFTP and FTP) were removed with the download variant and not replaced, yet Req 6.16 still mandates that an empty server is not an error. Add a test asserting `cp -a` / `SITE` runs without raising when `remote_path` is empty.
4. **FTP copy is non-atomic and relies on `cwd` probing** — `_ftp_server_copy_dir` issues `SITE CPFR` then `SITE CPTO` as two separate stateful commands and detects directories via `cwd` round-trips; on a server with concurrent sessions or quirky `nlst` output this is less robust than the SSH `cp -a`. Acceptable given the documented limitation, but note it as the weaker of the two paths.

</details>

<details>
<summary>Details</summary>

### Direction of the data path reversed

The core correction is visible in the two backup helpers. The old `_predeploy_local_backup_sftp`/`_ftp` created a local `Path` target and called `_sftp_download_dir`/`_ftp_download_dir` to pull bytes down; those are gone. The replacements build a remote target string `<remote_base>/predeploy-<ts>` and keep the data on the server:

```python
remote_base, name = _predeploy_remote_backup_dir(config)
target = f"{remote_base}/{name}"
_ssh_exec(
    transport,
    f"mkdir -p {_shq(target)} && cp -a {_shq(remote_path.rstrip('/'))}/. {_shq(target)}/",
)
```

`_predeploy_remote_backup_dir` now raises `PreDeployBackupError` when `config.backup` or `config.backup.remote_backup_dir` is missing, so the "no target defined" case still aborts before the prune. Paths are shell-quoted through `_shq`, which handles the embedded-quote case, so the server paths from config can't break out of the command.

The test confirms the reversal concretely: it asserts a `cp -a` command targeting `/backup/predeploy-\d{8}-\d{6}` with `/html` as source, that `FakeSFTP` no longer exposes a `downloaded` attribute, and that no `predeploy-` folder appears in the local `backup_dir`. The old-file `old.js` is still pruned afterward, proving the backup runs first.

### Fail-closed ordering holds in both protocols

In both `_deploy_sftp` and `_deploy_ftp` the sequence is upload → `_predeploy_server_backup_*` → `_protected_prefixes` → prune. The backup helpers wrap the copy in a `try/except` that re-raises any failure as `PreDeployBackupError`, and `phase_deploy` catches that separately from the generic connection path:

```python
except PreDeployBackupError as e:
    sys.stderr.write(f"FEHLER: Pre-Deploy-Backup von {config.deploy.remote_path} fehlgeschlagen: {e}. "
                     f"Es wurde nichts auf dem Server gelöscht (Prune übersprungen). …")
    sys.exit(1)
```

`test_deploy_does_not_prune_when_backup_fails` (SFTP, `backup_fail=True` on the `cp -a`) and `test_ftp_deploy_does_not_prune_when_backup_fails` (FTP, `copy_fail=True` on `SITE`) both assert `exit code == 1` and an empty removed/deleted list. `test_backup_failure_message_is_distinct_from_connection_error` asserts the message names the backup step and does not contain "Verbindung zum Server", keeping Req 6.17 honored.

### Retention is server-side and decoupled from import-backup limits

`_prune_predeploy_backups_server` lists `remote_base` with `ls -1`, keeps only entries starting with `predeploy-`, sorts lexicographically (timestamp names make that chronological), and `rm -rf`s the oldest until at most `max_count` remain. The count comes from `_max_predeploy_backups`, which returns `config.backup.max_predeploy_backups` when set and otherwise `MAX_PREDEPLOY_BACKUPS = 5` — it never reads `max_last_backups`/`max_archival_backups`. The retention deletions are best-effort: a failed `ls` or `rm` writes a warning and returns rather than failing the already-successful backup.

`test_predeploy_backup_retention_keeps_five_server_side` seeds 7 existing folders plus the new one via `ls_output` and asserts exactly `8 - MAX_PREDEPLOY_BACKUPS` = 3 `rm -rf` commands targeting the oldest. `test_predeploy_backup_respects_config_override` sets `max_predeploy_backups = 2` and asserts `5 - 2` = 3 deletions, exercising the override.

### AUFGABE 1 and the import-backup mechanism are untouched

`_resolve_dist_dir` is byte-for-byte unchanged, and both `_deploy_sftp` and `_deploy_ftp` still call it as the deploy root. `test_deploy_uploads_browser_build_as_remote_root` and `test_resolve_dist_dir_flat_and_nested` remain and still assert `index.html` lands directly under `remote_path` with no `ng-weinsprechstunde/browser` prefix. The leftover `_download_sftp`/`_download_ftp`/`_sftp_download_dir`/`_ftp_download_dir` functions are not dead code from the removed variant — they are the import-backup path used by `_remote_backup` (via `phase_backup`) and `download_remote_import`, which the predeploy rework does not call. The two backup mechanisms stay separate as required.

### Spec consistency

requirements.md 15–18 and design.md's Pre-Deploy-Backup / Retention bullets both describe the server-side copy, the `remote_backup_dir` target, the SSH-exec `cp -a` (SFTP) and `SITE CPFR`/`CPTO` (FTP) mechanisms, retention of 5 via `MAX_PREDEPLOY_BACKUPS` with the optional `max_predeploy_backups` override, and the fail-closed abort. The deploy requirements stay in the Requirement-6 area (14 = build path, 15–18 = pre-deploy backup), and no "lokaler Download" wording survives in either file.

</details>

<details>
<summary>File map</summary>

- `scripts/weinimport.py` — replaced local-download predeploy helpers with `_predeploy_server_backup_sftp/_ftp`; added `_predeploy_remote_backup_dir`, `_max_predeploy_backups`, `_ssh_exec`, `_shq`, `_ftp_server_copy_dir`, `_ftp_rmtree`, server-side retention prunes; added `BackupConfig.max_predeploy_backups`; deploy functions now call the server-side backup before prune. AUFGABE 1 (`_resolve_dist_dir`) unchanged.
- `scripts/tests/test_deploy.py` — removed local-download tests and `FakeSFTP.get`/`download_fail_on`; added `FakeChannel` + SSH-exec-capable `FakeTransport`; FTP fake gained `SITE` copy, `rmd`, `copy_fail`; rewrote the four behavior tests for server-side semantics plus a config-override test.
- `.kiro/specs/weinliste/requirements.md` — requirements 15/16/18 rewritten to the server-side variant with retention 5 and optional override.
- `.kiro/specs/weinliste/design.md` — Pre-Deploy-Backup and Retention bullets rewritten to server-side copy, SSH-exec vs SITE copy, retention 5.

Full diff: `git -C /Users/za_jonas/repos/weinsprechstunde2 diff HEAD~1...HEAD`

</details>
