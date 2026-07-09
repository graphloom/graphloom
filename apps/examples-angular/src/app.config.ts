import { provideZonelessChangeDetection, type ApplicationConfig } from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';

/** Shared client/server config: zoneless + hydration (P5-T03). */
export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection(), provideClientHydration()],
};
