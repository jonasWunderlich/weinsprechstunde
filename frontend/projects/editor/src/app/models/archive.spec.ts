import { describe, expect, it } from 'vitest';
import { Wine } from '@weinsprechstunde/shared';
import { WineEntry } from '../services/file-system-access.service';
import { entryArchiveSourcePaths, referencedMediaNames } from './archive';

function wineEntry(path: string, wine: Wine | null): WineEntry {
  const parts = path.split('/');
  const name = parts.pop() as string;
  return { name, path, dirSegments: parts, wine, broken: false, lastModified: 0 };
}

describe('referencedMediaNames (Req 17.47)', () => {
  it('liefert image/audio/video, wenn vorhanden', () => {
    const wine: Wine = { name: 'A', image: 'a.jpg', audio: 'a.mp3', video: 'a.mp4' };
    expect(referencedMediaNames(wine)).toEqual(['a.jpg', 'a.mp3', 'a.mp4']);
  });

  it('überspringt leere/fehlende Felder', () => {
    const wine: Wine = { name: 'A', image: 'a.jpg', audio: '', video: null as never };
    expect(referencedMediaNames(wine)).toEqual(['a.jpg']);
  });

  it('liefert leeres Array für Eintrag ohne Medien', () => {
    expect(referencedMediaNames({ name: 'A' })).toEqual([]);
  });

  it('entfernt Dubletten (gleiche Datei in mehreren Feldern)', () => {
    const wine: Wine = { name: 'A', image: 'x.jpg', video: 'x.jpg' };
    expect(referencedMediaNames(wine)).toEqual(['x.jpg']);
  });

  it('liefert leeres Array für null-Wine (defektes JSON)', () => {
    expect(referencedMediaNames(null)).toEqual([]);
  });
});

describe('entryArchiveSourcePaths (Req 17.47)', () => {
  it('listet Medien zuerst, JSON zuletzt — im selben Unterordner', () => {
    const entry = wineEntry('sub/2021-wein.json', {
      name: 'Wein',
      image: 'img.jpg',
      audio: 'ton.mp3',
    });
    expect(entryArchiveSourcePaths(entry)).toEqual([
      'sub/img.jpg',
      'sub/ton.mp3',
      'sub/2021-wein.json',
    ]);
  });

  it('nur JSON, wenn keine Medien referenziert sind', () => {
    const entry = wineEntry('a.json', { name: 'A' });
    expect(entryArchiveSourcePaths(entry)).toEqual(['a.json']);
  });

  it('löst Mediennamen relativ zum JSON-Verzeichnis auf (Wurzel)', () => {
    const entry = wineEntry('a.json', { name: 'A', video: 'clip.mp4' });
    expect(entryArchiveSourcePaths(entry)).toEqual(['clip.mp4', 'a.json']);
  });
});
