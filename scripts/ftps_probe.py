#!/usr/bin/env python3
"""Read-only Verbindungstest: FTP mit explizitem TLS (FTPES).

Testet NUR Login + Verzeichnis-Listing. Es wird nichts hochgeladen,
verschoben oder gelöscht. Passwort kommt aus WEINSPRECHSTUNDE_DEPLOY_PASSWORD
und wird nicht ausgegeben.

Aufruf:
    export WEINSPRECHSTUNDE_DEPLOY_PASSWORD='...'
    .venv/bin/python scripts/ftps_probe.py
"""
import ftplib
import json
import os
import ssl
import sys
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent.parent / "weinsprechstunde.config.json"


def main() -> int:
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    deploy = cfg["deploy"]
    host = deploy["host"]
    user = deploy["user"]
    password = os.environ.get("WEINSPRECHSTUNDE_DEPLOY_PASSWORD", "")
    if not password:
        sys.stderr.write(
            "FEHLER: WEINSPRECHSTUNDE_DEPLOY_PASSWORD ist nicht gesetzt.\n"
            "  export WEINSPRECHSTUNDE_DEPLOY_PASSWORD='...'\n"
        )
        return 1

    remote_path = deploy.get("remote_path", "/")
    images = deploy.get("remote_images_path")
    import_path = deploy.get("remote_import_path")
    backup = cfg.get("backup", {}).get("remote_backup_dir")

    # Erst das Zertifikat ansehen (ohne Verifikation), um den ausgestellten
    # Hostnamen / die SANs zu erfahren. Reine Diagnose, keine Datenuebertragung.
    print(f"Pruefe TLS-Zertifikat von {host}:21 ...")
    try:
        diag_ctx = ssl._create_unverified_context()
        with ssl.create_connection((host, 21), timeout=20) as raw:
            # FTP: erst Banner lesen, dann AUTH TLS senden, dann TLS-Handshake
            raw.recv(1024)
            raw.sendall(b"AUTH TLS\r\n")
            raw.recv(1024)
            with diag_ctx.wrap_socket(raw, server_hostname=host) as tls:
                cert = tls.getpeercert()
                subject = dict(x[0] for x in cert.get("subject", []))
                sans = [v for k, v in cert.get("subjectAltName", [])]
                print(f"  Zertifikat ausgestellt auf (CN): {subject.get('commonName')!r}")
                print(f"  SubjectAltName: {sans}")
    except Exception as e:
        print(f"  Zertifikat-Diagnose fehlgeschlagen: {e}")

    print(f"\nVerbinde zu {host} als {user} (FTP + explizites TLS) ...")
    verify = os.environ.get("FTPS_VERIFY", "1") != "0"
    if verify:
        ctx = ssl.create_default_context()
    else:
        ctx = ssl._create_unverified_context()
        print("  (Zertifikatspruefung DEAKTIVIERT via FTPS_VERIFY=0 - Verbindung bleibt verschluesselt)")
    ftp = ftplib.FTP_TLS(context=ctx)
    try:
        ftp.connect(host, 21, timeout=20)
        print("  Kontrollverbindung steht. Starte TLS (AUTH TLS) ...")
        ftp.auth()                 # explizites TLS auf dem Kontrollkanal
        ftp.login(user, password)  # Login über verschlüsselte Verbindung
        ftp.prot_p()               # auch Datenkanal verschlüsseln
        print("  Login OK, TLS aktiv (Kontroll- + Datenkanal).")
        try:
            print(f"  Server-Feature: {ftp.sendcmd('FEAT')!r}")
        except ftplib.all_errors as e:
            print(f"  FEAT nicht verfügbar: {e}")

        print(f"\nAktuelles Verzeichnis: {ftp.pwd()}")
        print("Listing vom Login-Wurzelverzeichnis:")
        for name in ftp.nlst():
            print(f"    {name}")

        for label, path in (
            ("remote_path", remote_path),
            ("remote_images_path", images),
            ("remote_import_path", import_path),
            ("remote_backup_dir", backup),
        ):
            if not path:
                continue
            try:
                entries = ftp.nlst(path)
                print(f"\n{label} = {path!r}: {len(entries)} Eintraege")
                for name in entries[:10]:
                    print(f"    {name}")
                if len(entries) > 10:
                    print(f"    ... (+{len(entries) - 10} weitere)")
            except ftplib.all_errors as e:
                print(f"\n{label} = {path!r}: nicht lesbar ({e})")

        # Optionaler, eng begrenzter Schreibtest: NUR wenn FTPS_WRITE_TEST=1.
        # Laedt genau eine kleine Testdatei in die angegebenen Zielordner hoch
        # und loescht sie direkt wieder. Dient dazu, herauszufinden, welcher
        # Ordner unter der Domain ausgeliefert wird.
        if os.environ.get("FTPS_WRITE_TEST") == "1":
            import io
            marker = f"weinsprechstunde-ftps-probe"
            targets = [t for t in ("", "www") if True]  # Login-Root und /www
            print("\nSchreibtest (FTPS_WRITE_TEST=1): lade Testdatei hoch und loesche sie wieder ...")
            for folder in targets:
                remote_name = f"{folder + '/' if folder else ''}_probe_delete_me.txt"
                try:
                    ftp.storbinary(f"STOR {remote_name}", io.BytesIO(marker.encode()))
                    print(f"    Upload OK -> {remote_name!r}")
                    print(f"      => Pruefe im Browser, ob erreichbar unter: "
                          f"https://weinsprechstunde.de/"
                          f"{'' if folder in ('', 'www') else folder + '/'}_probe_delete_me.txt")
                    try:
                        ftp.delete(remote_name)
                        print(f"      wieder geloescht: {remote_name!r}")
                    except ftplib.all_errors as e:
                        print(f"      KONNTE NICHT loeschen ({e}) - bitte manuell entfernen: {remote_name!r}")
                except ftplib.all_errors as e:
                    print(f"    Upload nach {remote_name!r} fehlgeschlagen: {e}")

        # Prüfen, ob die serverseitige Kopie (SITE CPFR/CPTO) unterstützt wird,
        # OHNE etwas zu kopieren: nur SITE HELP abfragen.
        print("\nPruefe serverseitige Kopier-Erweiterung (SITE HELP) ...")
        try:
            help_txt = ftp.sendcmd("SITE HELP")
            has_copy = "CPFR" in help_txt.upper() or "CPTO" in help_txt.upper()
            print(f"  SITE HELP: {help_txt!r}")
            print(f"  CPFR/CPTO (serverseitiges Kopieren) verfuegbar: {has_copy}")
        except ftplib.all_errors as e:
            print(f"  SITE HELP nicht verfuegbar: {e}")

        print("\nVerbindungstest erfolgreich (read-only, nichts veraendert).")
        return 0
    except ftplib.all_errors as e:
        sys.stderr.write(f"\nFEHLER bei der FTPES-Verbindung: {e}\n")
        return 1
    finally:
        try:
            ftp.quit()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
