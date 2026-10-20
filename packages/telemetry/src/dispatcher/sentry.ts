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
  captureException(exception: unknown, hint?: unknown): string;
  withScope?(callback: (scope: SentryLikeScope) => void): unknown;
}

/** The subset of a Sentry `Scope` the dispatcher uses. */
export interface SentryLikeScope {
  setTag(key: string, value: string): unknown;
  setExtra(key: string, extra: unknown): unknown;
}

function isSentryLikeClient(value: unknown): value is SentryLikeClient {
  return (
    typeof value === 'object' &&
    value !== null &&
    'addBreadcrumb' in value &&
    typeof value.addBreadcrumb === 'function' &&
    'setContext' in value &&
    typeof value.setContext === 'function' &&
    'captureException' in value &&
    typeof value.captureException === 'function'
  );
}

export interface SentryDispatcherOptions {
  client?: SentryLikeClient;
}

export function createSentryDispatcher(options: SentryDispatcherOptions = {}): TelemetryDispatcher {
  function getClient(): SentryLikeClient | undefined {
    if (options.client) return options.client;
    const globalSentry: unknown = (globalThis as { Sentry?: unknown }).Sentry;
    return isSentryLikeClient(globalSentry) ? globalSentry : undefined;
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
          // Context keys are written after the payload so payload fields cannot spoof them.
          data: {
            ...envelope.payload,
            actorId: envelope.context.actorId,
            stateNode: envelope.context.stateNode,
            traceId: envelope.context.traceId,
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
        client.withScope((scope) => {
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
