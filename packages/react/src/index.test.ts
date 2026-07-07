import { expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

it('exports its package name', () => {
  expect(PACKAGE_NAME).toBe('@graphloom/react');
});
