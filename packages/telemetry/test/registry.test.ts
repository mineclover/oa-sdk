import { describe, expect, it } from 'vitest';
import { createSymbolRegistry } from '../src/symbols/registry.js';
import { SymbolDefinition } from '../src/symbols/types.js';

describe('SymbolRegistry', () => {
  const sampleDef: SymbolDefinition = {
    symbol: 'FSM:AUTH:USER:LOGIN_SUBMITTED',
    description: 'User submitted login form',
    piiLevel: 'masked',
    kpiDimension: 'activation',
    routing: {
      gtm: { eventName: 'login_attempt' },
      sentry: { level: 'info', asBreadcrumb: true },
    },
  };

  it('registers and retrieves symbol definitions', () => {
    const registry = createSymbolRegistry();
    registry.register(sampleDef);

    expect(registry.has('FSM:AUTH:USER:LOGIN_SUBMITTED')).toBe(true);
    expect(registry.get('FSM:AUTH:USER:LOGIN_SUBMITTED')).toEqual(sampleDef);
  });

  it('throws on duplicate registration', () => {
    const registry = createSymbolRegistry();
    registry.register(sampleDef);

    expect(() => registry.register(sampleDef)).toThrow(/already registered/);
  });

  it('throws in strict mode when symbol is not registered', () => {
    const registry = createSymbolRegistry({ strict: true });
    expect(() => registry.get('FSM:UNKNOWN:ENTITY:ACTION')).toThrow(/Unregistered symbol/);
  });

  it('returns undefined in non-strict mode when symbol is not registered', () => {
    const registry = createSymbolRegistry({ strict: false });
    expect(registry.get('FSM:UNKNOWN:ENTITY:ACTION')).toBeUndefined();
  });
});
