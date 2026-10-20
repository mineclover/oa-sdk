import { afterEach, describe, expect, it, vi } from 'vitest';
import { setup, createActor, createMachine, fromPromise, sendParent, type InspectionEvent } from 'xstate';
import { createTelemetryInspector } from '../src/xstate/inspector.js';
import { createSymbolRegistry } from '../src/symbols/registry.js';
import { createGtmDispatcher } from '../src/dispatcher/gtm.js';
import { createSentryDispatcher } from '../src/dispatcher/sentry.js';
import { createOtelDispatcher } from '../src/dispatcher/otel.js';
import { createCompositeDispatcher } from '../src/dispatcher/composite.js';
import { createDpmTelemetryAdapter } from '../src/dpm/adapter.js';
import { clearGlobalTelemetryIdentity, setGlobalTelemetryIdentity } from '../src/identity/identity.js';
import type { TelemetryDispatcher } from '../src/dispatcher/types.js';
import type { TelemetryContext, TelemetryEnvelope } from '../src/envelope/types.js';

const TRACE_ID = /^[a-f0-9]{32}$/;

function recordingDispatcher() {
  const events: TelemetryEnvelope[] = [];
  const errors: Array<{ error: unknown; context: TelemetryContext; stateNode: string | undefined }> = [];
  const started: string[] = [];
  const ended: string[] = [];
  const endStatus = new Map<string, 'ok' | 'error' | undefined>();
  let spanCount = 0;
  const dispatcher: TelemetryDispatcher = {
    name: 'recording',
    dispatch: (envelope) => {
      events.push(envelope);
    },
    dispatchError: (error, context, stateNode) => {
      errors.push({ error, context, stateNode });
    },
    dispatchSpanStart: (spanName) => {
      spanCount += 1;
      const spanId = `${spanName}#${spanCount}`;
      started.push(spanId);
      return spanId;
    },
    dispatchSpanEnd: (spanId, status) => {
      ended.push(spanId);
      endStatus.set(spanId, status);
    },
  };
  /** The id of the first span started for `actorId`. */
  const spanOf = (actorId: string): string | undefined => started.find((id) => id.startsWith(`xstate.actor:${actorId}#`));
  return { dispatcher, events, errors, started, ended, endStatus, spanOf };
}

/** Lets microtasks (the inspector's root-error check) and settled promises run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordingSpan(name: string, attributes: Record<string, unknown>) {
  return { name, attributes, addEvent: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), end: vi.fn() };
}

/** An `@opentelemetry/api`-shaped tracer (no getActiveSpan) that keeps every span it starts. */
function recordingTracer() {
  const spans: Array<ReturnType<typeof recordingSpan>> = [];
  const tracer = {
    startSpan(name: string, spanOptions?: { attributes?: Record<string, unknown> | undefined }) {
      const span = recordingSpan(name, spanOptions?.attributes ?? {});
      spans.push(span);
      return span;
    },
  };
  return { tracer, spans };
}

