// UUIDv7 (RFC 9562): 48-bit unix-ms timestamp, then a 12-bit monotonic
// counter in rand_a so ids created in the same millisecond still sort in
// creation order (ADR-0004: time-ordered, collision-safe ids).

let lastMs = -1;
let seq = 0;

/**
 * Generates a UUIDv7 string. Monotonic: ids sort lexicographically in
 * creation order, even within one millisecond.
 */
export function uuidv7(): string {
  let ms = Date.now();
  if (ms <= lastMs) {
    ms = lastMs;
    seq = (seq + 1) & 0xfff;
    if (seq === 0) ms = ++lastMs; // ponytail: counter overflow just borrows the next ms
  } else {
    lastMs = ms;
    seq = 0;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // 48-bit big-endian timestamp
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms & 0xff;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = 0x70 | (seq >> 8); // version 7 + counter high nibble
  bytes[7] = seq & 0xff; //         counter low byte
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
