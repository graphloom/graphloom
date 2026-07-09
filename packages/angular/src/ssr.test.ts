// @vitest-environment node
//
// P5-T03: runs WITHOUT any DOM. Importing the package here is itself the
// proof that nothing in the dependency chain touches window/document at
// module scope (ADR-0002 SSR rule); rendering proves the server placeholder.
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { describe, expect, it } from 'vitest';
import { GraphComponent } from './index.js';

@Component({
  selector: 'app-root',
  imports: [GraphComponent],
  template: '<graphloom-graph />',
})
class AppComponent {}

describe('SSR compliance (P5-T03)', () => {
  it('imports and server-renders a placeholder — no canvas on the server', async () => {
    const html = await renderApplication(
      (context) =>
        bootstrapApplication(
          AppComponent,
          { providers: [provideZonelessChangeDetection(), provideServerRendering()] },
          context,
        ),
      { document: '<html><head></head><body><app-root></app-root></body></html>', url: '/' },
    );
    expect(html).toContain('graphloom-placeholder'); // server placeholder
    expect(html).toContain('graphloom-canvas'); // stable host for hydration
    expect(html).not.toContain('<svg'); // the renderer never ran on the server
  });
});
