import { readExifDateTimeOriginal } from './exif';

/**
 * Baut einen minimalen JPEG-Puffer mit einem EXIF-APP1-Segment, das ein
 * `DateTimeOriginal` (0x9003) enthält. Big-Endian ("MM") TIFF-Header,
 * IFD0 mit einem Zeiger auf das EXIF-Sub-IFD, das wiederum den Datums-Tag trägt.
 */
function buildJpegWithDateTimeOriginal(dateStr: string): ArrayBuffer {
  // dateStr im Format "YYYY:MM:DD HH:MM:SS" (20 Bytes inkl. NUL).
  const ascii = dateStr.padEnd(19, ' ') + '\0'; // 20 Bytes
  const asciiBytes = new TextEncoder().encode(ascii);

  // TIFF-Bereich aufbauen (relativ zum TIFF-Start = Byte 0 dieses Teilpuffers).
  // Layout:
  //  0: byte order "MM"
  //  2: 0x002A
  //  4: offset IFD0 (= 8)
  //  8: IFD0 (num=1)
  //    entry: tag=0x8769 (ExifIFDPointer), type=4 (LONG), count=1, value=offset ExifIFD
  //  ...: ExifIFD (num=1)
  //    entry: tag=0x9003 (DateTimeOriginal), type=2 (ASCII), count=20, value=offset ascii
  //  ...: ascii bytes
  const header = 8;
  const ifd0 = header; // 8
  const ifd0Size = 2 + 12 + 4; // num + 1 entry + next-ifd offset
  const exifIfd = ifd0 + ifd0Size;
  const exifIfdSize = 2 + 12 + 4;
  const asciiOffset = exifIfd + exifIfdSize;
  const tiffLen = asciiOffset + asciiBytes.length;

  const tiff = new DataView(new ArrayBuffer(tiffLen));
  tiff.setUint16(0, 0x4d4d); // MM
  tiff.setUint16(2, 0x002a);
  tiff.setUint32(4, ifd0);

  // IFD0
  tiff.setUint16(ifd0, 1);
  tiff.setUint16(ifd0 + 2, 0x8769); // Exif IFD pointer
  tiff.setUint16(ifd0 + 4, 4); // LONG
  tiff.setUint32(ifd0 + 6, 1); // count
  tiff.setUint32(ifd0 + 10, exifIfd); // value = offset
  tiff.setUint32(ifd0 + 14, 0); // next IFD = none

  // Exif IFD
  tiff.setUint16(exifIfd, 1);
  tiff.setUint16(exifIfd + 2, 0x9003); // DateTimeOriginal
  tiff.setUint16(exifIfd + 4, 2); // ASCII
  tiff.setUint32(exifIfd + 6, asciiBytes.length); // count
  tiff.setUint32(exifIfd + 10, asciiOffset); // value = offset
  tiff.setUint32(exifIfd + 14, 0); // next IFD = none

  // ASCII-Bytes
  new Uint8Array(tiff.buffer).set(asciiBytes, asciiOffset);

  // JPEG umschließen: SOI + APP1 (Länge + "Exif\0\0" + TIFF).
  const exifHeader = new TextEncoder().encode('Exif\0\0'); // 6 Bytes
  const app1DataLen = exifHeader.length + tiffLen;
  const app1SegLen = app1DataLen + 2; // inkl. der 2 Längen-Bytes

  const total = 2 /*SOI*/ + 2 /*APP1 marker*/ + 2 /*length*/ + app1DataLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0xffd8); // SOI
  dv.setUint16(2, 0xffe1); // APP1
  dv.setUint16(4, app1SegLen);
  out.set(exifHeader, 6);
  out.set(new Uint8Array(tiff.buffer), 6 + exifHeader.length);
  return out.buffer;
}

describe('readExifDateTimeOriginal', () => {
  it('liest DateTimeOriginal und liefert ISO-Datum', () => {
    const buf = buildJpegWithDateTimeOriginal('2021:07:15 12:30:00');
    expect(readExifDateTimeOriginal(buf)).toBe('2021-07-15');
  });

  it('liefert null für Nicht-JPEG-Daten', () => {
    const buf = new TextEncoder().encode('not a jpeg').buffer;
    expect(readExifDateTimeOriginal(buf)).toBeNull();
  });

  it('liefert null, wenn JPEG kein EXIF-Datum enthält', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer; // SOI + EOI
    expect(readExifDateTimeOriginal(buf)).toBeNull();
  });
});
