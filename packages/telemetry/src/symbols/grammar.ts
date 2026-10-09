import type { ParsedTrackSymbol, SymbolLayer } from './types.js';

export const TRACK_SYMBOL_REGEX = /^(UI|FSM|TX|SYS):([A-Z0-9_]+):([A-Z0-9_]+):([A-Z0-9_]+)(?::([A-Z0-9_]+))?$/;

/**
 * 추적 심볼 문자열의 유효성을 검증합니다.
 */
export function isValidTrackSymbol(symbol: string): boolean {
  return TRACK_SYMBOL_REGEX.test(symbol);
}

/**
 * 표준 형식의 추적 심볼 문자열을 구성 요소로 파싱합니다.
 * 유효하지 않은 형식일 경우 에러를 던집니다.
 */
export function parseTrackSymbol(symbol: string): ParsedTrackSymbol {
  const match = TRACK_SYMBOL_REGEX.exec(symbol);
  if (!match) {
    throw new Error(
      `[Telemetry] Invalid track symbol format: "${symbol}". Must match "[Layer]:[Domain]:[Entity]:[Action](:[Aspect])" where Layer is UI|FSM|TX|SYS.`,
    );
  }

  const [, layer, domain, entity, action, aspect] = match;

  const parsed: ParsedTrackSymbol = {
    layer: layer as SymbolLayer,
    domain: domain!,
    entity: entity!,
    action: action!,
    raw: symbol,
  };

  if (aspect) {
    parsed.aspect = aspect;
  }

  return parsed;
}

/**
 * 파싱된 각 요소를 표준 추적 심볼 문자열로 결합합니다.
 */
export function formatTrackSymbol(parts: {
  layer: SymbolLayer;
  domain: string;
  entity: string;
  action: string;
  aspect?: string;
}): string {
  const base = `${parts.layer}:${parts.domain.toUpperCase()}:${parts.entity.toUpperCase()}:${parts.action.toUpperCase()}`;
  return parts.aspect ? `${base}:${parts.aspect.toUpperCase()}` : base;
}
