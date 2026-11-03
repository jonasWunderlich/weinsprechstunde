import { EMPTY_FILTER, Wine, WineFilter } from '@weinsprechstunde/shared';
import { ImageEntry, WineEntry } from '../services/file-system-access.service';
import {
  buildEditorList,
  compareByDateDesc,
  hasAttributeFilter,
  timestampToIsoDate,
  toCreatedListItem,
  toUnknownListItem,
  wineSortDate,
} from './editor-list';
import { EditorListItem, UNKNOWN_WINE_PLACEHOLDER } from './editor-list.model';

function filter(patch: Partial<WineFilter> = {}): WineFilter {
  return {
    ...EMPTY_FILTER,
    dropdowns: { ...EMPTY_FILTER.dropdowns },
    multiSelects: { grape: [], origin: [] },
    ...patch,
  };
}

function wineEntry(
  path: string,
  wine: Wine | null,
  opts: { broken?: boolean; dirSegments?: string[] } = {},
): WineEntry {
  const parts = path.split('/');
  const name = parts.pop() as string;
  return {
    name,
    path,
    dirSegments: opts.dirSegments ?? parts,
    wine,
    broken: opts.broken ?? false,
    lastModified: 0,
  };
}

function imageEntry(path: string, date: number, assigned = false): ImageEntry {
  const parts = path.split('/');
  const name = parts.pop() as string;
  return {
    name,
    path,
    dirSegments: parts,
    date,
    dateSource: 'lastModified',
    assigned,
  };
}

describe('timestampToIsoDate', () => {
  it('wandelt einen Timestamp in ein ISO-Datum um', () => {
    expect(timestampToIsoDate(Date.parse('2021-06-15T10:00:00Z'))).toBe('2021-06-15');
  });

  it('liefert null für fehlende/ungültige Werte', () => {
    expect(timestampToIsoDate(null)).toBeNull();
    expect(timestampToIsoDate(undefined)).toBeNull();
    expect(timestampToIsoDate(NaN)).toBeNull();
  });
});

describe('wineSortDate', () => {
  it('liest ein vorhandenes tasting_date', () => {
    expect(wineSortDate({ name: 'A', tasting_date: '2020-01-01' })).toBe('2020-01-01');
  });
  it('liefert null bei fehlendem/leerem Datum', () => {
    expect(wineSortDate({ name: 'A' })).toBeNull();
    expect(wineSortDate({ name: 'A', tasting_date: '  ' })).toBeNull();
    expect(wineSortDate(null)).toBeNull();
  });
});

describe('toCreatedListItem', () => {
  it('markiert fehlendes name als unvollständig', () => {
    const item = toCreatedListItem(wineEntry('a.json', { name: '' } as Wine));
    expect(item.incomplete).toBe(true);
    expect(item.broken).toBe(false);
  });

  it('markiert defekte JSON als broken, nicht als incomplete', () => {
    const item = toCreatedListItem(wineEntry('a.json', null, { broken: true }));
    expect(item.broken).toBe(true);
    expect(item.incomplete).toBe(false);
  });

  it('vollständiger Eintrag ist weder broken noch incomplete', () => {
    const item = toCreatedListItem(wineEntry('a.json', { name: 'Rioja' }));
    expect(item.broken).toBe(false);
    expect(item.incomplete).toBe(false);
  });
});

describe('toUnknownListItem', () => {
  it('setzt Platzhalter und aus dem Bild ermitteltes Datum', () => {
    const item = toUnknownListItem(imageEntry('x.jpg', Date.parse('2019-03-03T00:00:00Z')));
    expect(item.placeholder).toBe(UNKNOWN_WINE_PLACEHOLDER);
    expect(item.sortDate).toBe('2019-03-03');
  });
});

