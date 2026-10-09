import type { SymbolRegistry } from '../symbols/registry.js';
import { isValidTrackSymbol, parseTrackSymbol } from '../symbols/grammar.js';
import type { TelemetryDispatcher } from '../dispatcher/types.js';
import type { DpmTelemetryAdapter } from '../dpm/types.js';
import { createDpmTelemetryAdapter } from '../dpm/adapter.js';
import { createTelemetryEnvelope } from '../envelope/builder.js';
import type { TelemetryContext } from '../envelope/types.js';
import { getGlobalTelemetryIdentity } from '../identity/identity.js';

export interface XStateInspectorOptions {
  dispatcher: TelemetryDispatcher;
  registry?: SymbolRegistry;
  dpmAdapter?: DpmTelemetryAdapter;
  getContext?: () => Partial<TelemetryContext>;
  strictSymbols?: boolean;
}

export interface ActorRefLike {
  id: string;
  subscribe?: (observer: {
    next?: (value: any) => void;
    error?: (err: any) => void;
    complete?: () => void;
  }) => { unsubscribe: () => void };
}

export interface SnapshotLike {
  status?: string;
  value: any;
  context?: any;
  error?: any;
}

export type InspectionEventLike =
  | {
      type: '@xstate.actor';
      actorRef: ActorRefLike;
    }
  | {
      type: '@xstate.event';
      event: { type: string; payload?: any; [key: string]: any };
      sourceActor?: ActorRefLike;
      targetActor?: ActorRefLike;
    }
  | {
      type: '@xstate.snapshot';
      actorRef: ActorRefLike;
      snapshot: SnapshotLike;
      event: { type: string; [key: string]: any };
    };

export function createTelemetryInspector(options: XStateInspectorOptions) {
  const { dispatcher, registry, strictSymbols = false } = options;
  const dpm = options.dpmAdapter || createDpmTelemetryAdapter();
  const actorSpans = new Map<string, string>();

  function resolveStateNodeSymbol(value: any): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value);
      const firstKey = keys[0];
      if (firstKey !== undefined) {
        return `${firstKey}.${resolveStateNodeSymbol(value[firstKey])}`;
      }
    }
    return undefined;
  }

  return (inspectionEvent: InspectionEventLike) => {
    const identity = getGlobalTelemetryIdentity();
    const callerContext = options.getContext ? options.getContext() : {};

    const baseContext: Partial<TelemetryContext> = {
      userId: identity?.pseudonymToken || identity?.userId,
      tenantId: identity?.tenantId,
      ...callerContext,
    };

    switch (inspectionEvent.type) {
      // 1. 이벤트 수신 시점
      case '@xstate.event': {
        const { event, targetActor } = inspectionEvent;
        const eventType = event.type;

        // XState 내부 이벤트는 무시
        if (eventType.startsWith('xstate.')) return;

        // 심볼 조회 및 검증
        let symbolDef = registry?.get(eventType);
        let domain = 'GLOBAL';

        if (isValidTrackSymbol(eventType)) {
          const parsed = parseTrackSymbol(eventType);
          domain = parsed.domain;
        } else if (strictSymbols && !symbolDef) {
          throw new Error(`[Telemetry] Event type "${eventType}" is not a valid tracking symbol or registered symbol.`);
        }

        // 페이로드 추출 (event.payload 또는 event 자체의 비예약 필드들)
        const rawPayload: Record<string, any> =
          event.payload && typeof event.payload === 'object'
            ? { ...event.payload }
            : Object.fromEntries(Object.entries(event).filter(([k]) => k !== 'type'));

        // DPM 살균 및 가명화/마스킹 처리
        const sanitizedPayload = dpm.sanitize(rawPayload, symbolDef?.piiLevel, domain);
        if (sanitizedPayload === null) {
          // PII restricted 레벨로 인해 전체 드롭
          return;
        }

        // 엔벨로프 합성
        const envelope = createTelemetryEnvelope({
          symbol: eventType,
          payload: sanitizedPayload,
          context: {
            actorId: targetActor?.id,
            ...baseContext,
          },
        });

        // 디스패치
        dispatcher.dispatch(envelope, symbolDef);
        break;
      }

      // 2. 상태 전이 완료 및 스냅샷 변경 시점
      case '@xstate.snapshot': {
        const { actorRef, snapshot } = inspectionEvent;
        const stateNode = resolveStateNodeSymbol(snapshot.value);

        // 에러 상태 진입 시 Sentry / OTel 에러 디스패치
        if (snapshot.status === 'error' && snapshot.error) {
          if (dispatcher.dispatchError) {
            dispatcher.dispatchError(
              snapshot.error,
              {
                traceId: baseContext.traceId || 'trace_unknown',
                actorId: actorRef.id,
                stateNode,
                ...baseContext,
              },
              stateNode,
            );
          }
        }
        break;
      }

      // 3. 비동기 액터(Promise/Worker/Child) 생명주기
      case '@xstate.actor': {
        const { actorRef } = inspectionEvent;
        const actorId = actorRef.id;

        if (dispatcher.dispatchSpanStart) {
          const spanId = dispatcher.dispatchSpanStart(`xstate.actor:${actorId}`, {
            'xstate.actor.id': actorId,
          });
          if (spanId && typeof spanId === 'string') {
            actorSpans.set(actorId, spanId);
          }
        }

        if (actorRef.subscribe) {
          actorRef.subscribe({
            complete: () => {
              const spanId = actorSpans.get(actorId);
              if (spanId && dispatcher.dispatchSpanEnd) {
                dispatcher.dispatchSpanEnd(spanId, 'ok');
                actorSpans.delete(actorId);
              }
            },
            error: (err: any) => {
              const spanId = actorSpans.get(actorId);
              if (spanId && dispatcher.dispatchSpanEnd) {
                dispatcher.dispatchSpanEnd(spanId, 'error', err);
                actorSpans.delete(actorId);
              }
            },
          });
        }
        break;
      }
    }
  };
}
