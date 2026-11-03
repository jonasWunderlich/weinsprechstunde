import { describe, expect, it } from 'vitest';
import { Wine } from '@weinsprechstunde/shared';
import { ImageEntry, WineEntry } from '../services/file-system-access.service';
import {
  buildProvisionalWine,
  imagelessEntries,
  isImageless,
  provisionalJsonName,
  provisionalJsonPath,
  stripExtension,
  withImage,
} from './from-image';
import { DEFAULT_WINE_SCHEMA } from './default-schema';

function imageEntry(path: string): ImageEntry {
  const parts = path.split('/');
  const name = parts.pop() as string;
  return { name, path, dirSegments: parts, date: 0, dateSource: 'lastModified', assigned: false };
}

function wineEntry(path: string, wine: Wine | null, broken = false): WineEntry {
  const parts = path.split('/');
  const name = parts.pop() as string;
  return { name, path, dirSegments: parts, wine, broken, lastModified: 0 };
}

describe('stripExtension', () => {
  it('entfernt die letzte Endung', () => {
    expect(stripExtension('2021-wein.jpg')).toBe('2021-wein');
    expect(stripExtension('foo.tar.gz')).toBe('foo.tar');
  });

  it('lässt Namen ohne Endung und Dotfiles unverändert', () => {
    expect(stripExtension('ohneendung')).toBe('ohneendung');
    expect(stripExtension('.gitignore')).toBe('.gitignore');
  });
});

describe('provisionalJsonName / provisionalJsonPath (Req 17.37)', () => {
  it('bildet den vorläufigen Dateinamen aus Basisname + .json', () => {
    expect(provisionalJsonName('IMG_1234.JPG')).toBe('IMG_1234.json');
  });

  it('legt die JSON im selben Unterordner wie das Bild an', () => {
    expect(provisionalJsonPath(imageEntry('sub/tief/IMG_1.jpg'))).toBe('sub/tief/IMG_1.json');
    expect(provisionalJsonPath(imageEntry('wurzel.png'))).toBe('wurzel.json');
  });
});

describe('buildProvisionalWine (Req 17.36)', () => {
  it('initialisiert alle Schema-Felder mit null außer image und tasting_date', () => {
    const wine = buildProvisionalWine(DEFAULT_WINE_SCHEMA, 'a.jpg', '2021-10-12');
    expect(wine.image).toBe('a.jpg');
    expect(wine.tasting_date).toBe('2021-10-12');
    for (const f of DEFAULT_WINE_SCHEMA) {
      if (f.field === 'image' || f.field === 'tasting_date') continue;
      expect(wine[f.field]).toBeNull();
    }
    // Keine schema-fremden Felder.
    const extra = Object.keys(wine).filter((k) => !DEFAULT_WINE_SCHEMA.some((f) => f.field === k));
    expect(extra).toEqual([]);
  });

  it('setzt tasting_date auf null, wenn kein EXIF-Datum vorhanden ist', () => {
    const wine = buildProvisionalWine(DEFAULT_WINE_SCHEMA, 'a.jpg', null);
    expect(wine.tasting_date).toBeNull();
    expect(wine.image).toBe('a.jpg');
  });
});

describe('isImageless (Req 17.38)', () => {
  it('erkennt bildlose Einträge (leer/null/fehlend)', () => {
    expect(isImageless({ name: 'A' })).toBe(true);
    expect(isImageless({ name: 'A', image: null } as unknown as Wine)).toBe(true);
    expect(isImageless({ name: 'A', image: '' })).toBe(true);
    expect(isImageless({ name: 'A', image: '   ' })).toBe(true);
  });

  it('erkennt Einträge mit gesetztem Bild', () => {
    expect(isImageless({ name: 'A', image: 'a.jpg' })).toBe(false);
  });

  it('liefert false für null', () => {
    expect(isImageless(null)).toBe(false);
  });
});

describe('imagelessEntries (Req 17.38)', () => {
  it('schlägt nur bildlose, nicht-defekte Einträge vor und schließt den vorläufigen aus', () => {
    const entries = [
      wineEntry('prov.json', { name: 'Prov', image: 'prov.jpg' }),
      wineEntry('a.json', { name: 'Alpha' }),
      wineEntry('b.json', { name: 'Beta', image: 'b.jpg' }),
      wineEntry('c.json', { name: 'Gamma', image: null } as unknown as Wine),
      wineEntry('broken.json', null, true),
    ];
    const result = imagelessEntries(entries, 'prov.json').map((e) => e.path);
    expect(result).toEqual(['a.json', 'c.json']);
  });
});

describe('withImage (Req 17.41)', () => {
  it('setzt das image-Feld ohne das Original zu verändern', () => {
    const original: Wine = { name: 'A' };
    const next = withImage(original, 'a.jpg');
    expect(next.image).toBe('a.jpg');
    expect(original.image).toBeUndefined();
  });
});
