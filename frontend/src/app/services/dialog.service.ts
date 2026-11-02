import { Injectable, signal } from '@angular/core';
import { Wine } from '../models/wine.model';

/** Hält nur den UI-Transientzustand „offener Wein"; getrennt vom FilterService. */
@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly wine = signal<Wine | null>(null);
  open(w: Wine): void {
    this.wine.set(w);
  }
  close(): void {
    this.wine.set(null);
  }
}
