import { describe, expect, it } from 'vitest';
import { createDpmTelemetryAdapter } from '../src/dpm/adapter.js';

describe('DpmTelemetryAdapter', () => {
  const dpm = createDpmTelemetryAdapter({
    tokenKey: 'test-salt-secret',
  });

  it('masks sensitive keys in payload', () => {
    const payload = {
      email: 'alice@example.com',
      password: 'superSecretPassword123',
      accessToken: 'jwt.token.here',
      count: 5,
    };

    const sanitized = dpm.sanitize(payload, 'masked', 'AUTH');
    expect(sanitized).toEqual({
      email: 'alice@example.com',
      password: '***MASKED***',
      accessToken: '***MASKED***',
      count: 5,
    });
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
    expect(res1?.userId).toMatch(/^dpm_tok_checkout_[a-f0-9]{8}$/);
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
    expect(sanitized?.order?.orderId).toMatch(/^dpm_tok_order_[a-f0-9]{8}$/);
  });
});
