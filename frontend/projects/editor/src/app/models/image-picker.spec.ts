import { describe, expect, it } from 'vitest';
import { selectPickerImages } from './image-picker';
import { ImageEntry } from '../services/file-system-access.service';
import { isImageName } from '../services/file-system-access.service';

function img(name: string, date: number, assigned: boolean): ImageEntry {
  return {
    name,
    path: name,
    dirSegments: [],
    date,
    dateSource: 'lastModified',
    assigned,
  };
}

const SAMPLE: ImageEntry[] = [
  img('alpha.jpg', 300, false),
  img('beta.png', 100, true),
  img('gamma.webp', 200, false),
  img('delta.jpeg', 400, true),
];

describe('selectPickerImages', () => {
  it('zeigt standardmäßig nur ungenutzte Bilder (assigned === false, Req 17.28)', () => {
    const result = selectPickerImages(SAMPLE, { showAll: false, nameFilter: '', sort: 'desc' });
    expect(result.every((i) => !i.assigned)).toBe(true);
    expect(result.map((i) => i.name).sort()).toEqual(['alpha.jpg', 'gamma.webp']);
  });

  it('zeigt beim Umschalten auf „alle" sämtliche Bilder (Req 17.29)', () => {
    const only = selectPickerImages(SAMPLE, { showAll: false, nameFilter: '', sort: 'desc' });
    const all = selectPickerImages(SAMPLE, { showAll: true, nameFilter: '', sort: 'desc' });
    expect(only.length).toBe(2);
    expect(all.length).toBe(4);
    expect(all.some((i) => i.assigned)).toBe(true);
  });

  it('sortiert nach Datum absteigend (Req 17.30)', () => {
    const result = selectPickerImages(SAMPLE, { showAll: true, nameFilter: '', sort: 'desc' });
    expect(result.map((i) => i.name)).toEqual(['delta.jpeg', 'alpha.jpg', 'gamma.webp', 'beta.png']);
  });

  it('sortiert nach Datum aufsteigend (Req 17.30)', () => {
    const result = selectPickerImages(SAMPLE, { showAll: true, nameFilter: '', sort: 'asc' });
    expect(result.map((i) => i.name)).toEqual(['beta.png', 'gamma.webp', 'alpha.jpg', 'delta.jpeg']);
  });

  it('filtert case-insensitiv nach Dateiname (Req 17.31)', () => {
    const result = selectPickerImages(SAMPLE, { showAll: true, nameFilter: 'ALP', sort: 'desc' });
    expect(result.map((i) => i.name)).toEqual(['alpha.jpg']);
  });

  it('kombiniert ungenutzt-Filter und Dateinamen-Filter', () => {
    // beta ist assigned → trotz Treffer beim Namensfilter nicht sichtbar im Default.
    const result = selectPickerImages(SAMPLE, { showAll: false, nameFilter: 'a', sort: 'desc' });
    expect(result.map((i) => i.name).sort()).toEqual(['alpha.jpg', 'gamma.webp']);
  });

  it('mutiert die Eingabeliste nicht', () => {
    const input = [...SAMPLE];
    const snapshot = input.map((i) => i.name);
    selectPickerImages(input, { showAll: true, nameFilter: '', sort: 'asc' });
    expect(input.map((i) => i.name)).toEqual(snapshot);
  });
});

describe('isImageName (case-insensitive Bildtyp-Erkennung, Req 17.32)', () => {
  it('erkennt .jpg/.jpeg/.png/.webp unabhängig von der Groß-/Kleinschreibung', () => {
    for (const name of [
      'a.jpg',
      'a.JPG',
      'a.Jpeg',
      'a.JPEG',
      'a.png',
      'a.PNG',
      'a.webp',
      'a.WEBP',
    ]) {
      expect(isImageName(name)).toBe(true);
    }
  });

  it('lehnt nicht unterstützte Endungen ab', () => {
    for (const name of ['a.gif', 'a.txt', 'a.mp4', 'noext', 'a.jpgx']) {
      expect(isImageName(name)).toBe(false);
    }
  });
});
