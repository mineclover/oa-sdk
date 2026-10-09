import type { TelemetryDispatcher } from './types.js';
import type { TelemetryEnvelope } from '../envelope/types.js';
import type { SymbolDefinition } from '../symbols/types.js';

export interface GtmDispatcherOptions {
  dataLayer?: any[];
  whitelistOnly?: boolean;
}

export function createGtmDispatcher(options: GtmDispatcherOptions = {}): TelemetryDispatcher {
  const whitelistOnly = options.whitelistOnly ?? true;

  function getDataLayer(): any[] | undefined {
    if (options.dataLayer) return options.dataLayer;
    const globalObj = typeof globalThis !== 'undefined' ? (globalThis as any) : undefined;
    if (globalObj) {
      if (globalObj.dataLayer) return globalObj.dataLayer;
      if (globalObj.window) {
        globalObj.window.dataLayer = globalObj.window.dataLayer || [];
        return globalObj.window.dataLayer;
      }
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

      dataLayer.push({
        event: eventName,
        track_symbol: envelope.symbol,
        trace_id: envelope.context.traceId,
        actor_id: envelope.context.actorId,
        state_node: envelope.context.stateNode,
        ...envelope.payload,
      });
    },
  };
}
