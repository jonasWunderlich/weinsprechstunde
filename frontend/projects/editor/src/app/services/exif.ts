/**
 * Best-effort-EXIF-Reader, der ausschließlich das Aufnahmedatum (`DateTimeOriginal`,
 * Tag 0x9003) aus einer JPEG-Datei liest. Reine, synchrone Funktion ohne Browser-APIs,
 * damit sie in jsdom-Tests ohne weitere Abstraktion prüfbar ist.
 *
 * Bewusst minimal gehalten (kein voller EXIF-Parser): Es werden nur JPEG-APP1/TIFF
 * ausgewertet; bei PNG/WebP oder fehlendem Tag liefert die Funktion `null`, und der
 * Aufrufer fällt auf `File.lastModified` zurück (Req 17.28/17.29, Design „Bild-Listing
 * mit Datum").
 */

/**
 * Liest `DateTimeOriginal` aus EXIF-Daten eines Bildes.
 *
 * @returns ISO-8601-Datumsstring (`YYYY-MM-DD`) oder `null`, wenn kein Aufnahmedatum
 *          ermittelbar ist (kein JPEG, kein EXIF, Tag fehlt, Parse-Fehler).
 */
export function readExifDateTimeOriginal(buffer: ArrayBuffer): string | null {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4) return null;
    // JPEG-SOI
    if (view.getUint16(0) !== 0xffd8) return null;

    let offset = 2;
    const length = view.byteLength;
    while (offset + 4 <= length) {
      const marker = view.getUint16(offset);
      // Alle App-/sonstigen Marker liegen im Bereich 0xffe0..0xfffe.
      if ((marker & 0xff00) !== 0xff00) break;
      const size = view.getUint16(offset + 2);
      if (size < 2) break;
      // APP1 (0xffe1) enthält EXIF.
      if (marker === 0xffe1) {
        const exif = parseExifApp1(view, offset + 4, size - 2);
        if (exif) return exif;
      }
      offset += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}

function parseExifApp1(view: DataView, start: number, segLength: number): string | null {
  const end = start + segLength;
  if (start + 6 > view.byteLength) return null;
  // "Exif\0\0"
  if (
    view.getUint8(start) !== 0x45 ||
    view.getUint8(start + 1) !== 0x78 ||
    view.getUint8(start + 2) !== 0x69 ||
    view.getUint8(start + 3) !== 0x66
  ) {
    return null;
  }
  const tiffStart = start + 6;
  if (tiffStart + 8 > view.byteLength) return null;

  // Byte-Order des TIFF-Headers.
  const byteOrder = view.getUint16(tiffStart);
  let little: boolean;
  if (byteOrder === 0x4949)
    little = true; // "II"
  else if (byteOrder === 0x4d4d)
    little = false; // "MM"
  else return null;

  const get16 = (o: number) => view.getUint16(o, little);
  const get32 = (o: number) => view.getUint32(o, little);

  const ifd0Offset = get32(tiffStart + 4);
  const ifd0 = tiffStart + ifd0Offset;
  if (ifd0 + 2 > view.byteLength) return null;

  // Im IFD0 das EXIF-Sub-IFD (Tag 0x8769) suchen.
  const exifIfdPointer = findTagValueOffset(view, ifd0, tiffStart, 0x8769, get16, get32, end);
  if (exifIfdPointer === null) return null;

  const exifIfd = tiffStart + exifIfdPointer;
  if (exifIfd + 2 > view.byteLength) return null;

  // DateTimeOriginal (0x9003) als ASCII "YYYY:MM:DD HH:MM:SS".
  const dateStr = readAsciiTag(view, exifIfd, tiffStart, 0x9003, get16, get32, little, end);
  if (!dateStr) return null;

  const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(dateStr.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function iterateIfdEntries(
  view: DataView,
  ifdStart: number,
  get16: (o: number) => number,
  limit: number,
): { tag: number; type: number; count: number; valueOffset: number }[] {
  const entries: { tag: number; type: number; count: number; valueOffset: number }[] = [];
  const num = get16(ifdStart);
  for (let i = 0; i < num; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength || entryOffset + 12 > limit + 12) break;
    const tag = get16(entryOffset);
    const type = get16(entryOffset + 2);
    entries.push({ tag, type, count: 0, valueOffset: entryOffset + 8 });
  }
  return entries;
}

function findTagValueOffset(
  view: DataView,
  ifdStart: number,
  _tiffStart: number,
  tag: number,
  get16: (o: number) => number,
  get32: (o: number) => number,
  limit: number,
): number | null {
  for (const e of iterateIfdEntries(view, ifdStart, get16, limit)) {
    if (e.tag === tag) return get32(e.valueOffset);
  }
  return null;
}

function readAsciiTag(
  view: DataView,
  ifdStart: number,
  tiffStart: number,
  tag: number,
  get16: (o: number) => number,
  get32: (o: number) => number,
  _little: boolean,
  limit: number,
): string | null {
  const num = get16(ifdStart);
  for (let i = 0; i < num; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const entryTag = get16(entryOffset);
    if (entryTag !== tag) continue;
    const count = get32(entryOffset + 4);
    // ASCII-Werte > 4 Bytes liegen über einen Offset; sonst inline.
    let valueOffset: number;
    if (count <= 4) {
      valueOffset = entryOffset + 8;
    } else {
      valueOffset = tiffStart + get32(entryOffset + 8);
    }
    if (valueOffset + count > view.byteLength || valueOffset + count > limit + count) return null;
    let s = '';
    for (let k = 0; k < count; k++) {
      const c = view.getUint8(valueOffset + k);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  return null;
}
