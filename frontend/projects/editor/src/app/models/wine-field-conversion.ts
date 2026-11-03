import { Wine, WineSchemaField } from '@weinsprechstunde/shared';

/**
 * Reine, DOM-freie Konvertierungs- und Merge-Hilfen für den WineEditor-Auto-Save
 * (Req 17.22/17.27). Bewusst als Pure-Functions ausgelagert, damit die zugehörigen
 * Property-Tests (28.3 Typkonvertierung, 28.4 schema-fremde Felder) direkt gegen diese
 * Logik laufen können, ohne das Formular oder die File System Access API einzubinden.
 */

/** Ergebnis einer Typkonvertierung eines einzelnen Feldwerts. */
export type FieldConversionResult = { ok: true; value: unknown } | { ok: false; raw: string };

/**
 * Normalisiert eine Zahleneingabe eines `number`-Feldes gemäß WineSchema (Req 17.22),
 * konsistent zur Normalisierung im ImportScript (Req 2.16/2.17):
 *
 * - Dezimal-Komma wird als Dezimaltrennzeichen akzeptiert (`"6,99"` → `6.99`).
 * - `decimals: 0` ergibt einen Integer (`year` `"2017"` → `2017`).
 * - `decimals: 1` ergibt einen Float mit einer Nachkommastelle (`rating` `"6"` → `6`,
 *   intern `6.0`).
 * - `decimals: 2` ergibt einen Float mit zwei Nachkommastellen (`price` `"6,99"` → `6.99`).
 *
 * Ein leerer Wert (leerer/weißraum-only String) ergibt `null` (Feld geleert). Lässt sich
 * der Wert nicht in eine Zahl umwandeln, wird `ok: false` zurückgegeben; der Aufrufer
 * behält dann den unveränderten Rohwert (analog zur ImportScript-Warnung, Req 2.18).
 */
export function convertNumberField(
  raw: string,
  decimals: number | undefined,
): FieldConversionResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };

  // Dezimal-Komma → Dezimalpunkt. Tausenderpunkte werden nicht unterstützt (konsistent
  // zum ImportScript, das ebenfalls nur ein einfaches Komma-Replace vornimmt).
  const normalized = trimmed.replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num)) return { ok: false, raw };

  if (decimals === undefined) return { ok: true, value: num };
  if (decimals <= 0) return { ok: true, value: Math.trunc(num) };

  // Auf `decimals` Nachkommastellen runden und als Number zurückgeben. `Number(x.toFixed(d))`
  // entfernt überflüssige Nullen wieder (JSON kennt keine „festen" Nachkommastellen);
  // die Präzision entspricht der im ImportScript (`round(value, decimals)`).
  const factor = Math.pow(10, decimals);
  return { ok: true, value: Math.round(num * factor) / factor };
}

/**
 * Teilt die rohe Grape-Eingabe (durch Komma getrennte Tags) in ein bereinigtes
 * String-Array auf (Req 17.18): getrimmt, ohne Leer-Tags, ohne Duplikate (erste
 * Vorkommen-Reihenfolge erhalten).
 */
export function parseGrapeTags(raw: string | string[]): string[] {
  const parts = Array.isArray(raw) ? raw : raw.split(',');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const tag = String(part).trim();
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * Baut das zu speichernde Wine-Objekt für den Auto-Save: Es übernimmt zunächst alle
 * Felder des zuletzt geladenen Originals (inkl. **schema-fremder** Felder, Req 17.27)
 * und überschreibt anschließend die bekannten Schema-Felder mit den aktuellen
 * Formularwerten.
 *
 * Dadurch bleiben unbekannte Zusatzfelder (`[key: string]: unknown`) unverändert
 * erhalten — sie werden weder entfernt noch verändert.
 *
 * @param original   das zuletzt aus der Datei geladene Wine-Objekt (Quelle schema-fremder
 *                   Felder). Bei einem frisch angelegten Eintrag ein Objekt, das nur die
 *                   bisher bekannten Felder enthält.
 * @param schema     die bekannten WineSchema-Felder.
 * @param fieldValues die aktuellen (bereits typkonvertierten) Werte der Schema-Felder.
 *                   Ein Wert `undefined` lässt das Feld unverändert (z. B. wenn ein Feld
 *                   nicht typkonvertierbar war und der Rohwert erhalten bleiben soll).
 */
export function mergeWineForSave(
  original: Wine,
  schema: WineSchemaField[],
  fieldValues: Record<string, unknown>,
): Wine {
  // 1. Schema-fremde Felder + bisherige Schema-Werte als Basis übernehmen.
  const merged: Wine = { ...original } as Wine;

  // 2. Bekannte Schema-Felder mit den aktuellen Formularwerten überschreiben.
  for (const field of schema) {
    if (!(field.field in fieldValues)) continue;
    const value = fieldValues[field.field];
    if (value === undefined) continue; // Feld unverändert lassen
    if (value === null) {
      // Geleertes Feld: entfernen, damit es nicht als `null` persistiert bleibt und die
      // „leere Felder ausblenden"-Semantik (isPresent) konsistent ist.
      delete (merged as Record<string, unknown>)[field.field];
    } else {
      (merged as Record<string, unknown>)[field.field] = value;
    }
  }

  return merged;
}

/**
 * Ermittelt die schema-fremden Feldnamen eines Weins (alle Keys, die in keinem
 * WineSchema-Feld vorkommen). Dient der Anzeige dieser Felder im WineEditor (Req 17.27).
 */
export function unknownFieldKeys(wine: Wine, schema: WineSchemaField[]): string[] {
  const known = new Set(schema.map((f) => f.field));
  return Object.keys(wine).filter((k) => !known.has(k));
}