describe('compareByDateDesc', () => {
  const dated = (id: string, d: string | null): EditorListItem =>
    ({ kind: 'unknown', id, image: imageEntry(id, 0), placeholder: 'x', sortDate: d }) as EditorListItem;

  it('sortiert absteigend nach Datum', () => {
    const items = [dated('a', '2020-01-01'), dated('b', '2022-01-01'), dated('c', '2021-01-01')];
    const sorted = items.slice().sort(compareByDateDesc);
    expect(sorted.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('stellt undatierte Einträge ans Ende', () => {
    const items = [dated('a', null), dated('b', '2022-01-01'), dated('c', null)];
    const sorted = items.slice().sort(compareByDateDesc);
    expect(sorted.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('hasAttributeFilter', () => {
  it('false bei leerem Filter', () => {
    expect(hasAttributeFilter(filter())).toBe(false);
  });
  it('true bei Freitextsuche', () => {
    expect(hasAttributeFilter(filter({ searchText: 'rot' }))).toBe(true);
  });
  it('true bei gesetztem Dropdown', () => {
    expect(hasAttributeFilter(filter({ dropdowns: { country: 'DE' } }))).toBe(true);
  });
  it('true bei Multiselect', () => {
    expect(hasAttributeFilter(filter({ multiSelects: { grape: ['Merlot'], origin: [] } }))).toBe(
      true,
    );
  });
  it('true bei Range-Grenze', () => {
    expect(hasAttributeFilter(filter({ ratingFrom: 5 }))).toBe(true);
  });
});

describe('buildEditorList', () => {
  const w1: Wine = { name: 'Alpha', tasting_date: '2021-05-05' };
  const w2: Wine = { name: 'Beta', tasting_date: '2023-05-05' };
  const w3: Wine = { name: 'Gamma' }; // undatiert
  const e1 = wineEntry('a.json', w1);
  const e2 = wineEntry('b.json', w2);
  const e3 = wineEntry('c.json', w3);
  const img1 = imageEntry('img-2022.jpg', Date.parse('2022-06-06T00:00:00Z'), false);
  const img2 = imageEntry('img-assigned.jpg', Date.parse('2020-06-06T00:00:00Z'), true);
  const imgUndated = imageEntry('img-x.jpg', NaN, false);

  it('mischt angelegte und unbekannte Weine absteigend nach Datum (Standard)', () => {
    // filteredWines kommt bereits tasting_date_desc sortiert vom FilterService.
    const filtered = [w2, w1, w3];
    const list = buildEditorList(filtered, [e1, e2, e3], [img1, img2, imgUndated], 'all', true);
    // Erwartung: 2023 (Beta), 2022 (unbekannt), 2021 (Alpha), dann undatierte.
    expect(list.map((i) => (i.kind === 'created' ? i.wine?.name : i.placeholder))).toEqual([
      'Beta',
      UNKNOWN_WINE_PLACEHOLDER,
      'Alpha',
      'Gamma',
      UNKNOWN_WINE_PLACEHOLDER,
    ]);
  });

  it('schließt zugeordnete Bilder (assigned) als unbekannte Weine aus', () => {
    const list = buildEditorList([w1], [e1], [img1, img2], 'all', true);
    const unknownIds = list.filter((i) => i.kind === 'unknown').map((i) => i.id);
    expect(unknownIds).toEqual(['img-2022.jpg']);
  });

  it('entryType=created blendet unbekannte Weine aus', () => {
    const list = buildEditorList([w2, w1], [e1, e2], [img1], 'created', true);
    expect(list.every((i) => i.kind === 'created')).toBe(true);
    expect(list).toHaveLength(2);
  });

  it('entryType=unknown blendet angelegte Weine aus', () => {
    const list = buildEditorList([w2, w1], [e1, e2], [img1], 'unknown', true);
    expect(list.every((i) => i.kind === 'unknown')).toBe(true);
    expect(list).toHaveLength(1);
  });

  it('nicht-Standard-Sortierung: angelegte in FilterService-Reihenfolge, dann unbekannte', () => {
    // mixByDate=false; filteredWines in bestimmter Reihenfolge (z.B. rating_desc).
    const filtered = [w1, w2]; // bewusst nicht datumssortiert
    const list = buildEditorList(filtered, [e1, e2], [img1], 'all', false);
    expect(list.map((i) => (i.kind === 'created' ? i.wine?.name : i.placeholder))).toEqual([
      'Alpha',
      'Beta',
      UNKNOWN_WINE_PLACEHOLDER,
    ]);
  });
});
