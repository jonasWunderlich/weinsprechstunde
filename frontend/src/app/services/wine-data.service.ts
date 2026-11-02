import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import { LoadState, Wine } from '../models/wine.model';
import { WineSchemaField } from '../models/wine-schema.model';

/**
 * Lädt wines.json + wine-schema.json einmalig parallel. Keine Filterlogik,
 * keine Routen-Kenntnis. Kein Reload bei Routenwechsel (Guard).
 */
@Injectable({ providedIn: 'root' })
export class WineDataService {
  private readonly http = inject(HttpClient);

  readonly wines = signal<Wine[]>([]);
  readonly schema = signal<WineSchemaField[]>([]);
  readonly loadState = signal<LoadState>('idle');

  loadAll(): void {
    if (this.loadState() !== 'idle') return; // kein Reload bei Routenwechsel
    this.loadState.set('loading');
    forkJoin({
      wines: this.http.get<Wine[]>('assets/wines.json'),
      schema: this.http.get<WineSchemaField[]>('assets/wine-schema.json'),
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
