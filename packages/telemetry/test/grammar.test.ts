import { describe, expect, it } from 'vitest';
import { formatTrackSymbol, isValidTrackSymbol, parseTrackSymbol } from '../src/symbols/grammar.js';

describe('TrackSymbol Grammar', () => {
  it('validates correct track symbols', () => {
    expect(isValidTrackSymbol('UI:AUTH:SIGN_IN_BTN:CLICK')).toBe(true);
    expect(isValidTrackSymbol('FSM:CHECKOUT:PAYMENT:APPROVED')).toBe(true);
    expect(isValidTrackSymbol('TX:ORDER:PG_APPROVAL:EXECUTE:SUCCESS')).toBe(true);
    expect(isValidTrackSymbol('SYS:MONITOR:HEALTH_CHECK:PING')).toBe(true);
  });

  it('rejects invalid track symbols', () => {
    expect(isValidTrackSymbol('INVALID_SYMBOL')).toBe(false);
    expect(isValidTrackSymbol('UNKNOWN:AUTH:USER:LOGIN')).toBe(false); // Layer mismatch
    expect(isValidTrackSymbol('ui:auth:btn:click')).toBe(false); // lower case
    expect(isValidTrackSymbol('UI:AUTH')).toBe(false); // incomplete
  });

  it('parses valid symbols correctly', () => {
    const parsed = parseTrackSymbol('FSM:CHECKOUT:PAYMENT:APPROVED:ASYNC');
    expect(parsed).toEqual({
      layer: 'FSM',
      domain: 'CHECKOUT',
      entity: 'PAYMENT',
      action: 'APPROVED',
      aspect: 'ASYNC',
      raw: 'FSM:CHECKOUT:PAYMENT:APPROVED:ASYNC',
    });
  });

  it('throws on parsing invalid symbol', () => {
    expect(() => parseTrackSymbol('NOT_A_SYMBOL')).toThrow(/Invalid track symbol format/);
  });

  it('formats symbol parts into standard string', () => {
    const formatted = formatTrackSymbol({
      layer: 'UI',
      domain: 'cart',
      entity: 'item',
      action: 'remove',
      aspect: 'modal',
    });
    expect(formatted).toBe('UI:CART:ITEM:REMOVE:MODAL');
  });
});
