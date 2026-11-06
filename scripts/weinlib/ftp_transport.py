"""FTPES-Transport (gemeinsam für Deploy, Backup und Remote-Download)."""

from __future__ import annotations

import ftplib
import os
import ssl
from pathlib import Path


# ---------------------------------------------------------------------------
# Transport-Helfer (gemeinsam für Deploy UND Remote-Download, Req 1.10)
# ---------------------------------------------------------------------------


class _ReuseTLS_FTP(ftplib.FTP_TLS):
    """FTP_TLS, das die Kontroll-TLS-Session auf dem Datenkanal wiederverwendet.

    Pure-FTPd (Host Europe) verlangt, dass die Datenverbindung dieselbe
    TLS-Session wie der Kontrollkanal benutzt. Pythons Standard-``FTP_TLS`` tut
    das NICHT, weshalb der Datentransfer (Prune-Listing/Upload/Download) gegen
    den Produktivserver hängt. Dieses Override reicht die TLS-Session des
    Kontrollkanals an den Datenkanal weiter und behebt die Blockade.

    Verifiziert gegen den echten Server via scripts/ftps_upload_probe.py.
    """

    def ntransfercmd(self, cmd, rest=None):  # noqa: D102 (ftplib-Signatur)
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        # Nur wenn der Datenkanal verschlüsselt ist (prot_p) und der
        # Kontroll-Socket tatsächlich eine via SSLContext aufgebaute Session
        # trägt, die Session auf dem Datenkanal wiederverwenden. Fehlt die
        # Session (z. B. kein SSLSocket), bleibt es beim Standardverhalten.
        if self._prot_p:
            session = getattr(self.sock, "session", None)
            if session is not None:
                conn = self.context.wrap_socket(
                    conn, server_hostname=self.host, session=session
                )
        return conn, size


def _ftps_connect(host: str, user: str, password: str) -> "ftplib.FTP_TLS":
    """FTP-Verbindung mit explizitem TLS (FTPES) öffnen und einloggen.

    Vorlage: scripts/ftps_probe.py. Standardmäßig wird das Serverzertifikat
    NICHT verifiziert (``ssl._create_unverified_context``), weil der Webspace
    ein Zertifikat mit abweichendem Hostnamen ausliefert; die Verbindung bleibt
    dennoch TLS-verschlüsselt. Mit ``FTPS_VERIFY=1`` lässt sich die reguläre
    Zertifikatsprüfung aktivieren.

    Verwendet ``_ReuseTLS_FTP``, damit der Datenkanal die TLS-Session des
    Kontrollkanals wiederverwendet (Pflicht für Pure-FTPd/Host Europe).
    """
    verify = os.environ.get("FTPS_VERIFY", "0") != "0"
    ctx = ssl.create_default_context() if verify else ssl._create_unverified_context()
    ftp = _ReuseTLS_FTP(context=ctx)
    ftp.connect(host, 21, timeout=20)
    ftp.auth()                 # explizites TLS auf dem Kontrollkanal
    ftp.login(user, password)  # Login über verschlüsselte Verbindung
    ftp.prot_p()               # auch Datenkanal verschlüsseln
    ftp.set_pasv(True)
    return ftp


def _upload_ftp(ftp: "ftplib.FTP", local_file: Path, remote_file: str) -> None:
    """Eine lokale Datei per FTP hochladen."""
    with open(local_file, "rb") as fh:
        ftp.storbinary(f"STOR {remote_file}", fh)


def _download_ftp(host: str, user: str, password: str, remote_path: str,
                  local_path: Path) -> None:
    """Remote-Verzeichnis rekursiv per FTPES nach local_path herunterladen."""
    ftp = _ftps_connect(host, user, password)
    try:
        local_path.mkdir(parents=True, exist_ok=True)
        _ftp_download_dir(ftp, remote_path, local_path)
    finally:
        ftp.quit()


def _ftp_is_dir(ftp: "ftplib.FTP", path: str) -> bool:
    current = ftp.pwd()
    try:
        ftp.cwd(path)
        ftp.cwd(current)
        return True
    except ftplib.error_perm:
        return False


def _ftp_list_entries(ftp: "ftplib.FTP", remote_dir: str) -> list[tuple[str, bool]]:
    """Einträge eines Remote-Verzeichnisses als (basename, is_dir) auflisten.

    Nutzt primär ``MLSD`` (RFC 3659): EIN Listing-Roundtrip liefert pro Eintrag
    direkt den Typ (``type=dir``/``cdir``/``pdir`` vs. ``file``), sodass KEIN
    ``_ftp_is_dir`` (zwei ``cwd``-Roundtrips pro Eintrag) mehr nötig ist. Das
    eliminiert die ~1000 TLS-Roundtrips, die den Prune über ``/wine_app/images``
    (~476 Bilder) blockiert haben.

    Fällt ``MLSD`` aus (Server ohne MLSD-Support o. Ä.), wird robust auf das
    bisherige Verhalten (``nlst`` + ``_ftp_is_dir`` pro Eintrag) zurückgefallen.
    """
    try:
        entries: list[tuple[str, bool]] = []
        for base, facts in ftp.mlsd(remote_dir):
            if base in (".", ".."):
                continue
            entry_type = (facts.get("type") or "").lower()
            if entry_type in ("cdir", "pdir"):
                continue
            entries.append((base, entry_type == "dir"))
        return entries
    except (ftplib.error_perm, ftplib.error_proto, AttributeError, OSError):
        # Fallback: nlst + cwd-basierte Typerkennung (altes Verhalten).
        result: list[tuple[str, bool]] = []
        for name in ftp.nlst(remote_dir):
            base = name.rsplit("/", 1)[-1]
            if base in (".", ".."):
                continue
            remote_entry = name if "/" in name else f"{remote_dir.rstrip('/')}/{name}"
            result.append((base, _ftp_is_dir(ftp, remote_entry)))
        return result


def _ftp_download_dir(ftp: "ftplib.FTP", remote_dir: str, local_dir: Path) -> None:
    local_dir.mkdir(parents=True, exist_ok=True)
    for base, is_dir in _ftp_list_entries(ftp, remote_dir):
        remote_entry = f"{remote_dir.rstrip('/')}/{base}"
        local_entry = local_dir / base
        if is_dir:
            _ftp_download_dir(ftp, remote_entry, local_entry)
        else:
            with open(local_entry, "wb") as fh:
                ftp.retrbinary(f"RETR {remote_entry}", fh.write)


def _ftp_makedirs(ftp: "ftplib.FTP", remote_dir: str) -> None:
    parts = remote_dir.strip("/").split("/")
    path = ""
    for part in parts:
        path = f"{path}/{part}"
        try:
            ftp.mkd(path)
        except ftplib.error_perm:
            pass
