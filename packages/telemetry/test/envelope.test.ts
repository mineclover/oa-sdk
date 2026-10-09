import { describe, expect, it } from 'vitest';
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
});
