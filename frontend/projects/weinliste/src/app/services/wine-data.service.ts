import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import { LoadState, Wine, WineDataSource, WineSchemaField } from '@weinsprechstunde/shared';

/**
 * Lädt wines.json + wine-schema.json einmalig parallel. Keine Filterlogik,
 * keine Routen-Kenntnis. Kein Reload bei Routenwechsel (Guard).
 *
 * Implementiert die geteilte {@link WineDataSource}-Abstraktion; der geteilte
 * FilterService konsumiert daraus nur `wines` und `schema`. Das HTTP-Laden aus
 * `data/` ist öffentlich-spezifisch und bleibt daher in der weinliste-App.
 */
@Injectable({ providedIn: 'root' })
export class WineDataService implements WineDataSource {
  private readonly http = inject(HttpClient);

  readonly wines = signal<Wine[]>([]);
  readonly schema = signal<WineSchemaField[]>([]);
  readonly loadState = signal<LoadState>('idle');

  loadAll(): void {
    if (this.loadState() !== 'idle') return; // kein Reload bei Routenwechsel
    this.loadState.set('loading');
    forkJoin({
      wines: this.http.get<Wine[]>('data/wines.json'),
      schema: this.http.get<WineSchemaField[]>('data/wine-schema.json'),
    })
      .pipe(
        catchError((err) => {
          console.error('Fehler beim Laden der Weindaten', err);
          this.loadState.set('error');
          return EMPTY;
        }),
      )
      .subscribe(({ wines, schema }) => {
        this.wines.set(wines);
        this.schema.set(schema);
        this.loadState.set('loaded');
      });
  }
}
