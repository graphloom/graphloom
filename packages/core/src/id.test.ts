import { expect, it } from 'vitest';
import { uuidv7 } from './id.js';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

it('generates RFC 9562 version-7 uuids', () => {
  for (let i = 0; i < 100; i++) expect(uuidv7()).toMatch(V7);
});

it('never collides and stays monotonic across 10k ids (P2-T01 acceptance)', () => {
  const ids = Array.from({ length: 10_000 }, () => uuidv7());
  expect(new Set(ids).size).toBe(ids.length);
  const sorted = [...ids].sort();
  expect(ids).toEqual(sorted);
});
