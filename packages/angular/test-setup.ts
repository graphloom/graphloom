// JIT-compiles component templates at test time (no build-step transforms).
import '@angular/compiler';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';

import { beforeEach } from 'vitest';

// The SSR smoke test runs in a node environment (no DOM); TestBed is only
// initialized for the jsdom suites.
if (typeof document !== 'undefined') {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  // Vitest has no Angular test framework hooks — reset TestBed ourselves.
  beforeEach(() => getTestBed().resetTestingModule());
}
