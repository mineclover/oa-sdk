import type { TelemetryDispatcher } from './types.js';
import type { TelemetryContext, TelemetryEnvelope } from '../envelope/types.js';
import type { SymbolDefinition } from '../symbols/types.js';

export interface SentryLikeClient {
  addBreadcrumb(breadcrumb: {
    category?: string;
    message?: string;
    data?: Record<string, unknown>;
    level?: string;
  }): void;
  setContext(name: string, context: Record<string, unknown> | null): void;
  captureException(exception: unknown, hint?: any): string;
  withScope?(callback: (scope: any) => void): void;
}

export interface SentryDispatcherOptions {
  client?: SentryLikeClient;
}

export function createSentryDispatcher(options: SentryDispatcherOptions = {}): TelemetryDispatcher {
  function getClient(): SentryLikeClient | undefined {
    if (options.client) return options.client;
    if (typeof globalThis !== 'undefined' && (globalThis as any).Sentry) {
      return (globalThis as any).Sentry;
    }
    return undefined;
  }

  return {
    name: 'sentry',
    dispatch(envelope: TelemetryEnvelope, symbolDef?: SymbolDefinition) {
      const client = getClient();
      if (!client) return;

      const sentryConfig = symbolDef?.routing?.sentry;
      const shouldRecordBreadcrumb = sentryConfig?.asBreadcrumb ?? true;

      if (shouldRecordBreadcrumb) {
        const parts = envelope.symbol.split(':');
        const category = parts[1] ? `xstate.${parts[1].toLowerCase()}` : 'xstate';

        client.addBreadcrumb({
          category,
          message: envelope.symbol,
          data: {
            actorId: envelope.context.actorId,
            stateNode: envelope.context.stateNode,
            traceId: envelope.context.traceId,
            ...envelope.payload,
          },
          level: sentryConfig?.level || 'info',
        });
      }

      // XState Context 갱신
      if (envelope.context.actorId) {
        client.setContext(`xstate:${envelope.context.actorId}`, {
          stateNode: envelope.context.stateNode,
          traceId: envelope.context.traceId,
          lastSymbol: envelope.symbol,
        });
      }
    },

    dispatchError(error: unknown, context: TelemetryContext, stateNode?: string) {
      const client = getClient();
      if (!client) return;

      if (typeof client.withScope === 'function') {
        client.withScope((scope: any) => {
          if (stateNode) scope.setTag('xstate.state_node', stateNode);
          if (context.actorId) scope.setTag('xstate.actor_id', context.actorId);
          if (context.traceId) scope.setTag('trace_id', context.traceId);
          scope.setExtra('telemetry_context', context);
          client.captureException(error);
        });
      } else {
        client.captureException(error);
      }
    },
  };
}
