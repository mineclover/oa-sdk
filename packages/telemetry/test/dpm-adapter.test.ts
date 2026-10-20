import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDpmTelemetryAdapter,
  DEFAULT_PII_KEYS,
  DEFAULT_SENSITIVE_KEYS,
  TelemetryConfigError,
} from '../src/dpm/adapter.js';

const TOKEN_KEY = 'test-salt-secret';

describe('DpmTelemetryAdapter', () => {
  const dpm = createDpmTelemetryAdapter({
    tokenKey: TOKEN_KEY,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('masks sensitive keys and identifier keys in masked mode', () => {
    const payload = {
      email: 'alice@example.com',
      userId: 'u_1',
      password: 'superSecretPassword123',
      accessToken: 'jwt.token.here',
      count: 5,
    };

    const sanitized = dpm.sanitize(payload, 'masked', 'AUTH');
    expect(sanitized).toEqual({
      email: '***MASKED***',
      userId: '***MASKED***',
      password: '***MASKED***',
      accessToken: '***MASKED***',
      count: 5,
    });
  });

  it('keeps identifiers raw in none mode but still masks secrets', () => {
    const sanitized = dpm.sanitize({ email: 'alice@example.com', password: 'p' }, 'none', 'AUTH');
    expect(sanitized).toEqual({ email: 'alice@example.com', password: '***MASKED***' });
  });

  it('drops restricted payload entirely', () => {
    const payload = { cardNumber: '1234-5678', cvc: '123' };
    const sanitized = dpm.sanitize(payload, 'restricted', 'BILLING');
    expect(sanitized).toBeNull();
  });

  it('generates deterministic pseudonym tokens for candidate keys', () => {
    const payload1 = { userId: 'usr_9981', amount: 5000 };
    const payload2 = { userId: 'usr_9981', amount: 9000 };

    const res1 = dpm.sanitize(payload1, 'pseudonymized', 'CHECKOUT');
    const res2 = dpm.sanitize(payload2, 'pseudonymized', 'CHECKOUT');

    // 동일한 userId는 항상 동일한 결정론적 토큰으로 변환되어야 함
    expect(res1?.userId).toBe(res2?.userId);
    expect(res1?.userId).toMatch(/^dpm_tok_user_[a-f0-9]{32}$/);
    expect(res1?.amount).toBe(5000);
    expect(res2?.amount).toBe(9000);
  });

  it('handles nested objects recursively', () => {
    const payload = {
      order: {
        orderId: 'ord_123',
        auth: { token: 'secret_jwt' },
      },
    };

    const sanitized = dpm.sanitize(payload, 'pseudonymized', 'ORDER');
    expect(sanitized?.order?.auth?.token).toBe('***MASKED***');
    expect(sanitized?.order?.orderId).toMatch(/^dpm_tok_order_[a-f0-9]{32}$/);
  });

  describe('keyed tokenizer', () => {
    it('is HMAC-SHA-256 under tokenKey over the namespaced value, truncated to 128 bits', () => {
      const expected = createHmac('sha256', TOKEN_KEY).update('4:user:alice@example.com').digest('hex').slice(0, 32);
      expect(dpm.tokenize('user', 'alice@example.com')).toBe(`dpm_tok_user_${expected}`);
    });

    it('depends on the key: another key yields unrelated tokens', () => {
      const other = createDpmTelemetryAdapter({ tokenKey: 'another-secret' });
      expect(other.tokenize('user', 'alice')).not.toBe(dpm.tokenize('user', 'alice'));
      expect(createDpmTelemetryAdapter({ tokenKey: TOKEN_KEY }).tokenize('user', 'alice')).toBe(
        dpm.tokenize('user', 'alice'),
      );
    });

    it('accepts key bytes', () => {
      const bytes = new TextEncoder().encode(TOKEN_KEY);
      expect(createDpmTelemetryAdapter({ tokenKey: bytes }).tokenize('user', 'alice')).toBe(
        dpm.tokenize('user', 'alice'),
      );
    });

    it('keeps the namespace and value unambiguous', () => {
      const mac = (token: string) => token.slice(token.lastIndexOf('_') + 1);
      // Without the length prefix both would MAC the message "a:b:c".
      expect(mac(dpm.tokenize('a:b', 'c'))).not.toBe(mac(dpm.tokenize('a', 'b:c')));
    });

    it('cannot be forged from a known (value, token) pair without the key', () => {
      // The attack that broke the former unkeyed 32-bit FNV-1a tokens: invert the known
      // suffix to recover the hash state after the secret key, then hash forward.
      const PRIME = 16777619;
      let inverse = PRIME;
      for (let i = 0; i < 5; i++) inverse = Math.imul(inverse, 2 - Math.imul(PRIME, inverse));
      const forge = (knownToken: string, knownSuffix: string, targetSuffix: string): string => {
        let state = Number.parseInt(knownToken.slice(knownToken.lastIndexOf('_') + 1).slice(0, 8), 16) >>> 0;
        for (let i = knownSuffix.length - 1; i >= 0; i--) {
          state = (Math.imul(state, inverse) ^ knownSuffix.charCodeAt(i)) >>> 0;
        }
        for (let i = 0; i < targetSuffix.length; i++) {
          state = Math.imul((state ^ targetSuffix.charCodeAt(i)) >>> 0, PRIME) >>> 0;
        }
        return state.toString(16).padStart(8, '0');
      };

      const bob = `bob_${randomUUID()}@example.com`;
      const known = dpm.tokenize('user', 'alice@example.com');
      const forged = forge(known, ':user:alice@example.com', `:user:${bob}`);
      const real = dpm.tokenize('user', bob);
      expect(real).toMatch(/^dpm_tok_user_[a-f0-9]{32}$/);
      expect(real.slice(real.lastIndexOf('_') + 1).startsWith(forged)).toBe(false);
    });

    it('rejects an empty tokenKey instead of falling back to a guessable key', () => {
      expect(() => createDpmTelemetryAdapter({ tokenKey: '' })).toThrow(TelemetryConfigError);
      expect(() => createDpmTelemetryAdapter({ tokenKey: new Uint8Array(0) })).toThrow(TelemetryConfigError);
    });

    it('uses a random per-instance key when no tokenKey is given (no public default salt)', () => {
      const a = createDpmTelemetryAdapter();
      const b = createDpmTelemetryAdapter();
      // Stable within one adapter instance ...
      expect(a.tokenize('user', 'alice')).toBe(a.tokenize('user', 'alice'));
      expect(a.tokenize('user', 'alice')).toMatch(/^dpm_tok_user_[a-f0-9]{32}$/);
      // ... but not recomputable by anyone else.
      expect(a.tokenize('user', 'alice')).not.toBe(b.tokenize('user', 'alice'));
    });

    it('fails closed when no key is given and the runtime cannot generate one', () => {
      vi.stubGlobal('crypto', undefined);
      const adapter = createDpmTelemetryAdapter();
      expect(() => adapter.tokenize('user', 'alice')).toThrow(TelemetryConfigError);
      expect(() => adapter.sanitize({ userId: 'alice' }, 'pseudonymized')).toThrow(TelemetryConfigError);
      // Levels that do not tokenize keep working.
      expect(adapter.sanitize({ userId: 'alice', password: 'p' }, 'masked')).toEqual({
        userId: '***MASKED***',
        password: '***MASKED***',
      });
    });

    it('delegates to customTokenizer when given', () => {
      const custom = createDpmTelemetryAdapter({ customTokenizer: (ns, value) => `srv_${ns}_${value.length}` });
      expect(custom.sanitize({ userId: 'alice' }, 'pseudonymized')).toEqual({ userId: 'srv_user_5' });
    });
  });

  describe('identifier keys', () => {
    it('namespaces tokens by entity kind, so a user keeps one token across domains', () => {
      const cart = dpm.sanitize({ userId: 'alice_123' }, 'pseudonymized', 'CART');
      const checkout = dpm.sanitize({ userId: 'alice_123' }, 'pseudonymized', 'CHECKOUT');
      expect(cart?.userId).toBe(checkout?.userId);
      expect(cart?.userId).toBe(dpm.tokenize('user', 'alice_123'));
      expect(dpm.sanitize({ user_id: 'alice_123' }, 'pseudonymized', 'GLOBAL')?.user_id).toBe(cart?.userId);
    });

    it('matches camelCase / snake_case variants of identifier keys', () => {
      const payload = {
        customerEmail: 'bob@example.com',
        user_email: 'carol@example.com',
        phoneNumber: '010-1111',
        billingUserId: 'u_9',
        emailVerified: true,
      };
      expect(dpm.sanitize(payload, 'masked')).toEqual({
        customerEmail: '***MASKED***',
        user_email: '***MASKED***',
        phoneNumber: '***MASKED***',
        billingUserId: '***MASKED***',
        emailVerified: true,
      });
      const pseudo = dpm.sanitize(payload, 'pseudonymized');
      expect(pseudo?.customerEmail).toBe(dpm.tokenize('email', 'bob@example.com'));
      expect(pseudo?.user_email).toBe(dpm.tokenize('email', 'carol@example.com'));
      expect(pseudo?.phoneNumber).toBe(dpm.tokenize('phone', '010-1111'));
      expect(pseudo?.billingUserId).toBe(dpm.tokenize('user', 'u_9'));
    });

    it('protects numeric identifiers and every scalar nested under an identifier key', () => {
      const sanitized = dpm.sanitize(
        { userId: 42, emails: ['a@x.io', 'b@x.io'], accountId: { primary: 'acc_1' } },
        'pseudonymized',
      );
      expect(sanitized?.userId).toBe(dpm.tokenize('user', '42'));
      expect(sanitized?.emails).toEqual([dpm.tokenize('email', 'a@x.io'), dpm.tokenize('email', 'b@x.io')]);
      expect(sanitized?.accountId).toEqual({ primary: dpm.tokenize('account', 'acc_1') });
    });

    it('accepts a custom piiKeys map that extends the defaults', () => {
      const custom = createDpmTelemetryAdapter({
        tokenKey: TOKEN_KEY,
        piiKeys: { ...DEFAULT_PII_KEYS, deviceId: 'device' },
      });
      const sanitized = custom.sanitize({ device_id: 'dev_1', userId: 'u' }, 'pseudonymized');
      expect(sanitized?.device_id).toBe(custom.tokenize('device', 'dev_1'));
      expect(sanitized?.userId).toBe(custom.tokenize('user', 'u'));
    });
  });

  describe('sensitive keys', () => {
    it('normalizes configured keys like payload keys (case and separators)', () => {
      const custom = createDpmTelemetryAdapter({ sensitiveKeys: ['apiKey', 'api_key'] });
      expect(custom.sanitize({ apiKey: 'sk_live_1', api_key: 'sk_live_2', 'x-api-key': 'sk_live_3' }, 'none')).toEqual(
        {
          apiKey: '***MASKED***',
          api_key: '***MASKED***',
          'x-api-key': '***MASKED***',
        },
      );
    });

    it('replaces the defaults; spreading DEFAULT_SENSITIVE_KEYS extends them', () => {
      const replaced = createDpmTelemetryAdapter({ sensitiveKeys: ['sessionCookie'] });
      expect(replaced.sanitize({ session_cookie: 'c', password: 'p' }, 'none')).toEqual({
        session_cookie: '***MASKED***',
        password: 'p',
      });
      const extended = createDpmTelemetryAdapter({ sensitiveKeys: [...DEFAULT_SENSITIVE_KEYS, 'sessionCookie'] });
      expect(extended.sanitize({ session_cookie: 'c', password: 'p' }, 'none')).toEqual({
        session_cookie: '***MASKED***',
        password: '***MASKED***',
      });
    });

    it('masks API keys by default', () => {
      expect(dpm.sanitize({ apiKey: 'sk_live_1', api_key: 'sk_live_2' }, 'none')).toEqual({
        apiKey: '***MASKED***',
        api_key: '***MASKED***',
      });
    });
  });

  describe('object graph safety', () => {
    it('marks cycles instead of overflowing the stack', () => {
      const payload: Record<string, unknown> = { a: 1 };
      payload.self = payload;
      const nested: Record<string, unknown> = { name: 'n' };
      nested.parent = { child: nested };
      payload.nested = nested;

      expect(dpm.sanitize(payload, 'none')).toEqual({
        a: 1,
        self: '[Circular]',
        nested: { name: 'n', parent: { child: '[Circular]' } },
      });
    });

    it('does not treat shared (non-cyclic) references as cycles', () => {
      const shared = { v: 1 };
      expect(dpm.sanitize({ a: shared, b: shared, list: [shared, shared] }, 'none')).toEqual({
        a: { v: 1 },
        b: { v: 1 },
        list: [{ v: 1 }, { v: 1 }],
      });
    });

    it('limits nesting depth', () => {
      let deep: Record<string, unknown> = { leaf: true };
      for (let i = 0; i < 20; i++) deep = { next: deep };
      let cursor: unknown = dpm.sanitize(deep, 'none');
      let levels = 0;
      while (typeof cursor === 'object' && cursor !== null && 'next' in cursor) {
        cursor = cursor.next;
        levels++;
      }
      expect(cursor).toBe('[MaxDepth]');
      expect(levels).toBe(10);
    });

    it('serializes toJSON values and summarizes other non-plain objects', () => {
      class Session {
        constructor(readonly id: string) {}
      }
      const date = new Date('2026-01-02T03:04:05.000Z');
      const throwing = {
        toJSON() {
          throw new Error('nope');
        },
      };
      expect(
        dpm.sanitize(
          { at: date, map: new Map([['k', 'v']]), set: new Set([1]), session: new Session('s'), throwing },
          'none',
        ),
      ).toEqual({
        at: '2026-01-02T03:04:05.000Z',
        map: '[Map]',
        set: '[Set]',
        session: '[Session]',
        throwing: '[Unserializable]',
      });
    });

    it('keeps a literal __proto__ key as data without touching the prototype', () => {
      const payload = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as Record<string, unknown>;
      const sanitized = dpm.sanitize(payload, 'none');
      expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(sanitized, '__proto__')).toBe(true);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });
});
