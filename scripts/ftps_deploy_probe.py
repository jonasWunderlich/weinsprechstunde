#!/usr/bin/env python3
"""Diagnose: FTPES-Deploy Schritt fuer Schritt mit Fortschritt + Zeitmessung.

Stellt die vier Phasen von _deploy_ftp einzeln nach und gibt nach JEDEM
Kommando eine Zeile aus, damit man live sieht, WO es haengt. Nutzt dieselbe
TLS-Session-Reuse-Verbindung wie das Produktionsskript.

Dieser Probe VERAENDERT den Server: er laedt dist + wines.json + Bilder hoch
(wie der echte Deploy), fuehrt aber KEINEN Prune/Delete aus. Abbruch mit Ctrl+C
jederzeit moeglich; der zuletzt gedruckte Schritt zeigt die haengende Stelle.

Aufruf:
    .venv/bin/python scripts/ftps_deploy_probe.py
Optional nur Verbindungs-/Timing-Test ohne Upload:
    DRY=1 .venv/bin/python scripts/ftps_deploy_probe.py
"""
import ftplib
import io
import json
import os
import ssl
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import weinimport  # noqa: E402  nutzt _ReuseTLS_FTP, _resolve_dist_dir etc.

CONFIG_PATH = ROOT / "weinsprechstunde.config.json"
SECRETS_PATH = ROOT / "weinsprechstunde.secrets.json"
DRY = os.environ.get("DRY") == "1"


def t(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load():
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    sec = json.loads(SECRETS_PATH.read_text(encoding="utf-8")) if SECRETS_PATH.exists() else {}
    d = cfg["deploy"]
    host = d.get("host") or sec.get("host") or os.environ.get("WEINSPRECHSTUNDE_DEPLOY_HOST", "")
    user = d.get("user") or sec.get("user") or os.environ.get("WEINSPRECHSTUNDE_DEPLOY_USER", "")
    pw = d.get("password") or sec.get("password") or os.environ.get("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", "")
    return cfg, d, host, user, pw


def timed(label, fn):
    t(f"-> {label} ...")
    start = time.time()
    try:
        res = fn()
        t(f"   OK {label}  ({time.time()-start:.2f}s)")
        return res
    except Exception as e:
        t(f"   FEHLER {label}: {e!r}  ({time.time()-start:.2f}s)")
        raise


def main():
    cfg, d, host, user, pw = load()
    if not (host and user and pw):
        t("FEHLER: host/user/password fehlen.")
        return 1

    ctx = ssl.create_default_context() if os.environ.get("FTPS_VERIFY") == "1" else ssl._create_unverified_context()
    t(f"Verbinde zu {host} als {user} ...")
    ftp = weinimport._ReuseTLS_FTP(context=ctx)
    timed("connect", lambda: ftp.connect(host, 21, timeout=30))
    timed("auth (TLS)", ftp.auth)
    timed("login", lambda: ftp.login(user, pw))
    timed("prot_p", ftp.prot_p)
    ftp.set_pasv(True)

    remote_base = d["remote_path"]
    images_base = d["remote_images_path"]
    import_base = d["remote_import_path"]

    # Einzelne Diagnose-Kommandos, jedes mit Timing:
    timed(f"PWD", ftp.pwd)
    timed(f"MLSD {remote_base} (Listing dist-Wurzel)", lambda: list(ftp.mlsd(remote_base)))
    timed(f"MDTM {remote_base}/index.html (Timestamp-Abfrage)",
          lambda: ftp.sendcmd(f"MDTM {remote_base.rstrip('/')}/index.html"))
    timed(f"MLSD {images_base} (Listing Bilderordner, 476 Dateien)",
          lambda: ("entries=" + str(len(list(ftp.mlsd(images_base))))))

    # MDTM auf ein einzelnes Bild (so macht es der Bilder-Upload-Schritt):
    images_dir = Path(cfg["image_export_dir"])
    first_img = next((p for p in sorted(images_dir.iterdir()) if p.is_file()), None)
    if first_img:
        rimg = f"{images_base.rstrip('/')}/{first_img.name}"
        timed(f"MDTM {rimg} (Timestamp eines Bildes)",
              lambda: ftp.sendcmd(f"MDTM {rimg}"))

    if DRY:
        t("DRY=1 -> kein Upload, Verbindung schliessen.")
        ftp.quit()
        return 0

    # STRESS-Test: viele Transfers IN FOLGE auf derselben Verbindung.
    # Reproduziert den echten Deploy (hunderte STOR/MDTM nacheinander).
    # Wenn es an einem bestimmten N haengt -> TLS-Session-Reuse/Datenkanal-Problem.
    n = int(os.environ.get("STRESS", "60"))
    t(f"STRESS-Test: {n} STOR/MDTM/DELE in Folge nach {images_base} ...")
    for i in range(n):
        name = f"{images_base.rstrip('/')}/_probe_{i}.txt"
        s = time.time()
        ftp.storbinary(f"STOR {name}", io.BytesIO(b"x" * 2000))
        ftp.sendcmd(f"MDTM {name}")
        ftp.delete(name)
        dt = time.time() - s
        flag = "  <-- LANGSAM" if dt > 1.0 else ""
        t(f"   #{i:03d}  {dt:.2f}s{flag}")
    t("STRESS-Test komplett ohne Haenger. Verbindung schliessen.")
    ftp.quit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
