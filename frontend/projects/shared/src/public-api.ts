/*
 * Öffentliche API der Library `@weinsprechstunde/shared`.
 *
 * Enthält die von der öffentlichen Weinliste und dem Editor gemeinsam genutzte,
 * UI-unabhängige Logik: Domänen-/Schema-Modelle, die reine Filter-/Such-/Sortier-
 * funktion `applyFiltersAndSort`, den zentralen `FilterService`, die
 * `WineDataSource`-Abstraktion sowie den `UserPreferencesService`.
 */

// Modelle & Typen
export * from './lib/models/wine.model';
export * from './lib/models/wine-schema.model';
export * from './lib/models/user-preferences.model';

// WineSchema-/Filter-Hilfsfunktionen (inkl. Präsentations-Helfern wie isPresent)
export * from './lib/models/wine-util';

// Datenquellen-Abstraktion, auf die der FilterService zugreift
export * from './lib/services/wine-data-source';

// Zustands-/Filterdienste
export * from './lib/services/filter.service';
export * from './lib/services/user-preferences.service';
