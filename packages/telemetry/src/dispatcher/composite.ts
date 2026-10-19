import type { TelemetryDispatcher } from './types.js';
import type { TelemetryContext, TelemetryEnvelope } from '../envelope/types.js';
import type { SymbolDefinition } from '../symbols/types.js';

interface ChildSpan {
  dispatcher: TelemetryDispatcher;
  spanId: string;
}

/**
 * Broadcasts every call to all child dispatchers. A failing child never stops the
 * others: each call is isolated. Spans are fanned out too: `dispatchSpanStart` starts a
 * span on every span-capable child and returns one composite id, and
 * `dispatchSpanEnd(compositeId)` ends each child's own span.
 */
export function createCompositeDispatcher(...dispatchers: TelemetryDispatcher[]): TelemetryDispatcher {
  const compositeSpans = new Map<string, ChildSpan[]>();
  let spanCounter = 0;

  return {
    name: 'composite',
    dispatch(envelope: TelemetryEnvelope, symbolDef?: SymbolDefinition) {
      for (const dispatcher of dispatchers) {
        try {
          dispatcher.dispatch(envelope, symbolDef);
        } catch {
          // 개별 디스패처 실패가 전체 파이프라인을 중단시키지 않음
        }
      }
    },

    dispatchError(error: unknown, context: TelemetryContext, stateNode?: string) {
      for (const dispatcher of dispatchers) {
        if (dispatcher.dispatchError) {
          try {
            dispatcher.dispatchError(error, context, stateNode);
          } catch {
            // 실패 격리
          }
        }
      }
    },

    dispatchSpanStart(spanName: string, attributes?: Record<string, unknown>): string | void {
      const children: ChildSpan[] = [];
      for (const dispatcher of dispatchers) {
        if (!dispatcher.dispatchSpanStart) continue;
        try {
          const spanId = dispatcher.dispatchSpanStart(spanName, attributes);
          if (typeof spanId === 'string' && spanId) {
            children.push({ dispatcher, spanId });
          }
        } catch {
          // 실패 격리: 다른 디스패처의 Span은 계속 시작
        }
      }
      if (children.length === 0) return undefined;

      spanCounter += 1;
      const compositeId = `cspan_${spanCounter}`;
      compositeSpans.set(compositeId, children);
      return compositeId;
    },

    dispatchSpanEnd(spanId: string, status?: 'ok' | 'error', error?: unknown) {
      const children = compositeSpans.get(spanId);
      if (children) {
        compositeSpans.delete(spanId);
        for (const child of children) {
          try {
            child.dispatcher.dispatchSpanEnd?.(child.spanId, status, error);
          } catch {
            // 실패 격리
          }
        }
        return;
      }

      // An id this composite did not issue: let every child try to end it.
      for (const dispatcher of dispatchers) {
        if (dispatcher.dispatchSpanEnd) {
          try {
            dispatcher.dispatchSpanEnd(spanId, status, error);
          } catch {
            // 실패 격리
          }
        }
      }
    },
  };
}
