import { describe, expect, it, vi } from 'vitest';
import { setup, createActor, fromPromise } from 'xstate';
import { createTelemetryInspector } from '../src/xstate/inspector.js';
import { createSymbolRegistry } from '../src/symbols/registry.js';
import { createGtmDispatcher } from '../src/dispatcher/gtm.js';
import { createSentryDispatcher } from '../src/dispatcher/sentry.js';
import { createCompositeDispatcher } from '../src/dispatcher/composite.js';
import { createDpmTelemetryAdapter } from '../src/dpm/adapter.js';

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

  it('captures machine events and dispatches to GTM & Sentry with DPM pseudonymization', () => {
    const dataLayer: any[] = [];
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
    expect(dataLayer[0].event).toBe('login_attempt');
    expect(dataLayer[0].password).toBe('***MASKED***');
    expect(dataLayer[0].userId).toMatch(/^dpm_tok_auth_[a-f0-9]{8}$/);

    // Sentry 검증: Breadcrumb 기록 및 actor context 갱신
    expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'FSM:AUTH:USER:LOGIN_SUBMITTED',
        level: 'info',
        data: expect.objectContaining({
          password: '***MASKED***',
        }),
      }),
    );
  });

  it('captures async actor lifecycle and error states', async () => {
    const mockDispatcher = {
      name: 'mock',
      dispatch: vi.fn(),
      dispatchError: vi.fn(),
      dispatchSpanStart: vi.fn().mockReturnValue('span_1'),
      dispatchSpanEnd: vi.fn(),
    };

    const inspector = createTelemetryInspector({
      dispatcher: mockDispatcher,
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
    expect(mockDispatcher.dispatchSpanStart).toHaveBeenCalledWith(
      'xstate.actor:paymentActor',
      expect.any(Object),
    );

    // Promise 완료 대기
    await new Promise((r) => setTimeout(r, 50));

    // 에러 발생으로 인해 spanEnd가 error로 호출되었는지 검증
    expect(mockDispatcher.dispatchSpanEnd).toHaveBeenCalledWith(
      'span_1',
      'error',
      expect.any(Error),
    );
  });
});
