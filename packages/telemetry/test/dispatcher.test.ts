import { describe, expect, it, vi } from 'vitest';
import { createGtmDispatcher } from '../src/dispatcher/gtm.js';
import { createSentryDispatcher } from '../src/dispatcher/sentry.js';
import { createOtelDispatcher } from '../src/dispatcher/otel.js';
import { createCompositeDispatcher } from '../src/dispatcher/composite.js';
import { createTelemetryEnvelope } from '../src/envelope/builder.js';
import { SymbolDefinition } from '../src/symbols/types.js';

describe('Dispatchers', () => {
  const symbolDef: SymbolDefinition = {
    symbol: 'FSM:CHECKOUT:PAYMENT:APPROVED',
    description: 'Payment approved',
    piiLevel: 'none',
    routing: {
      gtm: { eventName: 'purchase' },
      sentry: { level: 'info', asBreadcrumb: true },
    },
  };

  const envelope = createTelemetryEnvelope({
    symbol: 'FSM:CHECKOUT:PAYMENT:APPROVED',
    payload: { amount: 3000 },
    context: { traceId: 'trace_123', actorId: 'checkoutActor' },
  });

  it('dispatches to GTM dataLayer', () => {
    const dataLayer: any[] = [];
    const gtm = createGtmDispatcher({ dataLayer, whitelistOnly: true });

    gtm.dispatch(envelope, symbolDef);

    expect(dataLayer).toHaveLength(1);
    expect(dataLayer[0]).toMatchObject({
      event: 'purchase',
      track_symbol: 'FSM:CHECKOUT:PAYMENT:APPROVED',
      amount: 3000,
    });
  });

  it('dispatches to Sentry client', () => {
    const mockClient = {
      addBreadcrumb: vi.fn(),
      setContext: vi.fn(),
      captureException: vi.fn(),
    };
    const sentry = createSentryDispatcher({ client: mockClient });

    sentry.dispatch(envelope, symbolDef);

    expect(mockClient.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'xstate.checkout',
        message: 'FSM:CHECKOUT:PAYMENT:APPROVED',
        level: 'info',
      }),
    );
    expect(mockClient.setContext).toHaveBeenCalledWith(
      'xstate:checkoutActor',
      expect.objectContaining({
        lastSymbol: 'FSM:CHECKOUT:PAYMENT:APPROVED',
      }),
    );
  });

  it('dispatches to OTel tracer', () => {
    const mockSpan = {
      addEvent: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };
    const mockTracer = {
      startSpan: vi.fn().mockReturnValue(mockSpan),
      getActiveSpan: vi.fn().mockReturnValue(mockSpan),
    };

    const otel = createOtelDispatcher({ tracer: mockTracer });
    otel.dispatch(envelope, symbolDef);

    expect(mockSpan.addEvent).toHaveBeenCalledWith(
      'FSM:CHECKOUT:PAYMENT:APPROVED',
      expect.objectContaining({
        'xstate.actor_id': 'checkoutActor',
      }),
    );

    const spanId = otel.dispatchSpanStart?.('my_span');
    expect(spanId).toBeDefined();
    otel.dispatchSpanEnd?.(spanId as string, 'ok');
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('composite dispatcher broadcasts to all registered providers', () => {
    const dataLayer: any[] = [];
    const gtm = createGtmDispatcher({ dataLayer, whitelistOnly: false });
    const mockSentry = {
      addBreadcrumb: vi.fn(),
      setContext: vi.fn(),
      captureException: vi.fn(),
    };
    const sentry = createSentryDispatcher({ client: mockSentry });

    const composite = createCompositeDispatcher(gtm, sentry);
    composite.dispatch(envelope, symbolDef);

    expect(dataLayer).toHaveLength(1);
    expect(mockSentry.addBreadcrumb).toHaveBeenCalled();
  });
});
