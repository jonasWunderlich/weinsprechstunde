import { Wine } from '@weinsprechstunde/shared';

/**
 * Reiner, feldweiser Drei-Wege-Merge für den Auto-Save (Req 17.25). Weicht beim Speichern
 * der Zeitstempel der Datei vom erwarteten ab, werden Basis (zuletzt bekannter
 * Plattenstand), lokaler Stand und aktueller Plattenstand je Feld verglichen. Alle drei
 * Stände liegen in gespeicherten Typen vor (year Integer, price 2, rating 1, Arrays),
 * Vergleich per Deep-Equal. Ein fehlender Schlüssel gilt als „leer" und unterscheidet sich
 * von `null`.
 */

/** Ein Feld, das lokal und auf der Platte unterschiedlich geändert wurde. */
export interface FieldConflict {
  field: string;
  /** Lokaler Wert; `undefined` = Feld lokal entfernt. */
  local: unknown;
  /** Wert auf der Platte; `undefined` = Feld dort entfernt. */
  disk: unknown;
}

/** Wahl je Konfliktfeld. */
export type ConflictChoice = 'local' | 'disk';

export interface MergeResult {
  /** Zusammengeführter Stand; Konfliktfelder tragen vorläufig den Plattenwert. */
  merged: Wine;
  /** Felder, deren Wert von der Platte übernommen wurde (nur dort geändert). */
  fromDisk: string[];
  /** Felder mit abweichenden Änderungen auf beiden Seiten. */
  conflicts: FieldConflict[];
}

/** Strukturelle Gleichheit von JSON-Werten; Objekt-Schlüsselreihenfolge ist unerheblich. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (keys.length !== bKeys.length) return false;
  return keys.every((k) => deepEqual(ao[k], bo[k]));
}

function setOrDelete(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

/**
 * Führt `local` und `disk` gegenüber der gemeinsamen Basis `base` je Feld zusammen
 * (inkl. schema-fremder Felder):
 * - nur lokal geändert → lokaler Wert,
 * - nur auf der Platte geändert → Plattenwert (steht in `fromDisk`),
 * - beide gleich geändert → kein Konflikt,
 * - beide unterschiedlich geändert → Eintrag in `conflicts`.
 */
export function mergeThreeWay(base: Wine, local: Wine, disk: Wine): MergeResult {
  const b = base as Record<string, unknown>;
  const l = local as Record<string, unknown>;
  const d = disk as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...d };
  const fromDisk: string[] = [];
  const conflicts: FieldConflict[] = [];

  const keys = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(d)]);
  for (const key of keys) {
    const localChanged = !deepEqual(b[key], l[key]);
    const diskChanged = !deepEqual(b[key], d[key]);
    if (localChanged && !diskChanged) {
      setOrDelete(merged, key, l[key]);
    } else if (!localChanged && diskChanged) {
      fromDisk.push(key);
    } else if (localChanged && diskChanged && !deepEqual(l[key], d[key])) {
      conflicts.push({ field: key, local: l[key], disk: d[key] });
    }
  }
  return { merged: merged as Wine, fromDisk, conflicts };
}

/** Wendet die Wahl je Konfliktfeld auf den zusammengeführten Stand an. */
export function applyConflictChoices(
  result: MergeResult,
  choices: Record<string, ConflictChoice>,
): Wine {
  const out: Record<string, unknown> = { ...(result.merged as Record<string, unknown>) };
  for (const c of result.conflicts) {
    if (choices[c.field] === 'local') setOrDelete(out, c.field, c.local);
  }
  return out as Wine;
}
