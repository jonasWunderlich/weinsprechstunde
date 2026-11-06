#!/usr/bin/env python3
"""Gezielter FTPES-Upload-Test mit TLS-Session-Reuse.

Hintergrund: Viele FTPS-Server (u. a. Pure-FTPd) verlangen, dass die
Datenverbindung dieselbe TLS-Session wie der Kontrollkanal wiederverwendet.
Pythons ftplib.FTP_TLS tut das standardmäßig NICHT -> Upload/Listing hängt.
Diese Probe testet eine FTP_TLS-Variante mit Session-Reuse und lädt EINE
kleine Testdatei nach remote_path hoch, listet remote_path und löscht die Datei
wieder. Minimal-invasiv: nur eine Testdatei, danach wieder entfernt.

Aufruf (Zugangsdaten aus weinsprechstunde.secrets.json ODER Env):
    .venv/bin/python scripts/ftps_upload_probe.py
"""
import ftplib
import io
import json
import os
import socket
import ssl
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "weinsprechstunde.config.json"
SECRETS_PATH = ROOT / "weinsprechstunde.secrets.json"


class ReuseFTP_TLS(ftplib.FTP_TLS):
    """FTP_TLS, das die Kontroll-TLS-Session auf dem Datenkanal wiederverwendet.

    Das ist der entscheidende Unterschied zum Standard-FTP_TLS und behebt das
    typische 'hängt beim Upload/Listing'-Problem bei Servern mit erzwungenem
    TLS-Session-Reuse (Pure-FTPd, vsftpd mit require_ssl_reuse).
    """

    def ntransfercmd(self, cmd, rest=None):
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            session = self.sock.session  # TLS-Session des Kontrollkanals
            conn = self.context.wrap_socket(
                conn, server_hostname=self.host, session=session
            )
        return conn, size


def load_creds():
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    deploy = cfg.get("deploy", {})
    secrets = {}
    if SECRETS_PATH.exists():
        secrets = json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
    host = deploy.get("host") or secrets.get("host") or os.environ.get("WEINSPRECHSTUNDE_DEPLOY_HOST", "")
    user = deploy.get("user") or secrets.get("user") or os.environ.get("WEINSPRECHSTUNDE_DEPLOY_USER", "")
    password = (deploy.get("password") or secrets.get("password")
                or os.environ.get("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", ""))
    remote_path = deploy.get("remote_path", "/")
    return host, user, password, remote_path


def main() -> int:
    host, user, password, remote_path = load_creds()
    if not (host and user and password):
        sys.stderr.write("FEHLER: host/user/password fehlen (Secrets-Datei/Env pruefen).\n")
        return 1

    ctx = ssl._create_unverified_context()
    print(f"Verbinde zu {host} als {user} (FTPES, TLS-Session-Reuse) ...")
    ftp = ReuseFTP_TLS(context=ctx)
    ftp.connect(host, 21, timeout=30)
    ftp.auth()
    ftp.login(user, password)
    ftp.prot_p()
    ftp.set_pasv(True)
    print("  Login OK, TLS aktiv.")

    target_dir = remote_path.rstrip("/") or "/"
    test_name = f"{target_dir.rstrip('/')}/_upload_probe_delete_me.txt"
    try:
        print(f"  Listing {target_dir} (Datenkanal-Test) ...")
        names = ftp.nlst(target_dir)
        print(f"    {len(names)} Eintraege: {names[:8]}")

        print(f"  Upload-Test -> {test_name} ...")
        ftp.storbinary(f"STOR {test_name}", io.BytesIO(b"upload-probe-ok"))
        print("    Upload OK.")

        ftp.delete(test_name)
        print("    Testdatei wieder geloescht.")
        print("\nERFOLG: Upload + Listing mit TLS-Session-Reuse funktionieren.")
        return 0
    except (ftplib.all_errors, socket.timeout) as e:
        sys.stderr.write(f"\nFEHLER beim Datentransfer: {e!r}\n")
        return 1
    finally:
        try:
            ftp.quit()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
