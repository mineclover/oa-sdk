import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGtmDispatcher } from '../src/dispatcher/gtm.js';
import { createSentryDispatcher } from '../src/dispatcher/sentry.js';
import { createOtelDispatcher, type OtelDispatcherOptions } from '../src/dispatcher/otel.js';
import { createCompositeDispatcher } from '../src/dispatcher/composite.js';
import { createTelemetryEnvelope } from '../src/envelope/builder.js';
import type { SymbolDefinition } from '../src/symbols/types.js';
import type { TelemetryDispatcher } from '../src/dispatcher/types.js';
import { createRecordingTrace, RecordingSpan } from './support/opentelemetry-api.js';

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

  describe('reserved keys', () => {
    const spoofing = createTelemetryEnvelope({
      symbol: 'UI:CHECKOUT:PAY_BTN:CLICK',
      payload: { event: 'click', track_symbol: 'spoof', trace_id: 'x', actorId: 'evil', traceId: 'x', amount: 1 },
      context: { traceId: 'trace_real', actorId: 'checkout', stateNode: 'paying' },
    });
    const payDef: SymbolDefinition = {
      symbol: 'UI:CHECKOUT:PAY_BTN:CLICK',
      description: 'Pay button',
      piiLevel: 'none',
      routing: { gtm: { eventName: 'begin_checkout' } },
    };

    it('GTM: payload fields cannot override the event name, symbol or context keys', () => {
      const dataLayer: Record<string, unknown>[] = [];
      createGtmDispatcher({ dataLayer }).dispatch(spoofing, payDef);

      expect(dataLayer[0]).toMatchObject({
        event: 'begin_checkout',
        track_symbol: 'UI:CHECKOUT:PAY_BTN:CLICK',
        trace_id: 'trace_real',
        actor_id: 'checkout',
        state_node: 'paying',
        amount: 1,
      });
    });

    it('Sentry: payload fields cannot override breadcrumb context keys', () => {
      const client = { addBreadcrumb: vi.fn(), setContext: vi.fn(), captureException: vi.fn() };
      createSentryDispatcher({ client }).dispatch(spoofing, payDef);

      expect(client.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actorId: 'checkout', traceId: 'trace_real', stateNode: 'paying', amount: 1 }),
        }),
      );
    });
  });

  describe('Sentry global client', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('uses a valid globalThis.Sentry and ignores an object that is not a Sentry client', () => {
      const client = { addBreadcrumb: vi.fn(), setContext: vi.fn(), captureException: vi.fn() };
      vi.stubGlobal('Sentry', client);
      createSentryDispatcher().dispatch(envelope, symbolDef);
      expect(client.addBreadcrumb).toHaveBeenCalledTimes(1);

      vi.stubGlobal('Sentry', { addBreadcrumb: 'not a function' });
      expect(() => createSentryDispatcher().dispatch(envelope, symbolDef)).not.toThrow();
    });

    it('tags the scope when capturing an error', () => {
      const scope = { setTag: vi.fn(), setExtra: vi.fn() };
      const client = {
        addBreadcrumb: vi.fn(),
        setContext: vi.fn(),
        captureException: vi.fn(),
        withScope: (callback: (s: typeof scope) => void) => callback(scope),
      };
      const error = new Error('boom');
      createSentryDispatcher({ client }).dispatchError?.(error, { traceId: 't1', actorId: 'a1' }, 'idle');

      expect(scope.setTag).toHaveBeenCalledWith('xstate.state_node', 'idle');
      expect(scope.setTag).toHaveBeenCalledWith('xstate.actor_id', 'a1');
      expect(scope.setTag).toHaveBeenCalledWith('trace_id', 't1');
      expect(scope.setExtra).toHaveBeenCalledWith('telemetry_context', { traceId: 't1', actorId: 'a1' });
      expect(client.captureException).toHaveBeenCalledWith(error);
    });
  });

  describe('OTel with an @opentelemetry/api-shaped tracer', () => {
    function recordingSpan() {
      return { addEvent: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), end: vi.fn() };
    }

    it('records events and errors on the span returned by the getActiveSpan option', () => {
      const active = recordingSpan();
      // A real Tracer only has startSpan / startActiveSpan; getActiveSpan lives on the trace API.
      const tracer = { startSpan: vi.fn(() => recordingSpan()) };
      const otel = createOtelDispatcher({ tracer, getActiveSpan: () => active });

      otel.dispatch(envelope, symbolDef);
      otel.dispatchError?.(new Error('boom'), { traceId: 't', actorId: 'checkoutActor' }, 'paying');

      expect(active.addEvent).toHaveBeenCalledWith(
        'FSM:CHECKOUT:PAYMENT:APPROVED',
        expect.objectContaining({ 'xstate.actor_id': 'checkoutActor' }),
      );
      expect(active.recordException).toHaveBeenCalledWith(expect.any(Error));
      expect(active.setStatus).toHaveBeenCalledWith({ code: 2, message: 'boom' });
    });

    it('accepts the @opentelemetry/api tracer and active-span resolver the README passes', () => {
      const otelApi = createRecordingTrace();
      const { trace } = otelApi;
      // Compile-time guard (tsconfig.test.json): the README Quick Start expressions, typed as
      // @opentelemetry/api 1.9.0 declares them, must be accepted under exactOptionalPropertyTypes.
      const tracer: OtelDispatcherOptions['tracer'] = trace.getTracer('app');
      const getActiveSpan: OtelDispatcherOptions['getActiveSpan'] = () => trace.getActiveSpan();
      const otel = createOtelDispatcher({ tracer: trace.getTracer('app'), getActiveSpan: () => trace.getActiveSpan() });
      expect(tracer).toBeDefined();
      expect(getActiveSpan?.()).toBeUndefined();

      // Attributes OpenTelemetry cannot represent are dropped before they reach the tracer.
      const spanId = otel.dispatchSpanStart?.('xstate.actor:checkout', {
        'xstate.actor.id': 'checkout',
        'xstate.actor.session_id': 'x:4',
        'retry.count': 2,
        'feature.flags': ['a', 'b'],
        'actor.ref': { id: 'checkout' },
        'mixed.list': ['a', 1],
        callback: () => undefined,
      });
      const [actorSpan] = otelApi.spans;
      expect(actorSpan?.attributes).toEqual({
        'xstate.actor.id': 'checkout',
        'xstate.actor.session_id': 'x:4',
        'retry.count': 2,
        'feature.flags': ['a', 'b'],
      });
      expect(actorSpan?.invalidAttributes).toEqual([]);

      // With no ambient span the event lands on the actor instance's span.
      otel.dispatch(envelopeFor({ actorId: 'checkout', actorSessionId: 'x:4' }), symbolDef);
      expect(actorSpan?.events.map((event) => event.name)).toEqual(['FSM:CHECKOUT:PAYMENT:APPROVED']);

      // An error-shaped rejection that is not an Error reaches recordException as an Exception.
      otel.dispatchSpanEnd?.(spanId as string, 'error', { code: 'E_DECLINED', message: 'card declined' });
      expect(actorSpan?.statuses).toEqual([{ code: 2, message: 'card declined' }]);
      expect(actorSpan?.exceptions).toEqual([{ code: 'E_DECLINED', message: 'card declined' }]);
      expect(actorSpan?.endCount).toBe(1);

      const ambient = new RecordingSpan('request');
      otelApi.setActiveSpan(ambient);
      otel.dispatchError?.(42, { traceId: 't' }, 'paying');
      expect(ambient.statuses).toEqual([{ code: 2, message: '42' }]);
      expect(ambient.exceptions).toEqual(['42']);
      expect(ambient.events).toEqual([{ name: 'error', attributes: { 'xstate.state_node': 'paying' } }]);
    });

    function actorSpanAttributes(actorId: string, sessionId: string): Record<string, unknown> {
      return { 'xstate.actor.id': actorId, 'xstate.actor.session_id': sessionId };
    }

    function envelopeFor(context: { actorId: string; actorSessionId?: string }) {
      return createTelemetryEnvelope({
        symbol: 'FSM:CHECKOUT:PAYMENT:APPROVED',
        payload: {},
        context: { traceId: 't', ...context },
      });
    }

    it("falls back to the span of the event's actor instance when there is no ambient span", () => {
      const actorSpan = recordingSpan();
      const tracer = { startSpan: vi.fn(() => actorSpan) };
      const otel = createOtelDispatcher({ tracer });

      const spanId = otel.dispatchSpanStart?.('xstate.actor:checkoutActor', actorSpanAttributes('checkoutActor', 'x:7'));
      otel.dispatch(envelopeFor({ actorId: 'checkoutActor', actorSessionId: 'x:7' }), symbolDef);
      expect(actorSpan.addEvent).toHaveBeenCalledTimes(1);
      expect(actorSpan.addEvent).toHaveBeenCalledWith('FSM:CHECKOUT:PAYMENT:APPROVED', expect.any(Object));

      // An actorId alone is not a fallback key: every instance of an invoked child shares it.
      otel.dispatch(envelopeFor({ actorId: 'checkoutActor' }), symbolDef);
      expect(actorSpan.addEvent).toHaveBeenCalledTimes(1);

      otel.dispatchSpanEnd?.(spanId as string, 'ok');
      expect(actorSpan.end).toHaveBeenCalledTimes(1);

      // Once ended, the span is no longer a fallback target.
      otel.dispatch(envelopeFor({ actorId: 'checkoutActor', actorSessionId: 'x:7' }), symbolDef);
      expect(actorSpan.addEvent).toHaveBeenCalledTimes(1);
    });

    it('never lands an event on another instance that shares the actor id, nor on an ambiguous session', () => {
      const spans = [recordingSpan(), recordingSpan(), recordingSpan(), recordingSpan()];
      let next = 0;
      const tracer = { startSpan: vi.fn(() => spans[next++] ?? recordingSpan()) };
      const otel = createOtelDispatcher({ tracer });
      const [first, second, dupA, dupB] = spans;

      // Two concurrent requests invoke the same `paymentActor` id.
      otel.dispatchSpanStart?.('xstate.actor:paymentActor', actorSpanAttributes('paymentActor', 'x:1'));
      otel.dispatchSpanStart?.('xstate.actor:paymentActor', actorSpanAttributes('paymentActor', 'x:2'));
      otel.dispatch(envelopeFor({ actorId: 'paymentActor', actorSessionId: 'x:2' }), symbolDef);
      expect(first?.addEvent).not.toHaveBeenCalled();
      expect(second?.addEvent).toHaveBeenCalledTimes(1);

      // A session id that matches two open spans (e.g. two xstate copies) is ambiguous: no fallback.
      otel.dispatchSpanStart?.('xstate.actor:dup', actorSpanAttributes('dup', 'x:9'));
      otel.dispatchSpanStart?.('xstate.actor:dup', actorSpanAttributes('dup', 'x:9'));
      otel.dispatch(envelopeFor({ actorId: 'dup', actorSessionId: 'x:9' }), symbolDef);
      expect(dupA?.addEvent).not.toHaveBeenCalled();
      expect(dupB?.addEvent).not.toHaveBeenCalled();
    });

    it("records errors on the ambient span only; an actor's span records its error once, when it ends", () => {
      const actorSpan = recordingSpan();
      const tracer = { startSpan: vi.fn(() => actorSpan) };
      const otel = createOtelDispatcher({ tracer });
      const error = new Error('declined');

      const spanId = otel.dispatchSpanStart?.('xstate.actor:paymentActor', actorSpanAttributes('paymentActor', 'x:3'));
      // The inspector dispatches the error, then ends the actor's span with it.
      otel.dispatchError?.(error, { traceId: 't', actorId: 'paymentActor', actorSessionId: 'x:3' }, undefined);
      expect(actorSpan.setStatus).not.toHaveBeenCalled();
      expect(actorSpan.recordException).not.toHaveBeenCalled();

      otel.dispatchSpanEnd?.(spanId as string, 'error', error);
      expect(actorSpan.setStatus.mock.calls).toEqual([[{ code: 2, message: 'declined' }]]);
      expect(actorSpan.recordException.mock.calls).toEqual([[error]]);
      expect(actorSpan.end).toHaveBeenCalledTimes(1);
    });

    it('issues a distinct span id per span, even within one millisecond', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      try {
        const first = recordingSpan();
        const second = recordingSpan();
        const queue = [first, second];
        const otel = createOtelDispatcher({ tracer: { startSpan: () => queue.shift() ?? recordingSpan() } });

        const firstId = otel.dispatchSpanStart?.('a');
        const secondId = otel.dispatchSpanStart?.('b');
        expect(firstId).not.toBe(secondId);
        otel.dispatchSpanEnd?.(firstId as string, 'ok');
        expect(first.end).toHaveBeenCalledTimes(1);
        expect(second.end).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('is a documented no-op without a tracer or active span', () => {
      const otel = createOtelDispatcher();
      expect(otel.dispatchSpanStart?.('s')).toBeUndefined();
      expect(() => otel.dispatch(envelope, symbolDef)).not.toThrow();
    });
  });

  describe('composite failure isolation and span fan-out', () => {
    function spanDispatcher(name: string, log: string[]): TelemetryDispatcher {
      let n = 0;
      return {
        name,
        dispatch: () => log.push(`${name}:dispatch`),
        dispatchSpanStart: (spanName: string) => {
          n += 1;
          log.push(`${name}:start:${spanName}`);
          return `${name}_${n}`;
        },
        dispatchSpanEnd: (spanId: string, status?: 'ok' | 'error') => {
          log.push(`${name}:end:${spanId}:${status}`);
        },
      };
    }

    it('starts the span on every span-capable child and ends each with its own id', () => {
      const log: string[] = [];
      const composite = createCompositeDispatcher(spanDispatcher('a', log), spanDispatcher('b', log));

      const spanId = composite.dispatchSpanStart?.('s1');
      expect(typeof spanId).toBe('string');
      composite.dispatchSpanEnd?.(spanId as string, 'error');

      expect(log).toEqual(['a:start:s1', 'b:start:s1', 'a:end:a_1:error', 'b:end:b_1:error']);
    });

    it('isolates a child whose span start throws', () => {
      const log: string[] = [];
      const throwing = createOtelDispatcher({
        tracer: {
          startSpan() {
            throw new Error('tracer misconfigured');
          },
        },
      });
      const composite = createCompositeDispatcher(throwing, spanDispatcher('b', log));

      let spanId: string | void = undefined;
      expect(() => {
        spanId = composite.dispatchSpanStart?.('s1');
      }).not.toThrow();
      expect(spanId).toEqual(expect.any(String));
      composite.dispatchSpanEnd?.(String(spanId), 'ok');
      expect(log).toEqual(['b:start:s1', 'b:end:b_1:ok']);
    });

    it('returns undefined when no child produced a span', () => {
      const composite = createCompositeDispatcher(createOtelDispatcher(), createGtmDispatcher({ dataLayer: [] }));
      expect(composite.dispatchSpanStart?.('s1')).toBeUndefined();
    });

    it('isolates a child whose dispatch or dispatchError throws', () => {
      const log: string[] = [];
      const broken: TelemetryDispatcher = {
        name: 'broken',
        dispatch: () => {
          throw new Error('sdk down');
        },
        dispatchError: () => {
          throw new Error('sdk down');
        },
      };
      const healthy: TelemetryDispatcher = {
        name: 'healthy',
        dispatch: () => log.push('dispatch'),
        dispatchError: () => log.push('error'),
      };
      const composite = createCompositeDispatcher(broken, healthy);

      expect(() => composite.dispatch(envelope, symbolDef)).not.toThrow();
      expect(() => composite.dispatchError?.(new Error('x'), { traceId: 't' })).not.toThrow();
      expect(log).toEqual(['dispatch', 'error']);
    });
  });
});
