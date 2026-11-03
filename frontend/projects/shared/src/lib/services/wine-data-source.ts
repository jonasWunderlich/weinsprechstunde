import { Signal } from '@angular/core';
import { Wine } from '../models/wine.model';
import { WineSchemaField } from '../models/wine-schema.model';

/**
 * Abstraktion über die Weindaten-Quelle, von der der geteilte {@link FilterService}
 * nur die reaktiven Signale `wines` und `schema` benötigt.
 *
 * Die konkrete Beschaffung der Daten ist app-spezifisch und bleibt bewusst außerhalb
 * der geteilten Library:
 * - die öffentliche Weinliste lädt `data/wines.json` + `data/wine-schema.json` per HTTP
 *   (`WineDataService` in `projects/weinliste`),
 * - der Editor liest sie über die File System Access API aus dem freigegebenen Ordner.
 *
 * Als abstrakte Klasse dient sie zugleich als DI-Token; jede App bindet ihre konkrete
 * Implementierung über `{ provide: WineDataSource, useExisting: … }`.
 */
export abstract class WineDataSource {
  abstract readonly wines: Signal<Wine[]>;
  abstract readonly schema: Signal<WineSchemaField[]>;
}
