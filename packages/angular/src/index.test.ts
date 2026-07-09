import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { GraphComponent, PACKAGE_NAME } from './index.js';

describe('@graphloom/angular', () => {
  it('exports the package name', () => {
    expect(PACKAGE_NAME).toBe('@graphloom/angular');
  });

  it('creates the editor against its host element on first render', () => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    const fixture = TestBed.createComponent(GraphComponent);
    fixture.detectChanges(); // flushes afterNextRender → editor exists
    expect(fixture.nativeElement.querySelector('.graphloom-canvas')).toBeTruthy();
    expect(fixture.componentInstance.ready()).toBe(true);
    expect(fixture.componentInstance.editor()).not.toBeNull();
    // The placeholder is only for pre-editor (server) renders.
    expect(fixture.nativeElement.querySelector('.graphloom-placeholder')).toBeNull();
  });
});
