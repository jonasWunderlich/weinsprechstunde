"""Pipeline-Phasen: prepare, export, image-export und optimize-images."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from weinlib.config import Config, OptimizeConfig, SchemaField, get_scaffold_fields



# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------


ARCHIVE_DIR_NAME = "_archive"


def collect_json_files(import_dir: str) -> list[Path]:
    """Rekursiv alle .json-Dateien in import_dir erfassen.

    Der Archiv-Ordner ``import_dir/_archive/`` wird vollständig übersprungen
    (Req 17.51): Dateien darin fließen weder in prepare/export noch in den
    Bildexport ein. Da ``collect_json_files`` die zentrale Dateierfassung aller
    drei Phasen (prepare, export, image-export) ist, genügt diese eine Stelle –
    keine verstreute Sonderbehandlung in den Phasen. Da der Bildexport Bilder
    ausschließlich über das ``image``-Feld der eingesammelten JSON-Dateien
    auflöst, bleiben auch im Archiv liegende Bilder automatisch unexportiert.
    """
    root = Path(import_dir)
    return sorted(
        p for p in root.rglob("*.json")
        if ARCHIVE_DIR_NAME not in p.relative_to(root).parts
    )


def slugify_name(name: str) -> str:
    """Name -> URL-freundlicher Slug (python-slugify)."""
    from slugify import slugify

    return slugify(name)


def find_image_sibling(json_path: Path) -> str | None:
    """Bilddatei mit gleichem Basisnamen im selben Verzeichnis suchen."""
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        candidate = json_path.with_suffix(ext)
        if candidate.exists():
            return candidate.name
    return None


def read_exif_date(image_path: Path) -> str | None:
    """EXIF DateTimeOriginal -> ISO-8601-Datumsstring (piexif)."""
    try:
        import piexif

        exif = piexif.load(str(image_path))
        dt_bytes = exif["Exif"].get(piexif.ExifIFD.DateTimeOriginal)
        if dt_bytes:
            dt_str = dt_bytes.decode()  # "YYYY:MM:DD HH:MM:SS"
            return dt_str[:10].replace(":", "-")
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Phase prepare
# ---------------------------------------------------------------------------


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def collect_image_files(import_dir: str) -> list[Path]:
    """Rekursiv alle Bilddateien in ``import_dir`` erfassen; ``_archive`` wird
    vollständig übersprungen (konsistent mit ``collect_json_files``, Req 17.51)."""
    root = Path(import_dir)
    return sorted(
        p
        for p in root.rglob("*")
        if p.is_file()
        and p.suffix.lower() in IMAGE_EXTENSIONS
        and ARCHIVE_DIR_NAME not in p.relative_to(root).parts
    )


def optimize_image(path: Path, max_height: int, quality: int) -> bool:
    """Skaliert ein einzelnes Bild **in-place** auf ``max_height`` (Höhe), sofern es
    höher ist; Seitenverhältnis bleibt erhalten. Gibt ``True`` zurück, wenn das Bild
    verkleinert wurde, sonst ``False`` (bereits klein genug / übersprungen).

    Nur Bilder, deren Höhe ``max_height`` überschreitet, werden angefasst – dadurch ist
    die Optimierung idempotent und berührt effektiv nur neu hinzugekommene zu große
    Bilder. JPEG wird progressiv/optimiert, PNG mit maximaler Kompression gespeichert;
    die EXIF-Ausrichtung wird vor dem Skalieren angewandt.
    """
    from PIL import Image, ImageOps

    with Image.open(path) as opened:
        _, height = opened.size
        if height <= max_height:
            return False

        img = ImageOps.exif_transpose(opened)
        width, height = img.size
        scale = max_height / height
        new_width = max(1, round(width * scale))
        img = img.resize((new_width, max_height), Image.Resampling.LANCZOS)

        suffix = path.suffix.lower()
        if suffix in {".jpg", ".jpeg"}:
            if img.mode not in ("RGB", "L"):
                if img.mode == "RGBA":
                    background = Image.new("RGB", img.size, (255, 255, 255))
                    background.paste(img, mask=img.getchannel("A"))
                    img = background
                else:
                    img = img.convert("RGB")
            img.save(path, format="JPEG", quality=quality, optimize=True, progressive=True)
        elif suffix == ".png":
            img.save(path, format="PNG", optimize=True, compress_level=9)
        elif suffix == ".webp":
            img.save(path, format="WEBP", quality=quality, method=6)
        else:
            return False
        return True


def phase_optimize_images(config: Config) -> None:
    """Verkleinert zu große Originalbilder im ``import_dir`` in-place (eine maximale
    Höhe). Läuft vor prepare/export, damit die weitere Pipeline und der Editor mit den
    bereits optimierten Bildern arbeiten. ``_archive`` wird übersprungen.

    Idempotent: Bilder bis ``max_height`` bleiben unangetastet, daher werden bei jedem
    Lauf praktisch nur neu hinzugekommene, zu große Bilder skaliert.
    """
    opt = config.optimize or OptimizeConfig()
    if not opt.enabled:
        return

    scaled = 0
    skipped = 0
    failed = 0
    for image in collect_image_files(config.import_dir):
        try:
            if optimize_image(image, opt.max_height, opt.quality):
                scaled += 1
            else:
                skipped += 1
        except Exception as e:  # noqa: BLE001 – defekte/unlesbare Datei soll die Phase nicht abbrechen
            failed += 1
            sys.stderr.write(f"WARNUNG: optimize-images – {image}: {e}\n")

    sys.stderr.write(
        f"optimize-images: {scaled} skaliert (max. Höhe {opt.max_height}px), "
        f"{skipped} bereits klein genug, {failed} fehlerhaft.\n"
    )


def phase_prepare(config: Config, schema: list[SchemaField]) -> None:
    skipped_renames = 0
    for json_file in collect_json_files(config.import_dir):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        if "name" not in data:
            sys.stderr.write(f"WARNUNG: {json_file} – kein 'name', übersprungen.\n")
            continue

        # 1. Auto-detect image (nur wenn Feld nicht vorhanden)
        if "image" not in data:
            sibling = find_image_sibling(json_file)
            if sibling:
                data["image"] = sibling

        # 2. EXIF -> tasting_date (nur wenn nicht vorhanden)
        if "tasting_date" not in data and data.get("image"):
            exif_date = read_exif_date(json_file.parent / data["image"])
            if exif_date:
                data["tasting_date"] = exif_date

        # 3. Umbenennung (braucht nur tasting_date; Datei bleibt im Unterordner)
        if data.get("tasting_date"):
            new_stem = f"{data['tasting_date']}-{slugify_name(data['name'])}"
            skipped_renames += rename_file_group(json_file, new_stem, data)
            json_file = json_file.parent / f"{new_stem}.json"
        else:
            sys.stderr.write(
                f"WARNUNG: {json_file} – kein 'tasting_date', Umbenennung übersprungen.\n"
            )

        # 4. Typ-Normalisierung für number-Felder (year, price, rating, …)
        normalize_number_fields(data, schema, json_file)

        # 5. scaffold_mode anwenden
        apply_scaffold_mode(data, config, schema)
        json_file.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    if skipped_renames:
        # Kollisionen (Zieldatei existiert bereits) werden nicht mehr pro Datei
        # geloggt, sondern am Ende der prepare-Phase zusammengefasst.
        sys.stderr.write(
            f"prepare: {skipped_renames} Umbenennung(en) übersprungen "
            f"(Zieldatei existierte bereits).\n"
        )


def rename_file_group(json_file: Path, new_stem: str, data: dict) -> int:
    """JSON + Bild + Audio + Video auf neuen Basisnamen umbenennen.

    Gibt die Anzahl übersprungener Umbenennungen zurück (Zieldatei existierte
    bereits). Diese Kollisionen werden NICHT pro Datei geloggt – die rufende
    prepare-Phase fasst sie am Ende zu einer Zeile zusammen, damit die Konsole
    ruhig bleibt.
    """
    skipped = 0
    for field_name in ("image", "audio", "video"):
        if not data.get(field_name):
            continue
        old_path = json_file.parent / data[field_name]
        if not old_path.exists():
            continue
        new_path = old_path.parent / f"{new_stem}{old_path.suffix}"
        if new_path.exists():
            skipped += 1
            continue
        old_path.rename(new_path)
        data[field_name] = new_path.name

    new_json = json_file.parent / f"{new_stem}.json"
    if new_json.exists() and new_json != json_file:
        return skipped + 1
    if new_json != json_file:
        json_file.rename(new_json)
    return skipped


def normalize_number_fields(data: dict, schema: list[SchemaField],
                            json_file: Path) -> None:
    """Felder mit WineSchema-Typ 'number' von String zu Zahl normalisieren.

    - Dezimal-Komma -> Dezimalpunkt ("6,99" -> "6.99")
    - decimals == 0 -> Integer (year: "2017" -> 2017)
    - decimals == 1 -> Float, 1 Nachkommastelle (rating: "6" -> 6.0)
    - decimals == 2 -> Float, 2 Nachkommastellen (price: "6,99" -> 6.99)
    Nicht umwandelbare Werte bleiben unverändert und erzeugen eine Warnung.
    """
    number_fields = {f.field: f for f in schema if f.type == "number"}
    for field_name, spec in number_fields.items():
        if field_name not in data:
            continue
        value = data[field_name]
        if value is None or isinstance(value, (int, float)):
            # bereits numerisch oder leer -> nur ggf. auf decimals runden
            if isinstance(value, (int, float)):
                data[field_name] = _round_to_decimals(value, spec.decimals)
            continue
        if not isinstance(value, str) or value.strip() == "":
            continue
        raw = value.strip().replace(",", ".")
        try:
            parsed = float(raw)
        except ValueError:
            sys.stderr.write(
                f"WARNUNG: {json_file} – Feld '{field_name}' Wert '{value}' ist keine "
                f"Zahl, unverändert belassen.\n"
            )
            continue
        data[field_name] = _round_to_decimals(parsed, spec.decimals)


def _round_to_decimals(value: float, decimals: int | None) -> int | float:
    """Auf die konfigurierte Nachkommastellen-Anzahl normalisieren."""
    if decimals is None:
        return value
    if decimals == 0:
        return int(round(value))
    return round(float(value), decimals)


def apply_scaffold_mode(data: dict, config: Config, schema: list[SchemaField]) -> None:
    scaffold_fields = get_scaffold_fields(schema)
    if config.scaffold_mode:
        for field_name in scaffold_fields:
            if field_name not in data:
                data[field_name] = None
        # bestehende Nicht-null-Werte bleiben unverändert
    else:
        keys_to_remove = [k for k, v in data.items() if v is None or v == ""]
        for k in keys_to_remove:
            del data[k]


# ---------------------------------------------------------------------------
# Phase export
# ---------------------------------------------------------------------------


def phase_export(config: Config) -> None:
    wines: list[dict] = []
    for json_file in collect_json_files(config.import_dir):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        if "name" not in data:
            sys.stderr.write(f"WARNUNG: {json_file} – kein 'name', übersprungen.\n")
            continue
        wines.append(data)

    with_date = sorted(
        [w for w in wines if w.get("tasting_date")],
        key=lambda w: w["tasting_date"],
        reverse=True,
    )
    without_date = [w for w in wines if not w.get("tasting_date")]

    output_path = Path(config.export_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(with_date + without_date, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Phase image-export
# ---------------------------------------------------------------------------


def phase_image_export(config: Config) -> None:
    from PIL import Image

    scaled = 0
    skipped = 0
    missing = 0
    for json_file in collect_json_files(config.import_dir):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        image_ref = data.get("image")
        if not image_ref:
            continue

        src = json_file.parent / image_ref
        if not src.exists():
            # Fehlende Quelldatei wird nicht pro Bild geloggt, sondern am Ende
            # der Phase zusammengefasst (ruhige Konsole).
            missing += 1
            continue

        dst = Path(config.image_export_dir) / image_ref
        dst.parent.mkdir(parents=True, exist_ok=True)

        # Timestamp-Vergleich: still überspringen wenn Kopie aktuell
        # (keine Zeile pro bereits vorhandenem Bild).
        if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue

        with Image.open(src) as img:
            px = config.image_resize_px
            if config.image_resize_mode == "width":
                img.thumbnail((px, 99999))
            else:  # "height"
                img.thumbnail((99999, px))
            img.save(dst, format=img.format)
        scaled += 1
        # Originale werden nicht verändert

    sys.stderr.write(
        f"image-export: {scaled} skaliert, {skipped} bereits vorhanden "
        f"übersprungen, {missing} Quellen fehlten.\n"
    )
