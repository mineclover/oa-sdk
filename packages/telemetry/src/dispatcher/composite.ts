import type { TelemetryDispatcher } from './types.js';
import type { TelemetryContext, TelemetryEnvelope } from '../envelope/types.js';
import type { SymbolDefinition } from '../symbols/types.js';

export function createCompositeDispatcher(...dispatchers: TelemetryDispatcher[]): TelemetryDispatcher {
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
      for (const dispatcher of dispatchers) {
        if (dispatcher.dispatchSpanStart) {
          const res = dispatcher.dispatchSpanStart(spanName, attributes);
          if (res) return res;
        }
      }
    },

    dispatchSpanEnd(spanId: string, status?: 'ok' | 'error', error?: unknown) {
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
