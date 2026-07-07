import { expect, it } from 'vitest';
import { Emitter } from './events.js';

interface TestMap {
  ping: { n: number };
  pong: { s: string };
}

it('delivers payloads to the right typed handlers', () => {
  const emitter = new Emitter<TestMap>();
  const pings: number[] = [];
  const pongs: string[] = [];
  emitter.on('ping', (p) => pings.push(p.n));
  emitter.on('pong', (p) => pongs.push(p.s));
  emitter.emit('ping', { n: 1 });
  emitter.emit('pong', { s: 'a' });
  emitter.emit('ping', { n: 2 });
  expect(pings).toEqual([1, 2]);
  expect(pongs).toEqual(['a']);
});

it('calls handlers synchronously in subscription order (documented guarantee)', () => {
  const emitter = new Emitter<TestMap>();
  const order: string[] = [];
  emitter.on('ping', () => order.push('first'));
  emitter.on('ping', () => order.push('second'));
  emitter.on('ping', () => order.push('third'));
  emitter.emit('ping', { n: 0 });
  expect(order).toEqual(['first', 'second', 'third']);
});

it('does not leak subscriptions (P2-T03 acceptance)', () => {
  const emitter = new Emitter<TestMap>();
  const offs = Array.from({ length: 50 }, () => emitter.on('ping', () => {}));
  expect(emitter.listenerCount('ping')).toBe(50);
  for (const off of offs) off();
  expect(emitter.listenerCount('ping')).toBe(0);
  offs[0]!(); // double-unsubscribe is safe
  expect(emitter.listenerCount('ping')).toBe(0);
  emitter.emit('ping', { n: 1 }); // no handlers left, no throw
});

it('off removes a specific handler and unknown handlers are a no-op', () => {
  const emitter = new Emitter<TestMap>();
  const seen: number[] = [];
  const handler = (p: { n: number }): void => {
    seen.push(p.n);
  };
  emitter.on('ping', handler);
  emitter.off('ping', handler);
  emitter.off('ping', () => {}); // never subscribed
  emitter.emit('ping', { n: 1 });
  expect(seen).toEqual([]);
});

it('handlers subscribed during an emit do not receive that emit; unsubscribed ones are skipped', () => {
  const emitter = new Emitter<TestMap>();
  const calls: string[] = [];
  const late = (): void => {
    calls.push('late');
  };
  const second = (): void => {
    calls.push('second');
  };
  emitter.on('ping', () => {
    calls.push('first');
    emitter.on('ping', late);
    emitter.off('ping', second);
  });
  emitter.on('ping', second);
  emitter.emit('ping', { n: 0 });
  expect(calls).toEqual(['first']);
  emitter.emit('ping', { n: 1 });
  expect(calls).toEqual(['first', 'first', 'late']);
});
