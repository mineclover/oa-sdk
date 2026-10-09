import type { TelemetryDispatcher } from './types.js';
import type { TelemetryContext, TelemetryEnvelope } from '../envelope/types.js';
import type { SymbolDefinition } from '../symbols/types.js';

export interface OtelLikeSpan {
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException?(error: unknown): void;
  end(): void;
}

export interface OtelLikeTracer {
  startSpan(name: string, options?: { attributes?: Record<string, unknown> | undefined }): OtelLikeSpan;
  getActiveSpan?(): OtelLikeSpan | undefined;
}

export interface OtelDispatcherOptions {
  tracer?: OtelLikeTracer;
}

export function createOtelDispatcher(options: OtelDispatcherOptions = {}): TelemetryDispatcher {
  const activeSpans = new Map<string, OtelLikeSpan>();

  function getTracer(): OtelLikeTracer | undefined {
    return options.tracer;
  }

  return {
    name: 'otel',
    dispatch(envelope: TelemetryEnvelope, _symbolDef?: SymbolDefinition) {
      const tracer = getTracer();
      const activeSpan = tracer?.getActiveSpan ? tracer.getActiveSpan() : undefined;

      if (activeSpan) {
        activeSpan.addEvent(envelope.symbol, {
          'xstate.actor_id': envelope.context.actorId,
          'xstate.state_node': envelope.context.stateNode,
          'trace.id': envelope.context.traceId,
        });
      }
    },

    dispatchSpanStart(spanName: string, attributes?: Record<string, unknown>): string | void {
      const tracer = getTracer();
      if (!tracer) return;

      const spanId = `span_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const span = attributes ? tracer.startSpan(spanName, { attributes }) : tracer.startSpan(spanName);
      activeSpans.set(spanId, span);
      return spanId;
    },

    dispatchSpanEnd(spanId: string, status: 'ok' | 'error' = 'ok', error?: unknown) {
      const span = activeSpans.get(spanId);
      if (!span) return;

      if (status === 'error') {
        span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
        if (span.recordException && error) {
          span.recordException(error);
        }
      } else {
        span.setStatus({ code: 1 });
      }

      span.end();
      activeSpans.delete(spanId);
    },

    dispatchError(error: unknown, _context: TelemetryContext, stateNode?: string) {
      const tracer = getTracer();
      const activeSpan = tracer?.getActiveSpan ? tracer.getActiveSpan() : undefined;
      if (activeSpan) {
        activeSpan.setStatus({
          code: 2,
          message: error instanceof Error ? error.message : String(error),
        });
        if (activeSpan.recordException && error) {
          activeSpan.recordException(error);
        }
        activeSpan.addEvent('error', {
          'xstate.state_node': stateNode,
        });
      }
    },
  };
}
