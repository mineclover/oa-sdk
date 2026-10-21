/**
 * Synchronous, dependency-free SHA-256 (FIPS 180-4) and HMAC-SHA-256 (RFC 2104).
 *
 * The telemetry sanitizer runs inside XState's synchronous `inspect` callback in
 * browsers and Node alike, so it cannot await WebCrypto and cannot rely on
 * `node:crypto`. This module is internal to the package (not re-exported).
 */

const ROUND_CONSTANT_WORDS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const INITIAL_HASH_WORDS = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/** Words packed big-endian into a DataView, so reads need no index checks. */
function wordView(words: readonly number[]): DataView {
  const view = new DataView(new ArrayBuffer(words.length * 4));
  words.forEach((word, index) => view.setUint32(index * 4, word));
  return view;
}

const ROUND_CONSTANTS = wordView(ROUND_CONSTANT_WORDS);
const INITIAL_HASH = wordView(INITIAL_HASH_WORDS);

const BLOCK_BYTES = 64;

const textEncoder = new TextEncoder();

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Encodes a string as UTF-8 bytes. */
export function utf8Encode(value: string): Uint8Array {
  return textEncoder.encode(value);
}

/** Lower-case hexadecimal encoding of a byte array. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/** SHA-256 digest of `message` (32 bytes). */
export function sha256(message: Uint8Array): Uint8Array {
  // Padding: 0x80, zeros, then the 64-bit big-endian bit length, to a multiple of 64 bytes.
  const paddedLength = Math.ceil((message.length + 9) / BLOCK_BYTES) * BLOCK_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new DataView(INITIAL_HASH.buffer.slice(0));
  const schedule = new DataView(new ArrayBuffer(64 * 4));

  for (let offset = 0; offset < paddedLength; offset += BLOCK_BYTES) {
    for (let i = 0; i < 16; i++) {
      schedule.setUint32(i * 4, view.getUint32(offset + i * 4));
    }
    for (let i = 16; i < 64; i++) {
      const w15 = schedule.getUint32((i - 15) * 4);
      const w2 = schedule.getUint32((i - 2) * 4);
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      // setUint32 stores the sum modulo 2^32.
      schedule.setUint32(i * 4, schedule.getUint32((i - 16) * 4) + s0 + schedule.getUint32((i - 7) * 4) + s1);
    }

    let a = hash.getUint32(0);
    let b = hash.getUint32(4);
    let c = hash.getUint32(8);
    let d = hash.getUint32(12);
    let e = hash.getUint32(16);
    let f = hash.getUint32(20);
    let g = hash.getUint32(24);
    let h = hash.getUint32(28);

    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choose + ROUND_CONSTANTS.getUint32(i * 4) + schedule.getUint32(i * 4)) | 0;
      const sigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    const working = [a, b, c, d, e, f, g, h];
    working.forEach((word, index) => hash.setUint32(index * 4, hash.getUint32(index * 4) + word));
  }

  return new Uint8Array(hash.buffer);
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left);
  out.set(right, left.length);
  return out;
}

/**
 * Prepares an HMAC-SHA-256 function for `key`. The padded inner/outer key blocks are
 * computed once, so repeated MACs under the same key only hash the message.
 */
export function createHmacSha256(key: Uint8Array): (message: Uint8Array) => Uint8Array {
  const keyBlock = new Uint8Array(BLOCK_BYTES);
  keyBlock.set(key.length > BLOCK_BYTES ? sha256(key) : key);

  const innerPad = keyBlock.map((byte) => byte ^ 0x36);
  const outerPad = keyBlock.map((byte) => byte ^ 0x5c);

  return (message: Uint8Array) => sha256(concatBytes(outerPad, sha256(concatBytes(innerPad, message))));
}
