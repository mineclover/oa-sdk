import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTelemetryEnvelope } from '../src/envelope/builder.js';

describe('Telemetry Envelope Builder', () => {
  it('creates envelope with default trace context', () => {
    const envelope = createTelemetryEnvelope({
      symbol: 'UI:CHECKOUT:BTN:CLICK',
      payload: { itemId: 'sku_123' },
    });

    expect(envelope.symbol).toBe('UI:CHECKOUT:BTN:CLICK');
    expect(envelope.context.traceId).toHaveLength(32);
    expect(envelope.payload).toEqual({ itemId: 'sku_123' });
    expect(envelope.timestamp).toBeGreaterThan(0);
    expect(envelope.environment.environment).toBeDefined();
  });

  it('preserves provided caller context', () => {
    const envelope = createTelemetryEnvelope({
      symbol: 'FSM:AUTH:USER:LOGIN',
      payload: {},
      context: {
        traceId: 'my_custom_trace_id_123456789012',
        actorId: 'authActor',
        userId: 'pseudo_usr_1',
      },
    });

    expect(envelope.context.traceId).toBe('my_custom_trace_id_123456789012');
    expect(envelope.context.actorId).toBe('authActor');
    expect(envelope.context.userId).toBe('pseudo_usr_1');
  });

  it('does not let explicit undefined context fields erase the defaults', () => {
    const envelope = createTelemetryEnvelope({
      symbol: 'UI:A:B:C',
      payload: {},
      context: { actorId: 'a', traceId: undefined, sessionId: undefined },
    });

    expect(envelope.context.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(envelope.context.sessionId).toBe('sess_anonymous');
    expect(envelope.context.actorId).toBe('a');
  });

  describe('environment', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('uses NODE_ENV when it is a known environment name', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(createTelemetryEnvelope({ symbol: 'UI:A:B:C', payload: {} }).environment.environment).toBe('production');
    });

    it('falls back to development for an unknown NODE_ENV', () => {
      vi.stubEnv('NODE_ENV', 'qa-cluster-7');
      expect(createTelemetryEnvelope({ symbol: 'UI:A:B:C', payload: {} }).environment.environment).toBe(
        'development',
      );
    });
  });
});
