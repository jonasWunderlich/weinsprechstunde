import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { WineDataSource } from '@weinsprechstunde/shared';

import { routes } from './app.routes';
import { WineDataService } from './services/wine-data.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHttpClient(),
    // Der geteilte FilterService injiziert die WineDataSource-Abstraktion; in der
    // öffentlichen App liefert sie der HTTP-basierte WineDataService.
    { provide: WineDataSource, useExisting: WineDataService },
  ],
};
