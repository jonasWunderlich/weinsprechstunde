#!/usr/bin/env python3
"""Weinsprechstunde WordPress-Migrations-Skript.

Eigenständiges, einmalig ausführbares CLI. Parst die rohen mysqldump-Textdateien
aus ``migrate_wordpress/`` (keine echte MySQL-DB nötig) und erzeugt JSON-Weindateien
plus Bilder im Import-Ordner. Das Ergebnis ist mit der regulären Phase prepare von
``weinimport.py`` kompatibel (nur ``name`` als Pflichtfeld).

Kontrollierter Zwei-Schritt-Prozess:
    analyze  -> erzeugt wordpress-mapping.json (Vorschlag), schreibt KEINE Daten/Bilder
    migrate  -> liest die geprüfte wordpress-mapping.json, erzeugt Weindaten + Bilder

Maßgeblich ist der Pseudocode in ``.kiro/specs/weinliste/design.md``,
Abschnitt „4. WordPress-Migrations-Skript", sowie Requirement 20 (20.1–20.20).
Code bleibt 3.12-kompatibel; deutsche Meldungen auf stderr konsistent zu weinimport.py.

Hinweis zur Import-Ordner-Behandlung: Da die Migration die „erste Datengrundlage"
bildet, werden die WordPress-Daten additiv zu bereits vorhandenen Import-Dateien
abgelegt. Bestehende Dateien werden nicht gelöscht; bei Namenskollisionen vergibt
``write_json`` ein Zähler-Suffix, sodass keine vorhandene Datei überschrieben wird.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Konstanten
# ---------------------------------------------------------------------------

# Der Custom-Post-Type der Weine im realen Dump ist "weinsprechstunde" (557
# Posts). design.md/Task 11 nennen irrtümlich "spontansprechstunde" als
# post_type; in den echten Daten ist "spontansprechstunde" jedoch ein ACF
# meta_key (ein boolesches Flag, Wert '0', 558 Vorkommen), NICHT der post_type.
# Der post_type lautet "weinsprechstunde". Ohne diese Korrektur würden 0 Weine
# erkannt und das Skript wäre auf den realen Daten nutzlos.
WINE_POST_TYPE = "weinsprechstunde"
MAPPING_PATH = "wordpress-mapping.json"
MIGRATE_DIR = "migrate_wordpress"
IMPORT_DIR = "import"
CONFIG_PATH = "weinsprechstunde.config.json"

# INSERT_RE matcht nur Tabelle + Spalten + den Beginn der VALUES-Sektion. Die
# eigentlichen Werte werden anschließend zeichenweise/quote-bewusst zerlegt, weil
# der reale Dump serialisierte PHP-Werte mit eingebetteten Semikolons und
# maskierten Quotes enthält (z. B. a:1:{i:0;s:0:\"\";}).
INSERT_RE = re.compile(
    r"INSERT INTO `(?P<table>\w+)`\s*\((?P<cols>[^)]*)\)\s*VALUES\s*",
    re.IGNORECASE,
)

# Größen-/Scaled-Suffixe von WordPress-Bildvarianten (z. B. -150x150, -scaled).
SIZE_SUFFIX_RE = re.compile(r"-\d+x\d+$|-scaled$")

# Bekannte, eindeutige Direktzuordnungen als Vorschlag für den Analyse-Schritt.
# Alle übrigen Nutzdaten-Felder landen bewusst als "unmapped"; der Benutzer
# entscheidet in der wordpress-mapping.json über weitergehende Zuordnungen.
KNOWN_MAPPINGS: dict[str, str] = {
    "name": "name",
    "preis": "price",
}

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif")
# Mindest-Ähnlichkeit für die Fallback-Bildzuordnung über den Dateinamen.
NAME_MATCH_THRESHOLD = 0.6


# ---------------------------------------------------------------------------
# Datenmodelle
# ---------------------------------------------------------------------------


@dataclass
class WinePost:
    id: int
    title: str
    date: str
    post_type: str


@dataclass
class ParsedDump:
    path: Path
    tables: dict[str, list[dict]]

    @property
    def wine_post_count(self) -> int:
        """Anzahl der Posts mit post_type == WINE_POST_TYPE."""
        return sum(
            1
            for row in self.tables.get("posts", [])
            if row.get("post_type") == WINE_POST_TYPE
        )


@dataclass
class MigrationReport:
    primary_source: str = ""
    primary_reason: str = ""
    wines_detected: int = 0
    wines_created: int = 0
    mapped_keys: set[str] = field(default_factory=set)
    unmapped_keys: set[str] = field(default_factory=set)
    ignored_keys: set[str] = field(default_factory=set)
    images_assigned: int = 0
    images_unassigned: int = 0

    def print(self) -> None:
        print("=== WordPress-Migration – Bericht ===")
        print(f"Primäre Datenquelle : {self.primary_source} ({self.primary_reason})")
        print(f"Erkannte Weine       : {self.wines_detected}")
        print(f"Erstellte JSON-Dateien: {self.wines_created}")
        print(f"Gemappte Felder      : {len(self.mapped_keys)}")
        print(
            f"Unmapped Felder (als wp_unmapped_* erhalten): "
            f"{len(self.unmapped_keys)}"
        )
        print(f"Ignorierte Felder    : {len(self.ignored_keys)}")
        print(f"Zugeordnete Bilder   : {self.images_assigned}")
        print(
            f"Übernommene Bilder ohne Zuordnung: {self.images_unassigned}"
        )
        print("Gemappte Felder:")
        for key in sorted(self.mapped_keys):
            print(f"  - {key}")
        print("Unmapped Felder (als wp_unmapped_* erhalten):")
        for key in sorted(self.unmapped_keys):
            print(f"  - {key}")
        print("Ignorierte Felder:")
        for key in sorted(self.ignored_keys):
            print(f"  - {key}")


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------


def slugify_name(name: str) -> str:
    """Name -> URL-freundlicher Slug (python-slugify).

    Eigenständige Definition (identisch zu weinimport.slugify_name), damit das
    Skript ohne Importabhängigkeit auf weinimport lauffähig bleibt.
    """
    from slugify import slugify

    return slugify(name)


def iso_date(raw: Optional[str]) -> Optional[str]:
    """mysqldump-Datum ("YYYY-MM-DD HH:MM:SS") -> ISO-Datum "YYYY-MM-DD"."""
    if not raw or not isinstance(raw, str):
        return None
    candidate = raw.strip()[:10]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", candidate):
        return candidate
    return None


# ---------------------------------------------------------------------------
# SQL-Parsing
# ---------------------------------------------------------------------------


def _strip_prefix(table: str) -> str:
    """Tabellen-Präfix normalisieren.

    "wp_posts" -> "posts"; "wp_weinposts" -> "posts". Das längere "wp_wein"
    wird zuerst geprüft, damit der Standard-Präfix "wp_" nicht vorzeitig greift.
    """
    for prefix in ("wp_wein", "wp_"):
        if table.startswith(prefix):
            return table[len(prefix):]
    return table


def _parse_values(tuple_str: str) -> list[Any]:
    """Einen VALUES-Tupelinhalt (ohne äußere Klammern) in Python-Werte zerlegen.

    Unterstützt die mysqldump-Standard-Escapes \\' \\" \\\\ \\n \\r \\t \\0,
    ``NULL`` (ohne Quotes) -> None, Ganzzahlen -> int, Dezimalzahlen -> float,
    alles in Single-Quotes -> str.
    """
    values: list[Any] = []
    i = 0
    n = len(tuple_str)
    escapes = {
        "'": "'",
        '"': '"',
        "\\": "\\",
        "n": "\n",
        "r": "\r",
        "t": "\t",
        "0": "\0",
    }
    while i < n:
        # Führende Trennzeichen/Whitespace überspringen.
        while i < n and tuple_str[i] in ", \t\r\n":
            i += 1
        if i >= n:
            break
        if tuple_str[i] == "'":
            # String-Literal.
            i += 1
            chars: list[str] = []
            while i < n:
                ch = tuple_str[i]
                if ch == "\\" and i + 1 < n:
                    nxt = tuple_str[i + 1]
                    chars.append(escapes.get(nxt, nxt))
                    i += 2
                    continue
                if ch == "'":
                    i += 1
                    break
                chars.append(ch)
                i += 1
            values.append("".join(chars))
        else:
            # Unquoted Token bis zum nächsten Komma (NULL / Zahl).
            start = i
            while i < n and tuple_str[i] != ",":
                i += 1
            token = tuple_str[start:i].strip()
            values.append(_coerce_scalar(token))
    return values


def _coerce_scalar(token: str) -> Any:
    """Unquoted SQL-Token (NULL / Zahl) zu einem Python-Wert machen."""
    if token == "" or token.upper() == "NULL":
        return None
    if re.fullmatch(r"-?\d+", token):
        return int(token)
    if re.fullmatch(r"-?\d+\.\d+", token):
        return float(token)
    return token


def _split_value_tuples(rows: str) -> list[str]:
    """Die VALUES-Sektion quote-bewusst in Tupelinhalte zerlegen.

    Liefert je ``(...)``-Tupel den Inhalt ohne die äußeren Klammern. Klammern und
    das statement-abschließende ``;`` werden nur außerhalb von String-Literalen
    beachtet; innerhalb eines Strings (maskierte Quotes berücksichtigt) werden
    ``(`` / ``)`` / ``;`` als normale Zeichen behandelt.
    """
    tuples: list[str] = []
    i = 0
    n = len(rows)
    while i < n:
        # Bis zur öffnenden Klammer eines Tupels vorrücken. Ein unmaskiertes ';'
        # außerhalb von Strings beendet das INSERT-Statement.
        while i < n and rows[i] != "(":
            if rows[i] == ";":
                return tuples
            i += 1
        if i >= n:
            break
        i += 1  # öffnende Klammer überspringen
        start = i
        in_string = False
        while i < n:
            ch = rows[i]
            if in_string:
                if ch == "\\" and i + 1 < n:
                    i += 2
                    continue
                if ch == "'":
                    in_string = False
                i += 1
                continue
            if ch == "'":
                in_string = True
                i += 1
                continue
            if ch == ")":
                break
            i += 1
        tuples.append(rows[start:i])
        i += 1  # schließende Klammer überspringen
    return tuples


def parse_sql_dump(path: Path) -> ParsedDump:
    """Eine mysqldump-Textdatei parsen und als ParsedDump zurückgeben."""
    text = path.read_text(encoding="utf-8", errors="replace")
    tables: dict[str, list[dict]] = {}
    for m in INSERT_RE.finditer(text):
        table = _strip_prefix(m.group("table"))
        cols = [c.strip(" `") for c in m.group("cols").split(",")]
        rows = text[m.end():]
        for tuple_str in _split_value_tuples(rows):
            values = _parse_values(tuple_str)
            tables.setdefault(table, []).append(dict(zip(cols, values)))
    return ParsedDump(path=path, tables=tables)


# ---------------------------------------------------------------------------
# Dump-Auswahl + Zusammenführung
# ---------------------------------------------------------------------------


def select_primary_dump(dumps: list[ParsedDump]) -> ParsedDump:
    """Dump mit den meisten erkannten Wein-Posts gewinnt (nicht Dateigröße)."""
    return max(dumps, key=lambda d: d.wine_post_count)


def merge_supplementary_tables(
    primary: ParsedDump, dumps: list[ParsedDump]
) -> ParsedDump:
    """Fehlende Tabellenzeilen aus separaten Exporten nachladen.

    Dedup über ``meta_id`` bzw. ``object_id``; fehlt beides, wird die Zeile
    konservativ übernommen (``id(row)`` ist stets eindeutig).
    """
    for dump in dumps:
        if dump is primary:
            continue
        for table, rows in dump.tables.items():
            primary.tables.setdefault(table, [])
            known_ids = {
                _row_key(r) for r in primary.tables[table]
            }
            for row in rows:
                key = _row_key(row)
                if key not in known_ids:
                    primary.tables[table].append(row)
                    known_ids.add(key)
    return primary


def _row_key(row: dict) -> Any:
    meta_id = row.get("meta_id")
    if meta_id is not None:
        return ("meta_id", meta_id)
    object_id = row.get("object_id")
    if object_id is not None:
        return ("object_id", object_id, row.get("term_taxonomy_id"))
    return id(row)


# ---------------------------------------------------------------------------
# ACF-Feld-Mapping + Postmeta-Zugriff
# ---------------------------------------------------------------------------


def suggest_target(key: str) -> Optional[str]:
    """Bekanntes WineSchema-Ziel vorschlagen oder None."""
    return KNOWN_MAPPINGS.get(key)


def suggest_action(key: str) -> str:
    """Vorgeschlagene action für einen meta_key ableiten."""
    if key.startswith("_") or key.startswith("field_"):
        return "ignore"  # interne ACF-Referenzen
    if key in KNOWN_MAPPINGS:
        return "map"
    return "unmapped"  # Nutzdaten ohne bekanntes Schema-Ziel


def extract_wine_posts(dump: ParsedDump) -> list[WinePost]:
    """Alle Posts mit post_type == WINE_POST_TYPE als WinePost zurückgeben."""
    posts: list[WinePost] = []
    for row in dump.tables.get("posts", []):
        if row.get("post_type") != WINE_POST_TYPE:
            continue
        posts.append(
            WinePost(
                id=int(row["ID"]),
                title=str(row.get("post_title") or ""),
                date=str(row.get("post_date") or ""),
                post_type=str(row.get("post_type") or ""),
            )
        )
    return posts


def get_postmeta(dump: ParsedDump, post_id: int) -> dict[str, Any]:
    """Alle meta_key -> meta_value eines Posts aus der postmeta-Tabelle."""
    meta: dict[str, Any] = {}
    for row in dump.tables.get("postmeta", []):
        if _as_int(row.get("post_id")) == post_id:
            key = row.get("meta_key")
            if key is not None:
                meta[str(key)] = row.get("meta_value")
    return meta


def get_meta(dump: ParsedDump, post_id: int, key: str) -> Optional[Any]:
    """Einzelnen meta_value eines Posts oder None."""
    for row in dump.tables.get("postmeta", []):
        if _as_int(row.get("post_id")) == post_id and row.get("meta_key") == key:
            return row.get("meta_value")
    return None


def _as_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Bild-Zuordnung
# ---------------------------------------------------------------------------


def resolve_image(
    dump: ParsedDump, post: WinePost, uploads_dir: Path
) -> Optional[Path]:
    """Bild zu einem Wein auflösen.

    Primär über die DB-Verknüpfung (_thumbnail_id -> Attachment-Post ->
    _wp_attached_file), Fallback über Namensähnlichkeit zum Slug.
    """
    thumb_id = get_meta(dump, post.id, "_thumbnail_id")
    thumb_int = _as_int(thumb_id)
    if thumb_int is not None:
        rel = get_meta(dump, thumb_int, "_wp_attached_file")
        if rel:
            candidate = uploads_dir / str(rel)
            if candidate.exists():
                return candidate
    # Fallback: Dateinamen-Ähnlichkeit zum Slug.
    return _best_match_by_name(uploads_dir, slugify_name(post.title))


def _best_match_by_name(uploads_dir: Path, slug: str) -> Optional[Path]:
    """Beste Bilddatei nach Namensähnlichkeit zum Slug (deterministisch)."""
    if not slug or not uploads_dir.exists():
        return None
    best_path: Optional[Path] = None
    best_score = 0.0
    for candidate in sorted(uploads_dir.rglob("*")):
        if not candidate.is_file():
            continue
        if candidate.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        stem = SIZE_SUFFIX_RE.sub("", candidate.stem)
        cand_slug = slugify_name(stem)
        if not cand_slug:
            continue
        if slug in cand_slug or cand_slug in slug:
            score = 1.0
        else:
            score = SequenceMatcher(None, slug, cand_slug).ratio()
        if score > best_score:
            best_score = score
            best_path = candidate
    if best_path is not None and best_score >= NAME_MATCH_THRESHOLD:
        return best_path
    return None


def pick_largest_variant(image: Path) -> Path:
    """Original (ohne Größen-Suffix) bevorzugen, sonst größte Variante."""
    stem = SIZE_SUFFIX_RE.sub("", image.stem)
    original = image.parent / f"{stem}{image.suffix}"
    if original.exists():
        return original
    variants = list(image.parent.glob(f"{stem}*{image.suffix}"))
    if variants:
        return max(variants, key=lambda p: p.stat().st_size)
    return image


def copy_to_import(src: Path, import_dir: str) -> Path:
    """Eine Bilddatei flach in den Import-Ordner kopieren (Zielname = Dateiname)."""
    dst_dir = Path(import_dir)
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / src.name
    if not dst.exists():
        shutil.copy2(src, dst)
    return dst


def copy_all_remaining_images(
    uploads_dir: Path, import_dir: str, report: MigrationReport
) -> None:
    """ALLE Original-/größten Bilder übernehmen (Req 20.18).

    Alle Uploads werden nach Variantenstamm gruppiert; pro Gruppe wird genau eine
    Datei (Original bzw. größte Variante) nach import_dir kopiert. Bereits beim
    Wein zugeordnete Dateien werden nicht erneut gezählt.
    """
    if not uploads_dir.exists():
        return
    dst_dir = Path(import_dir)
    dst_dir.mkdir(parents=True, exist_ok=True)
    already = {p.name for p in dst_dir.iterdir() if p.is_file()}

    # Nach Variantenstamm (Ordner + bereinigter Stamm + Suffix) gruppieren.
    groups: dict[tuple[str, str, str], list[Path]] = defaultdict(list)
    for candidate in sorted(uploads_dir.rglob("*")):
        if not candidate.is_file():
            continue
        if candidate.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        stem = SIZE_SUFFIX_RE.sub("", candidate.stem)
        group_key = (str(candidate.parent), stem, candidate.suffix.lower())
        groups[group_key].append(candidate)

    for members in groups.values():
        chosen = pick_largest_variant(members[0])
        if chosen.name in already:
            continue  # bereits einem Wein zugeordnet und kopiert
        dst = dst_dir / chosen.name
        if not dst.exists():
            shutil.copy2(chosen, dst)
        already.add(chosen.name)
        report.images_unassigned += 1


# ---------------------------------------------------------------------------
# JSON-Ausgabe
# ---------------------------------------------------------------------------


def write_json(import_dir: str, wine: dict) -> Path:
    """Einen Wein als JSON im Import-Ordner ablegen (keine Kollision überschreiben)."""
    dst_dir = Path(import_dir)
    dst_dir.mkdir(parents=True, exist_ok=True)
    slug = slugify_name(str(wine.get("name") or "wein")) or "wein"
    target = dst_dir / f"{slug}.json"
    counter = 2
    while target.exists():
        target = dst_dir / f"{slug}-{counter}.json"
        counter += 1
    target.write_text(
        json.dumps(wine, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return target


def _load_import_dir() -> str:
    """import_dir aus weinsprechstunde.config.json lesen, sonst Default."""
    try:
        raw = json.loads(Path(CONFIG_PATH).read_text(encoding="utf-8"))
        return raw.get("import_dir", IMPORT_DIR)
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return IMPORT_DIR


# ---------------------------------------------------------------------------
# Schritt 1: analyze
# ---------------------------------------------------------------------------


def analyze(migrate_dir: str = MIGRATE_DIR) -> None:
    """Dumps analysieren und wordpress-mapping.json erzeugen (keine Daten/Bilder)."""
    sql_files = sorted(Path(migrate_dir).glob("*.sql"))
    if not sql_files:
        sys.stderr.write(
            f"FEHLER: Keine .sql-Dateien in '{migrate_dir}' gefunden.\n"
        )
        sys.exit(1)
    dumps = [parse_sql_dump(f) for f in sql_files]
    primary = select_primary_dump(dumps)
    merge_supplementary_tables(primary, dumps)

    # Alle meta_keys über alle Weine sammeln (mit Häufigkeit).
    field_counts: dict[str, int] = defaultdict(int)
    for post in extract_wine_posts(primary):
        for key in get_postmeta(primary, post.id):
            field_counts[key] += 1

    # Mapping-Vorschlag erzeugen (absteigend nach Häufigkeit, Key als Tiebreaker).
    mapping: dict[str, dict] = {}
    for key, count in sorted(field_counts.items(), key=lambda x: (-x[1], x[0])):
        mapping[key] = {
            "target": suggest_target(key),
            "action": suggest_action(key),
            "_count": count,
        }

    Path(MAPPING_PATH).write_text(
        json.dumps(mapping, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print_analyze_report(primary, field_counts, mapping)


def print_analyze_report(
    primary: ParsedDump,
    field_counts: dict[str, int],
    mapping: dict[str, dict],
) -> None:
    """Analysebericht auf stdout ausgeben."""
    print("=== WordPress-Migration – Analysebericht ===")
    print(f"Primäre Datenquelle : {primary.path.name}")
    print(
        f"Begründung           : {primary.wine_post_count} erkannte Wein-Posts "
        f"(post_type='{WINE_POST_TYPE}') – meiste verwertbare Daten, "
        f"nicht nach Dateigröße gewählt."
    )
    print(f"Gefundene Felder     : {len(field_counts)}")
    print("Feld (Häufigkeit) -> vorgeschlagene action [target]:")
    for key, entry in mapping.items():
        target = entry["target"] if entry["target"] is not None else "-"
        print(
            f"  {key} ({entry['_count']}) -> {entry['action']} [{target}]"
        )
    print("")
    print(
        f"HINWEIS: Bitte '{MAPPING_PATH}' prüfen und ggf. anpassen "
        f"(action = map/unmapped/ignore, target setzen), bevor der "
        f"'migrate'-Schritt ausgeführt wird."
    )


# ---------------------------------------------------------------------------
# Schritt 2: migrate
# ---------------------------------------------------------------------------


def migrate(migrate_dir: str = MIGRATE_DIR, import_dir: str = IMPORT_DIR) -> None:
    """Weindaten + Bilder gemäß geprüfter wordpress-mapping.json erzeugen."""
    try:
        mapping = json.loads(Path(MAPPING_PATH).read_text(encoding="utf-8"))
    except FileNotFoundError:
        sys.stderr.write(
            f"FEHLER: '{MAPPING_PATH}' nicht gefunden. Bitte zuerst den "
            f"'analyze'-Schritt ausführen und die Datei prüfen.\n"
        )
        sys.exit(1)
    except json.JSONDecodeError as e:
        sys.stderr.write(
            f"FEHLER: '{MAPPING_PATH}' ist kein valides JSON: {e}\n"
        )
        sys.exit(1)

    sql_files = sorted(Path(migrate_dir).glob("*.sql"))
    if not sql_files:
        sys.stderr.write(
            f"FEHLER: Keine .sql-Dateien in '{migrate_dir}' gefunden.\n"
        )
        sys.exit(1)
    dumps = [parse_sql_dump(f) for f in sql_files]
    primary = select_primary_dump(dumps)
    merge_supplementary_tables(primary, dumps)
    uploads_dir = Path(migrate_dir) / "uploads"

    report = MigrationReport(
        primary_source=primary.path.name,
        primary_reason=(
            f"{primary.wine_post_count} erkannte Wein-Posts "
            f"(meiste verwertbare Daten)"
        ),
    )

    for post in extract_wine_posts(primary):
        wine: dict = {}
        meta = get_postmeta(primary, post.id)
        for key, value in meta.items():
            if key not in mapping:
                sys.stderr.write(
                    f"FEHLER: Feld '{key}' kommt in den Dumps vor, ist aber "
                    f"nicht in {MAPPING_PATH} enthalten. Bitte ergänze es "
                    f"(map/unmapped/ignore) und führe die Migration erneut aus.\n"
                )
                sys.exit(1)

            entry = mapping[key]
            action = entry.get("action")

            # Leere Werte werden nicht übernommen – weder als gemapptes noch
            # als wp_unmapped_-Feld. Als leer gelten: None, leerer String,
            # nur Whitespace sowie der Platzhalterwert "0" bzw. 0 (in den
            # WordPress-Daten bedeutet "0" durchgängig "nicht gesetzt").
            if value is None:
                continue
            if isinstance(value, str) and value.strip() in ("", "0"):
                continue
            if isinstance(value, (int, float)) and value == 0:
                continue

            if action == "map":
                wine[entry["target"]] = value
                report.mapped_keys.add(key)
            elif action == "unmapped":
                wine[f"wp_unmapped_{key}"] = value
                report.unmapped_keys.add(key)
            else:  # "ignore" -> Wert vollständig verwerfen
                report.ignored_keys.add(key)

        if not wine.get("name"):
            wine["name"] = post.title
        if not wine.get("tasting_date"):
            derived = iso_date(post.date)
            if derived:
                wine["tasting_date"] = derived
        report.wines_detected += 1

        image = resolve_image(primary, post, uploads_dir)
        if image:
            best = pick_largest_variant(image)
            copy_to_import(best, import_dir)
            wine["image"] = best.name
            report.images_assigned += 1

        write_json(import_dir, wine)
        report.wines_created += 1

    # ALLE restlichen Bilder übernehmen (auch nicht zugeordnete).
    copy_all_remaining_images(uploads_dir, import_dir, report)
    report.print()


# ---------------------------------------------------------------------------
# CLI / main
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wordpress_migrate.py",
        description=(
            "Einmaliges WordPress-Migrations-Skript. Zwei-Schritt-Prozess: "
            "'analyze' erzeugt wordpress-mapping.json (Vorschlag), 'migrate' "
            "erzeugt Weindaten + Bilder gemäß geprüfter Mapping-Datei."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser(
        "analyze",
        help="Dumps analysieren und wordpress-mapping.json erzeugen.",
    )
    p_analyze.add_argument(
        "--migrate-dir",
        default=MIGRATE_DIR,
        help=f"Ordner mit den .sql-Dumps (Standard: {MIGRATE_DIR}).",
    )

    p_migrate = sub.add_parser(
        "migrate",
        help="Weindaten + Bilder gemäß geprüfter wordpress-mapping.json erzeugen.",
    )
    p_migrate.add_argument(
        "--migrate-dir",
        default=MIGRATE_DIR,
        help=f"Ordner mit den .sql-Dumps (Standard: {MIGRATE_DIR}).",
    )
    p_migrate.add_argument(
        "--import-dir",
        default=None,
        help=(
            "Zielordner für die erzeugten Weindaten/Bilder "
            "(Standard: import_dir aus der Config bzw. 'import')."
        ),
    )
    return parser


def main(argv: Optional[list[str]] = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "analyze":
        analyze(migrate_dir=args.migrate_dir)
    elif args.command == "migrate":
        import_dir = args.import_dir or _load_import_dir()
        migrate(migrate_dir=args.migrate_dir, import_dir=import_dir)


if __name__ == "__main__":
    main()
