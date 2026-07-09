import { mergeApplicationConfig } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { AppComponent } from './app.component.js';
import { appConfig } from './app.config.js';

const serverConfig = mergeApplicationConfig(appConfig, {
  providers: [provideServerRendering()],
});

/** Renders the app into the given HTML document (used by prerender.mjs). */
export default function render(document: string, url: string): Promise<string> {
  return renderApplication(
    (context) => bootstrapApplication(AppComponent, serverConfig, context),
    { document, url },
  );
}
