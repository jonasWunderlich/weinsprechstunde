import { Injectable } from '@angular/core';
import { UserPreferences } from '../models/user-preferences.model';

const COOKIE_NAME = 'ws_prefs';
const DEFAULT_PREFS: UserPreferences = {
  visibleFilters: [],
  sortOption: 'tasting_date_desc',
  viewMode: 'grid',
};

/**
 * Liest/schreibt Cookie ws_prefs (ohne festes Ablaufdatum / gleitendes Max-Age 1 Jahr).
 * Speichert NUR Konfiguration, nie Filterwerte (Req 18.3).
 */
@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  load(): UserPreferences {
    try {
      const raw = this._getCookieValue(COOKIE_NAME);
      if (!raw) return { ...DEFAULT_PREFS };
      return { ...DEFAULT_PREFS, ...JSON.parse(decodeURIComponent(raw)) };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  save(prefs: UserPreferences): void {
    const value = encodeURIComponent(JSON.stringify(prefs));
    document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=31536000; SameSite=Strict`;
  }

  private _getCookieValue(name: string): string | null {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? match[1] : null;
  }
}
