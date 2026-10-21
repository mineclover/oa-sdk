import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHmacSha256, sha256, toHex, utf8Encode } from '../src/dpm/hmac-sha256.js';

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

describe('SHA-256 / HMAC-SHA-256 (sync, isomorphic)', () => {
  it('matches the FIPS 180-4 SHA-256 examples', () => {
    expect(toHex(sha256(utf8Encode('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256(utf8Encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(sha256(utf8Encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('matches the RFC 4231 HMAC-SHA-256 test cases', () => {
    // Test case 1
    expect(toHex(createHmacSha256(fromHex('0b'.repeat(20)))(utf8Encode('Hi There')))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
    // Test case 2
    expect(toHex(createHmacSha256(utf8Encode('Jefe'))(utf8Encode('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    // Test case 6: key longer than the block size is hashed first
    expect(
      toHex(
        createHmacSha256(fromHex('aa'.repeat(131)))(
          utf8Encode('Test Using Larger Than Block-Size Key - Hash Key First'),
        ),
      ),
    ).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it('agrees with node:crypto across block boundaries and key lengths', () => {
    for (let length = 0; length < 200; length++) {
      const message = randomBytes(length);
      const key = randomBytes((length * 7) % 150);
      expect(toHex(sha256(message))).toBe(createHash('sha256').update(message).digest('hex'));
      expect(toHex(createHmacSha256(key)(message))).toBe(createHmac('sha256', key).update(message).digest('hex'));
    }
  });
});
