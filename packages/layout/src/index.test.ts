import { expect, it } from 'vitest';
import { createLayoutRunner } from './index.js';

it('exposes the runner through the barrel', () => {
  expect(typeof createLayoutRunner).toBe('function');
});
