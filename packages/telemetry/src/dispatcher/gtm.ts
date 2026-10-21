import type { TelemetryDispatcher } from './types.js';
import type { TelemetryEnvelope } from '../envelope/types.js';
import type { SymbolDefinition } from '../symbols/types.js';

/** Anything with a GTM-style `push` (a plain array or GTM's patched `dataLayer`). */
export interface GtmDataLayerLike {
  push(...items: Record<string, unknown>[]): unknown;
}

export interface GtmDispatcherOptions {
  dataLayer?: GtmDataLayerLike;
  whitelistOnly?: boolean;
}

function isDataLayerLike(value: unknown): value is GtmDataLayerLike {
  return typeof value === 'object' && value !== null && 'push' in value && typeof value.push === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createGtmDispatcher(options: GtmDispatcherOptions = {}): TelemetryDispatcher {
  const whitelistOnly = options.whitelistOnly ?? true;

  function getDataLayer(): GtmDataLayerLike | undefined {
    if (options.dataLayer) return options.dataLayer;
    const globalObj: unknown = globalThis;
    if (!isRecord(globalObj)) return undefined;
    if (isDataLayerLike(globalObj.dataLayer)) return globalObj.dataLayer;
    const win = globalObj.window;
    if (isRecord(win)) {
      if (!isDataLayerLike(win.dataLayer)) {
        const created: Record<string, unknown>[] = [];
        win.dataLayer = created;
        return created;
      }
      return win.dataLayer;
    }
    return undefined;
  }

  return {
    name: 'gtm',
    dispatch(envelope: TelemetryEnvelope, symbolDef?: SymbolDefinition) {
      const dataLayer = getDataLayer();
      if (!dataLayer) return;

      const gtmConfig = symbolDef?.routing?.gtm;
      if (whitelistOnly && !gtmConfig) {
        return; // 화이트리스트 외 이벤트 스킵
      }

      const eventName =
        gtmConfig?.eventName ||
        envelope.symbol
          .toLowerCase()
          .replace(/^ui:|^fsm:|^tx:|^sys:/, '')
          .replace(/[:.]/g, '_');

      // Reserved keys are written after the payload so a payload field such as `event`
      // or `track_symbol` can never replace the registered GA4 event name or the symbol.
      dataLayer.push({
        ...envelope.payload,
        event: eventName,
        track_symbol: envelope.symbol,
        trace_id: envelope.context.traceId,
        actor_id: envelope.context.actorId,
        state_node: envelope.context.stateNode,
      });
    },
  };
}
