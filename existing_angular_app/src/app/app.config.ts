import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideApi } from './api';
import { environment } from '../environments/environment.dev';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter([], withComponentInputBinding()),
    provideClientHydration(),
    provideApi({
      basePath: environment.apiBasePath,
    }),
  ],
};
