import { parseTrackSymbol } from './grammar.js';
import type { SymbolDefinition } from './types.js';

export interface SymbolRegistryOptions {
  /**
   * strict 모드: true일 경우 미등록 심볼 요청이나 유효하지 않은 심볼 등록 시 예외를 던집니다.
   * 기본값은 true (닫힌 레지스트리 원칙)
   */
  strict?: boolean;
}

export class SymbolRegistry {
  private readonly definitions = new Map<string, SymbolDefinition>();
  private readonly strict: boolean;

  constructor(options: SymbolRegistryOptions = {}) {
    this.strict = options.strict ?? true;
  }

  /**
   * 단일 심볼 정의를 레지스트리에 등록합니다.
   */
  register(definition: SymbolDefinition): this {
    // 문법 유효성 검증
    parseTrackSymbol(definition.symbol);

    if (this.definitions.has(definition.symbol)) {
      throw new Error(`[Telemetry] Symbol already registered: "${definition.symbol}"`);
    }

    this.definitions.set(definition.symbol, definition);
    return this;
  }

  /**
   * 복수 심볼 정의를 일괄 등록합니다.
   */
  registerBatch(definitions: SymbolDefinition[]): this {
    for (const def of definitions) {
      this.register(def);
    }
    return this;
  }

  /**
   * 심볼 정의를 조회합니다.
   */
  get(symbol: string): SymbolDefinition | undefined {
    const def = this.definitions.get(symbol);
    if (!def && this.strict) {
      throw new Error(`[Telemetry] Unregistered symbol: "${symbol}". All tracking symbols must be pre-registered.`);
    }
    return def;
  }

  /**
   * 심볼 등록 여부를 확인합니다.
   */
  has(symbol: string): boolean {
    return this.definitions.has(symbol);
  }

  /**
   * 등록된 모든 심볼 정의 목록을 반환합니다.
   */
  list(): SymbolDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * 레지스트리를 초기화합니다.
   */
  clear(): void {
    this.definitions.clear();
  }
}

export function createSymbolRegistry(options?: SymbolRegistryOptions): SymbolRegistry {
  return new SymbolRegistry(options);
}