describe('XState v5 Telemetry Inspector', () => {
  const registry = createSymbolRegistry({ strict: false });
  registry.register({
    symbol: 'FSM:AUTH:USER:LOGIN_SUBMITTED',
    description: 'User login submitted',
    piiLevel: 'pseudonymized',
    routing: {
      gtm: { eventName: 'login_attempt' },
      sentry: { level: 'info', asBreadcrumb: true },
    },
  });

  afterEach(() => {
    clearGlobalTelemetryIdentity();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('captures machine events and dispatches to GTM & Sentry with DPM pseudonymization', () => {
    const dataLayer: Record<string, unknown>[] = [];
    const gtm = createGtmDispatcher({ dataLayer, whitelistOnly: true });

    const mockSentry = {
      addBreadcrumb: vi.fn(),
      setContext: vi.fn(),
      captureException: vi.fn(),
    };
    const sentry = createSentryDispatcher({ client: mockSentry });

    const composite = createCompositeDispatcher(gtm, sentry);
    const dpm = createDpmTelemetryAdapter({ tokenKey: 'test-salt' });

    const inspector = createTelemetryInspector({
      dispatcher: composite,
      registry,
      dpmAdapter: dpm,
    });

    // XState v5 머신 정의
    const machine = setup({
      types: {
        events: {} as {
          type: 'FSM:AUTH:USER:LOGIN_SUBMITTED';
          payload: { userId: string; password: string; email: string };
        },
      },
    }).createMachine({
      id: 'authTest',
      initial: 'idle',
      states: {
        idle: {
          on: {
            'FSM:AUTH:USER:LOGIN_SUBMITTED': 'authenticating',
          },
        },
        authenticating: {},
      },
    });

    const actor = createActor(machine, {
      id: 'authTest',
      inspect: inspector,
    });

    actor.start();

    // 이벤트 발송
    actor.send({
      type: 'FSM:AUTH:USER:LOGIN_SUBMITTED',
      payload: {
        userId: 'alice_123',
        password: 'mySecretPassword',
        email: 'alice@example.com',
      },
    });

    // GTM 검증: 비밀번호는 마스킹되고 userId는 DPM 가명화 토큰으로 변환됨
    expect(dataLayer).toHaveLength(1);
    expect(dataLayer[0]).toMatchObject({
      event: 'login_attempt',
      password: '***MASKED***',
      userId: dpm.tokenize('user', 'alice_123'),
      email: dpm.tokenize('email', 'alice@example.com'),
      actor_id: 'authTest',
      state_node: 'idle',
    });
    expect(dataLayer[0]?.userId).toMatch(/^dpm_tok_user_[a-f0-9]{32}$/);

    // Sentry 검증: Breadcrumb 기록 및 actor context 갱신
    expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'FSM:AUTH:USER:LOGIN_SUBMITTED',
        level: 'info',
        data: expect.objectContaining({
          password: '***MASKED***',
          actorId: 'authTest',
          stateNode: 'idle',
        }),
      }),
    );
    expect(mockSentry.setContext).toHaveBeenCalledWith(
      'xstate:authTest',
      expect.objectContaining({ lastSymbol: 'FSM:AUTH:USER:LOGIN_SUBMITTED', stateNode: 'idle' }),
    );
    expect(actor.getSnapshot().value).toBe('authenticating');
  });

  it('captures async actor lifecycle and error states', async () => {
    const rec = recordingDispatcher();
    const inspector = createTelemetryInspector({
      dispatcher: rec.dispatcher,
      registry,
    });

    const failingService = fromPromise(async () => {
      throw new Error('Async payment failed');
    });

    const machine = setup({
      actors: { failingService },
    }).createMachine({
      id: 'errorTest',
      initial: 'pending',
      states: {
        pending: {
          invoke: {
            id: 'paymentActor',
            src: 'failingService',
            onError: 'failed',
          },
        },
        failed: {},
      },
    });

    const actor = createActor(machine, {
      inspect: inspector,
    });

    actor.start();

    // 비동기 액터 시작 시 Span이 기록되었는지 검증
    const childSpan = rec.started.find((id) => id.startsWith('xstate.actor:paymentActor#'));
    expect(childSpan).toBeDefined();

    // Promise 완료 대기
    await flush();

    // The child's span (and only it) ended, and the error was dispatched once for the child.
    expect(rec.ended).toEqual([childSpan]);
    expect(rec.errors).toHaveLength(1);
    expect(errorMessage(rec.errors[0]?.error)).toBe('Async payment failed');
    expect(rec.errors[0]?.context).toMatchObject({ actorId: 'paymentActor' });
    expect(rec.errors[0]?.stateNode).toBeUndefined();
    expect(actor.getSnapshot().value).toBe('failed');
  });

  it('is assignable to XState ActorOptions.inspect (function and observer forms)', () => {
    const { dispatcher } = recordingDispatcher();
    const inspector = createTelemetryInspector({ dispatcher });
    // Compile-time guard (tsconfig.test.json): the README usage must typecheck.
    const asInspect: (inspectionEvent: InspectionEvent) => void = inspector;
    const machine = createMachine({ initial: 'a', states: { a: {} } });

    expect(() => createActor(machine, { inspect: asInspect }).start()).not.toThrow();
    expect(() => createActor(machine, { inspect: { next: inspector } }).start()).not.toThrow();
  });

  describe('failure isolation (telemetry never breaks the machine)', () => {
    const authMachine = createMachine({
      initial: 'idle',
      states: {
        idle: { on: { LOGOUT: 'loggedOut', 'FSM:AUTH:USER:LOGOUT': 'loggedOut', foo: 'loggedOut' } },
        loggedOut: {},
      },
    });

    it('does not throw for unregistered events with a default (strict) registry', () => {
      const strictRegistry = createSymbolRegistry();
      strictRegistry.register({
        symbol: 'FSM:AUTH:USER:LOGIN_SUBMITTED',
        description: 'login',
        piiLevel: 'none',
      });
      const rec = recordingDispatcher();
      const onError = vi.fn();
      const inspect = createTelemetryInspector({ dispatcher: rec.dispatcher, registry: strictRegistry, onError });

      const plain = createActor(authMachine, { inspect }).start();
      expect(() => plain.send({ type: 'LOGOUT' })).not.toThrow();
      expect(plain.getSnapshot().value).toBe('loggedOut');

      const symbolic = createActor(authMachine, { inspect }).start();
      expect(() => symbolic.send({ type: 'FSM:AUTH:USER:LOGOUT' })).not.toThrow();
      expect(symbolic.getSnapshot().value).toBe('loggedOut');

      expect(onError).not.toHaveBeenCalled();
      expect(rec.events.map((e) => e.symbol)).toEqual(['LOGOUT', 'FSM:AUTH:USER:LOGOUT']);
    });

    it('delivers the event when a non-composite dispatcher throws, and reports through onError', () => {
      const onError = vi.fn();
      const dispatcher: TelemetryDispatcher = {
        name: 'broken',
        dispatch() {
          throw new Error('sdk down');
        },
      };
      const actor = createActor(authMachine, { inspect: createTelemetryInspector({ dispatcher, onError }) }).start();

      expect(() => actor.send({ type: 'LOGOUT' })).not.toThrow();
      expect(actor.getSnapshot().value).toBe('loggedOut');
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'sdk down' }),
        expect.objectContaining({ type: '@xstate.event' }),
      );
    });

    it('drops strictSymbols violations from telemetry without blocking the machine', () => {
      const rec = recordingDispatcher();
      const onError = vi.fn();
      const actor = createActor(authMachine, {
        inspect: createTelemetryInspector({ dispatcher: rec.dispatcher, strictSymbols: true, onError }),
      }).start();

      expect(() => actor.send({ type: 'foo' })).not.toThrow();
      expect(actor.getSnapshot().value).toBe('loggedOut');
      expect(rec.events).toHaveLength(0);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(errorMessage(onError.mock.calls[0]?.[0])).toMatch(/"foo" is not a valid tracking symbol/);
    });

    it('rethrows telemetry failures asynchronously when no onError is given', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const dispatcher: TelemetryDispatcher = {
        name: 'broken',
        dispatch() {
          throw new Error('sdk down');
        },
      };
      const actor = createActor(authMachine, { inspect: createTelemetryInspector({ dispatcher }) }).start();

      expect(() => actor.send({ type: 'LOGOUT' })).not.toThrow();
      expect(actor.getSnapshot().value).toBe('loggedOut');
      expect(() => vi.runAllTimers()).toThrow('sdk down');
    });

    it('survives a throwing tracer: createActor, start and send still work', () => {
      const onError = vi.fn();
      const dispatcher = createOtelDispatcher({
        tracer: {
          startSpan() {
            throw new Error('tracer misconfigured');
          },
        },
      });
      const inspect = createTelemetryInspector({ dispatcher, onError });

      const actor = createActor(authMachine, { inspect });
      expect(() => actor.start()).not.toThrow();
      actor.send({ type: 'LOGOUT' });
      expect(actor.getSnapshot().value).toBe('loggedOut');
      expect(errorMessage(onError.mock.calls[0]?.[0])).toBe('tracer misconfigured');
    });

    it('sanitizes events that carry actor refs (cyclic objects) and still delivers them', () => {
      const rec = recordingDispatcher();
      const child = createMachine({ initial: 'x', states: { x: {} } });
      const parent = createMachine({ initial: 'a', states: { a: { on: { REGISTER: 'b' } }, b: {} } });
      const actor = createActor(parent, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) }).start();
      const ref = createActor(child, { id: 'childRef' });

      expect(() => actor.send({ type: 'REGISTER', ref })).not.toThrow();
      expect(actor.getSnapshot().value).toBe('b');
      expect(rec.events.at(-1)?.payload).toEqual({ ref: { xstate$$type: 1, id: 'childRef' } });
    });
  });

  describe('machine errors', () => {
    const boom = () => {
      throw new Error('action exploded');
    };

    it('dispatches an error thrown by a transition action, and XState still reports it', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const machine = setup({ actions: { boom } }).createMachine({
        initial: 'a',
        states: { a: { on: { GO: { target: 'b', actions: 'boom' } } }, b: {} },
      });
      const actor = createActor(machine, { id: 'root', inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) });
      actor.start();
      actor.send({ type: 'GO' });
      await flush();

      expect(actor.getSnapshot().status).toBe('error');
      expect(rec.errors).toHaveLength(1);
      expect(errorMessage(rec.errors[0]?.error)).toBe('action exploded');
      expect(rec.errors[0]?.context).toMatchObject({ actorId: 'root', stateNode: 'a' });
      // The inspector does not swallow XState's unhandled-error report.
      expect(vi.getTimerCount()).toBe(1);
      expect(() => vi.runAllTimers()).toThrow('action exploded');
      // The root span ended with the error.
      expect(rec.ended).toEqual(rec.started);
    });

    it('dispatches an error thrown by an entry action on start', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const machine = setup({ actions: { boom } }).createMachine({ initial: 'a', states: { a: { entry: 'boom' } } });
      createActor(machine, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) }).start();
      await flush();

      expect(rec.errors.map((e) => errorMessage(e.error))).toEqual(['action exploded']);
      expect(() => vi.runAllTimers()).toThrow('action exploded');
    });

    it('dispatches an error thrown by a guard', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const machine = setup({
        guards: {
          explode: () => {
            throw new Error('guard exploded');
          },
        },
      }).createMachine({ initial: 'a', states: { a: { on: { GO: { guard: 'explode', target: 'b' } } }, b: {} } });
      const actor = createActor(machine, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) }).start();
      actor.send({ type: 'GO' });
      await flush();

      expect(rec.errors).toHaveLength(1);
      expect(errorMessage(rec.errors[0]?.error)).toMatch(/guard exploded/);
      expect(() => vi.runAllTimers()).toThrow(/guard exploded/);
    });

    it('reports an unhandled child error once, although it also fails the parent', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const machine = createMachine({
        initial: 'paying',
        states: {
          paying: {
            invoke: {
              id: 'pay',
              src: fromPromise(async () => {
                throw new Error('promise rejected');
              }),
            },
          },
        },
      });
      const actor = createActor(machine, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) }).start();
      await flush();

      expect(actor.getSnapshot().status).toBe('error');
      expect(rec.errors).toHaveLength(1);
      expect(rec.errors[0]?.context).toMatchObject({ actorId: 'pay' });
      expect(vi.getTimerCount()).toBe(1);
      expect(() => vi.runAllTimers()).toThrow('promise rejected');
      expect([...rec.ended].sort()).toEqual([...rec.started].sort());
    });

    it('reports actors outside the bubbling chain that fail with the same error object', async () => {
      const rec = recordingDispatcher();
      const inspect = createTelemetryInspector({ dispatcher: rec.dispatcher });
      // A memoized rejected promise: every invocation rejects with the same Error instance.
      const shared = new Error('cached failure');
      const cached = Promise.reject(shared);
      cached.catch(() => {});
      const machine = createMachine({
        initial: 'loading',
        states: {
          loading: { invoke: { id: 'load', src: fromPromise(() => cached), onError: 'failed' } },
          failed: { on: { RETRY: 'loading' } },
        },
      });
      const a = createActor(machine, { id: 'A', inspect }).start();
      createActor(machine, { id: 'B', inspect }).start();
      await flush();
      a.send({ type: 'RETRY' });
      await flush();

      // A's first load, B's load and A's retry are three failures of three actors.
      expect(rec.errors).toHaveLength(3);
      expect(rec.errors.every((e) => e.error === shared && e.context.actorId === 'load')).toBe(true);
      expect(new Set(rec.errors.map((e) => e.context.actorSessionId)).size).toBe(3);
    });

    it.each([
      ['a primitive', 'entry-prim'],
      ['an Error', new Error('entry-obj')],
    ])('reports %s thrown by a child entry action during the parent start once', async (_kind, thrown) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const kid = createMachine({
        entry: () => {
          throw thrown;
        },
      });
      const machine = createMachine({ initial: 'a', states: { a: { invoke: { id: 'kid', src: kid } } } });
      const actor = createActor(machine, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) }).start();
      await flush();

      expect(actor.getSnapshot().status).toBe('error');
      expect(rec.errors).toHaveLength(1);
      expect(rec.errors[0]?.error).toBe(thrown);
      expect(rec.errors[0]?.context).toMatchObject({ actorId: 'kid' });
      // XState still reports the unhandled root error itself, once.
      expect(vi.getTimerCount()).toBe(1);
      expect([...rec.ended].sort()).toEqual([...rec.started].sort());
    });

    it.each([
      ['an Error', new Error('leaf rejected')],
      ['a primitive', 'leaf-prim'],
    ])('reports %s that bubbles through a 3-level chain once, for the leaf', async (_kind, rejection) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const mid = createMachine({
        initial: 'waiting',
        states: { waiting: { invoke: { id: 'leaf', src: fromPromise(() => Promise.reject(rejection)) } } },
      });
      const machine = createMachine({ initial: 'a', states: { a: { invoke: { id: 'mid', src: mid } } } });
      const actor = createActor(machine, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) }).start();
      await flush();

      expect(actor.getSnapshot().status).toBe('error');
      expect(rec.errors).toHaveLength(1);
      expect(rec.errors[0]?.error).toBe(rejection);
      expect(rec.errors[0]?.context).toMatchObject({ actorId: 'leaf' });
      expect(vi.getTimerCount()).toBe(1);
      // Every actor in the chain (root, mid, leaf) still ends its span.
      expect(rec.started).toHaveLength(3);
      expect([...rec.ended].sort()).toEqual([...rec.started].sort());
    });

    it("reports a parent's later failure although a handled child failed with the same error", async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const shared = new Error('shared failure');
      const machine = createMachine({
        initial: 'loading',
        states: {
          loading: { invoke: { id: 'load', src: fromPromise(() => Promise.reject(shared)), onError: 'failed' } },
          failed: {
            on: {
              GIVE_UP: {
                actions: () => {
                  throw shared;
                },
              },
            },
          },
        },
      });
      const actor = createActor(machine, { id: 'root', inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) });
      actor.start();
      await flush();
      expect(actor.getSnapshot().value).toBe('failed');
      actor.send({ type: 'GIVE_UP' });
      await flush();

      expect(rec.errors.map((e) => e.context.actorId)).toEqual(['load', 'root']);
      expect(() => vi.runAllTimers()).toThrow('shared failure');
    });

    it("leaves the app's own error listener in charge of the root error", async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const userError = vi.fn();
      const machine = setup({ actions: { boom } }).createMachine({
        initial: 'a',
        states: { a: { on: { GO: { target: 'b', actions: 'boom' } } }, b: {} },
      });
      const actor = createActor(machine, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) });
      actor.subscribe({ error: userError });
      actor.start();
      actor.send({ type: 'GO' });
      await flush();

      expect(userError).toHaveBeenCalledWith(expect.objectContaining({ message: 'action exploded' }));
      expect(rec.errors).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    type ErrorEventLike = { type: string; error?: unknown };

    /** `mid` invokes a rejecting `leaf`, recovers from it and escalates its error event to the parent. */
    function escalatingMid(escalate: (event: ErrorEventLike) => ErrorEventLike) {
      return createMachine({
        initial: 'working',
        states: {
          working: {
            invoke: {
              id: 'leaf',
              src: fromPromise(() => Promise.reject(new Error('leaf rejected'))),
              onError: { target: 'recovered', actions: sendParent(({ event }) => escalate(event)) },
            },
          },
          recovered: {
            on: {
              BREAK: {
                actions: () => {
                  throw new Error('mid own failure');
                },
              },
            },
          },
        },
      });
    }

    it('does not treat a parent that escalates a handled child error as failed', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const escalated = vi.fn();
      const machine = createMachine({
        initial: 'running',
        states: {
          running: {
            invoke: { id: 'mid', src: escalatingMid((event) => event), onError: 'midFailed' },
            on: { 'xstate.error.actor.leaf': { actions: escalated } },
          },
          midFailed: {},
        },
      });
      const actor = createActor(machine, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) }).start();
      await flush();

      const mid = actor.getSnapshot().children['mid'];
      expect(escalated).toHaveBeenCalledTimes(1);
      expect(mid?.getSnapshot().status).toBe('active');
      expect(rec.errors.map((e) => e.context.actorId)).toEqual(['leaf']);
      // The forwarder keeps running, so its span stays open.
      const midSpan = rec.spanOf('mid');
      expect(midSpan).toBeDefined();
      expect(rec.ended).not.toContain(midSpan);

      // Its own later failure is reported, and ends its span with the error.
      mid?.send({ type: 'BREAK' });
      await flush();
      expect(rec.errors.map((e) => [e.context.actorId, errorMessage(e.error)])).toEqual([
        ['leaf', 'leaf rejected'],
        ['mid', 'mid own failure'],
      ]);
      expect(rec.ended.filter((id) => id === midSpan)).toHaveLength(1);
      expect(rec.endStatus.get(midSpan ?? '')).toBe('error');
      expect(actor.getSnapshot().value).toBe('midFailed');
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
      ['the same event object', (event: ErrorEventLike): ErrorEventLike => event],
      ['a re-wrapped error event', (event: ErrorEventLike): ErrorEventLike => ({ type: 'xstate.error.actor.mid', error: event.error })],
    ])('reports an escalated child error that fails the parent once, for the child (%s)', async (_shape, escalate) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const machine = createMachine({ initial: 'running', states: { running: { invoke: { id: 'mid', src: escalatingMid(escalate) } } } });
      const actor = createActor(machine, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) }).start();
      await flush();

      expect(actor.getSnapshot().status).toBe('error');
      expect(rec.errors.map((e) => [e.context.actorId, errorMessage(e.error)])).toEqual([['leaf', 'leaf rejected']]);
      // XState still reports the root's unhandled error itself.
      expect(vi.getTimerCount()).toBe(1);
      expect(() => vi.runAllTimers()).toThrow('leaf rejected');
    });

    describe('an error event sent by an active child', () => {
      const forged = new Error('forged');
      const kid = createMachine({
        on: { FORGE: { actions: sendParent({ type: 'xstate.error.actor.ghost', error: forged }) } },
      });

      it("is not reported as the child's failure", async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const rec = recordingDispatcher();
        const noted = vi.fn();
        const machine = createMachine({
          invoke: { id: 'kid', src: kid },
          on: { 'xstate.error.actor.ghost': { actions: noted } },
        });
        const actor = createActor(machine, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) }).start();
        actor.getSnapshot().children['kid']?.send({ type: 'FORGE' });
        await flush();

        expect(noted).toHaveBeenCalledTimes(1);
        expect(rec.errors).toEqual([]);
        expect(rec.ended).not.toContain(rec.spanOf('kid'));
        expect(vi.getTimerCount()).toBe(0);
      });

      it('is reported once, for the parent, when it fails the parent', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const rec = recordingDispatcher();
        const machine = createMachine({ invoke: { id: 'kid', src: kid } });
        const actor = createActor(machine, { id: 'root', inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) });
        actor.start();
        actor.getSnapshot().children['kid']?.send({ type: 'FORGE' });
        await flush();

        expect(actor.getSnapshot().status).toBe('error');
        expect(rec.errors).toHaveLength(1);
        expect(rec.errors[0]?.error).toBe(forged);
        expect(rec.errors[0]?.context).toMatchObject({ actorId: 'root' });
        expect(rec.endStatus.get(rec.spanOf('root') ?? '')).toBe('error');
        expect(rec.ended).not.toContain(rec.spanOf('kid'));
        expect(() => vi.runAllTimers()).toThrow('forged');
      });
    });

    it('reports a root error when the inspector is attached after start through system.inspect', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const machine = setup({
        actions: {
          boom: () => {
            throw new Error('late boom');
          },
        },
      }).createMachine({ initial: 'a', states: { a: { on: { GO: { target: 'b', actions: 'boom' } } }, b: {} } });
      const actor = createActor(machine, { id: 'late' }).start();
      actor.system.inspect(createTelemetryInspector({ dispatcher: rec.dispatcher }));
      actor.send({ type: 'GO' });
      await flush();

      expect(rec.events.map((e) => e.symbol)).toEqual(['GO']);
      expect(rec.errors).toHaveLength(1);
      expect(errorMessage(rec.errors[0]?.error)).toBe('late boom');
      expect(rec.errors[0]?.context).toMatchObject({ actorId: 'late', stateNode: 'a' });
      // The actor started before the inspector was attached, so it has no span.
      expect(rec.started).toEqual([]);
      // XState still reports the unhandled root error itself, once.
      expect(vi.getTimerCount()).toBe(1);
      expect(() => vi.runAllTimers()).toThrow('late boom');
    });
  });

  describe('actor context', () => {
    it('fills actorId and stateNode from the receiving actor', () => {
      const rec = recordingDispatcher();
      const machine = createMachine({
        initial: 'checkout',
        states: {
          checkout: {
            initial: 'payment',
            states: { payment: { on: { 'UI:CHECKOUT:PAY_BTN:CLICK': 'done' } }, done: {} },
          },
        },
      });
      const actor = createActor(machine, { id: 'auth', inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) });
      actor.start();
      actor.send({ type: 'UI:CHECKOUT:PAY_BTN:CLICK' });

      expect(rec.events[0]?.context).toMatchObject({ actorId: 'auth', stateNode: 'checkout.payment' });
    });

    it('keeps generated trace and session ids when getContext returns undefined fields', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const rec = recordingDispatcher();
      const machine = setup({
        actions: {
          boom: () => {
            throw new Error('late failure');
          },
        },
      }).createMachine({
        initial: 'a',
        states: { a: { on: { 'UI:A:B:C': 'b' } }, b: { on: { 'UI:A:B:D': { actions: 'boom' } } } },
      });
      const actor = createActor(machine, {
        inspect: createTelemetryInspector({
          dispatcher: rec.dispatcher,
          getContext: () => ({ traceId: undefined, sessionId: undefined }),
        }),
      }).start();
      actor.send({ type: 'UI:A:B:C' });
      actor.send({ type: 'UI:A:B:D' });
      await flush();
      vi.clearAllTimers();

      const [first, second] = rec.events;
      expect(first?.context.traceId).toMatch(TRACE_ID);
      expect(first?.context.sessionId).toBe('sess_anonymous');
      // Events and errors of one actor system share one trace.
      expect(second?.context.traceId).toBe(first?.context.traceId);
      expect(rec.errors[0]?.context.traceId).toBe(first?.context.traceId);
    });

    it('lets callers supply a trace id', () => {
      const rec = recordingDispatcher();
      const machine = createMachine({ initial: 'a', states: { a: {} } });
      const actor = createActor(machine, {
        inspect: createTelemetryInspector({ dispatcher: rec.dispatcher, getContext: () => ({ traceId: 'caller-trace' }) }),
      }).start();
      actor.send({ type: 'UI:A:B:C' });
      expect(rec.events[0]?.context.traceId).toBe('caller-trace');
    });

    it('never puts the raw identity userId into the context', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      setGlobalTelemetryIdentity({ userId: 'alice@example.com', tenantId: 't1' });
      const dpm = createDpmTelemetryAdapter({ tokenKey: 'k' });
      const rec = recordingDispatcher();
      const scope = { setTag: vi.fn(), setExtra: vi.fn() };
      const sentry = createSentryDispatcher({
        client: {
          addBreadcrumb: vi.fn(),
          setContext: vi.fn(),
          captureException: vi.fn(() => ''),
          withScope: (callback) => callback(scope),
        },
      });
      const machine = createMachine({
        initial: 'paying',
        states: {
          paying: {
            invoke: {
              id: 'pay',
              src: fromPromise(async () => {
                throw new Error('declined');
              }),
              onError: 'failed',
            },
            on: { 'FSM:AUTH:USER:CLICKED': {} },
          },
          failed: {},
        },
      });
      const inspect = createTelemetryInspector({
        dispatcher: createCompositeDispatcher(rec.dispatcher, sentry),
        dpmAdapter: dpm,
      });
      const actor = createActor(machine, { inspect }).start();
      actor.send({ type: 'FSM:AUTH:USER:CLICKED' });
      await flush();

      const expected = dpm.tokenize('user', 'alice@example.com');
      expect(expected).toMatch(/^dpm_tok_user_[a-f0-9]{32}$/);
      expect(rec.events[0]?.context).toMatchObject({ userId: expected, tenantId: 't1' });
      expect(rec.errors[0]?.context.userId).toBe(expected);
      expect(scope.setExtra).toHaveBeenCalledWith('telemetry_context', expect.objectContaining({ userId: expected }));
      expect(JSON.stringify([rec.events, rec.errors, scope.setExtra.mock.calls])).not.toContain('alice@example.com');
    });

    it('passes a server-issued pseudonymToken through unchanged', () => {
      setGlobalTelemetryIdentity({ userId: 'alice@example.com', pseudonymToken: 'srv_tok_1' });
      const rec = recordingDispatcher();
      const actor = createActor(createMachine({ initial: 'a', states: { a: {} } }), {
        inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }),
      }).start();
      actor.send({ type: 'UI:A:B:C' });
      expect(rec.events[0]?.context.userId).toBe('srv_tok_1');
    });

    it('gives a user the same token across event domains', () => {
      const domainRegistry = createSymbolRegistry();
      domainRegistry.registerBatch([
        { symbol: 'UI:CART:ITEM:ADD', description: 'add', piiLevel: 'pseudonymized' },
        { symbol: 'FSM:CHECKOUT:PAYMENT:APPROVED', description: 'paid', piiLevel: 'pseudonymized' },
      ]);
      const rec = recordingDispatcher();
      const machine = createMachine({
        initial: 'a',
        states: { a: { on: { 'UI:CART:ITEM:ADD': 'b' } }, b: { on: { 'FSM:CHECKOUT:PAYMENT:APPROVED': 'c' } }, c: {} },
      });
      const actor = createActor(machine, {
        inspect: createTelemetryInspector({ dispatcher: rec.dispatcher, registry: domainRegistry }),
      }).start();
      actor.send({ type: 'UI:CART:ITEM:ADD', payload: { userId: 'alice_123' } });
      actor.send({ type: 'FSM:CHECKOUT:PAYMENT:APPROVED', payload: { userId: 'alice_123' } });

      const [cart, checkout] = rec.events;
      expect(cart?.payload.userId).toMatch(/^dpm_tok_user_[a-f0-9]{32}$/);
      expect(checkout?.payload.userId).toBe(cart?.payload.userId);
    });
  });

  describe('actor spans', () => {
    function expectEachSpanEndedOnce(started: string[], ended: string[]) {
      expect(new Set(ended).size).toBe(ended.length);
      expect([...ended].sort()).toEqual([...started].sort());
    }

    it('ends every span exactly once when a state is re-entered while its invoke is pending', () => {
      const rec = recordingDispatcher();
      const machine = createMachine({
        initial: 'pending',
        states: {
          pending: {
            invoke: { id: 'paymentActor', src: fromPromise(() => new Promise<never>(() => {})) },
            on: { RETRY: { target: 'pending', reenter: true } },
          },
        },
      });
      const actor = createActor(machine, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) }).start();
      actor.send({ type: 'RETRY' });

      const childSpans = rec.started.filter((id) => id.startsWith('xstate.actor:paymentActor#'));
      expect(childSpans).toHaveLength(2);
      // The first child was stopped by the re-entry; the second is still running.
      expect(rec.ended).toEqual([childSpans[0]]);

      actor.stop();
      expectEachSpanEndedOnce(rec.started, rec.ended);
    });

    it('keeps spans of concurrent actors that share one inspector apart', async () => {
      const rec = recordingDispatcher();
      const inspect = createTelemetryInspector({ dispatcher: rec.dispatcher });
      const machine = createMachine({
        initial: 'pending',
        states: {
          pending: { invoke: { id: 'paymentActor', src: fromPromise(async () => 'ok'), onDone: 'done' } },
          done: { type: 'final' },
        },
      });
      createActor(machine, { inspect }).start();
      createActor(machine, { inspect }).start();
      await flush();

      expect(rec.started.filter((id) => id.startsWith('xstate.actor:paymentActor#'))).toHaveLength(2);
      expectEachSpanEndedOnce(rec.started, rec.ended);
    });

    it('records a failing actor\'s exception exactly once, on its own span', async () => {
      const { tracer, spans } = recordingTracer();
      const machine = createMachine({
        initial: 'pending',
        states: {
          pending: {
            invoke: {
              id: 'paymentActor',
              src: fromPromise(async () => {
                throw new Error('declined');
              }),
              onError: 'failed',
            },
          },
          failed: {},
        },
      });
      const inspect = createTelemetryInspector({ dispatcher: createOtelDispatcher({ tracer }) });
      createActor(machine, { inspect }).start();
      await flush();

      const paymentSpans = spans.filter((span) => span.name === 'xstate.actor:paymentActor');
      expect(paymentSpans).toHaveLength(1);
      expect(paymentSpans[0]?.setStatus.mock.calls).toEqual([[{ code: 2, message: 'declined' }]]);
      expect(paymentSpans[0]?.recordException).toHaveBeenCalledTimes(1);
      expect(paymentSpans[0]?.end).toHaveBeenCalledTimes(1);
    });

    it('keeps errors and events of concurrent actors that share an id on their own spans', async () => {
      const { tracer, spans } = recordingTracer();
      const inspect = createTelemetryInspector({ dispatcher: createOtelDispatcher({ tracer }) });
      const checkout = setup({ actors: { pay: fromPromise<string>(() => new Promise<never>(() => {})) } }).createMachine({
        initial: 'paying',
        states: {
          paying: {
            invoke: { id: 'paymentActor', src: 'pay', onError: 'failed' },
            on: { 'UI:CHECKOUT:PAY_BTN:CLICK': {} },
          },
          failed: {},
        },
      });
      const failing = checkout.provide({
        actors: {
          pay: fromPromise<string>(async () => {
            throw new Error('declined');
          }),
        },
      });
      // Two requests: both roots are `checkout` and both invoke `paymentActor`.
      const first = createActor(failing, { id: 'checkout', inspect }).start();
      const second = createActor(checkout, { id: 'checkout', inspect }).start();
      first.send({ type: 'UI:CHECKOUT:PAY_BTN:CLICK' });
      second.send({ type: 'UI:CHECKOUT:PAY_BTN:CLICK' });
      await flush();

      const [firstPayment, secondPayment] = spans.filter((span) => span.name === 'xstate.actor:paymentActor');
      const [firstRoot, secondRoot] = spans.filter((span) => span.name === 'xstate.actor:checkout');
      // The first request's payment failed; the second's is still in flight and untouched.
      expect(firstPayment?.recordException).toHaveBeenCalledTimes(1);
      expect(secondPayment?.setStatus).not.toHaveBeenCalled();
      expect(secondPayment?.recordException).not.toHaveBeenCalled();
      expect(secondPayment?.end).not.toHaveBeenCalled();
      // Each root's event lands on that root's own span.
      expect(firstRoot?.addEvent).toHaveBeenCalledTimes(1);
      expect(secondRoot?.addEvent).toHaveBeenCalledTimes(1);
      expect(firstRoot?.attributes['xstate.actor.session_id']).toBe(first.sessionId);
    });

    it('opens no span for an actor that is never started', () => {
      const rec = recordingDispatcher();
      const machine = createMachine({
        initial: 'a',
        states: {
          a: { always: 'b', invoke: { id: 'transient', src: fromPromise(async () => 'x') } },
          b: {},
        },
      });
      const actor = createActor(machine, { inspect: createTelemetryInspector({ dispatcher: rec.dispatcher }) }).start();
      actor.stop();

      expect(rec.started.some((id) => id.startsWith('xstate.actor:transient#'))).toBe(false);
      expectEachSpanEndedOnce(rec.started, rec.ended);
    });
  });
});
