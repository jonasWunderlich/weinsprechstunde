import { Injectable, signal } from '@angular/core';
import { Wine, WineDataSource, WineSchemaField } from '@weinsprechstunde/shared';
import { DEFAULT_WINE_SCHEMA } from '../models/default-schema';

/**
 * Schlanke {@link WineDataSource}-Implementierung des Editors: Sie hält nur die vom
 * geteilten {@link FilterService} benötigten Signale `wines` (angelegte Weine) und
 * `schema` (Req 17.11).
 *
 * Bewusst getrennt vom `EditorStateService`, um die zyklische Abhängigkeit
 * `EditorStateService → FilterService → WineDataSource` zu vermeiden: Der
 * FilterService hängt nur an dieser Quelle, der `EditorStateService` befüllt sie.
 */
@Injectable({ providedIn: 'root' })
export class EditorWineDataService implements WineDataSource {
  readonly wines = signal<Wine[]>([]);
  readonly schema = signal<WineSchemaField[]>(DEFAULT_WINE_SCHEMA);
}
