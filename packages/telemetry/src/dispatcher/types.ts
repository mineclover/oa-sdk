import type { TelemetryContext, TelemetryEnvelope } from '../envelope/types.js';
import type { SymbolDefinition } from '../symbols/types.js';

export interface TelemetryDispatcher {
  name: string;
  dispatch(envelope: TelemetryEnvelope, symbolDef?: SymbolDefinition): void;
  dispatchError?(error: unknown, context: TelemetryContext, stateNode?: string): void;
  dispatchSpanStart?(spanName: string, attributes?: Record<string, unknown>): string | void;
  dispatchSpanEnd?(spanId: string, status?: 'ok' | 'error', error?: unknown): void;
}
