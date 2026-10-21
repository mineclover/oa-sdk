import type { PiiLevel } from '../symbols/types.js';
import type { DpmTelemetryAdapter, DpmTelemetryAdapterOptions } from './types.js';
import { createHmacSha256, toHex, utf8Encode } from './hmac-sha256.js';

/** Keys masked at every PII level (normalized: lower case, no `-`/`_`; substring match). */
export const DEFAULT_SENSITIVE_KEYS: readonly string[] = Object.freeze([
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'apikey',
  'creditcard',
  'cardnumber',
  'cvc',
  'ssn',
  'authorization',
  'authtoken',
]);

/**
 * Identifier keys protected under `masked` / `pseudonymized`, mapped to the entity
 * namespace of their tokens (normalized patterns; substring match, longest wins).
 */
export const DEFAULT_PII_KEYS: Readonly<Record<string, string>> = Object.freeze({
  userid: 'user',
  customerid: 'customer',
  orderid: 'order',
  accountid: 'account',
  email: 'email',
  phone: 'phone',
});

/** Raised when the adapter cannot produce safe output for its configuration. */
export class TelemetryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelemetryConfigError';
  }
}

const MASKED_VALUE = '***MASKED***';
const MAX_SANITIZE_DEPTH = 10;
/** Token length: 128 bits of the HMAC-SHA-256 output. */
const TOKEN_HEX_LENGTH = 32;
const EPHEMERAL_KEY_BYTES = 32;

type Mac = (message: Uint8Array) => Uint8Array;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describeObject(value: object): string {
  const ctor: unknown = value.constructor;
  const name = typeof ctor === 'function' && ctor.name ? ctor.name : 'Object';
  return `[${name}]`;
}

/** Assigns an own enumerable property, including a literal `__proto__` key. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    target[key] = value;
  }
}

function resolveKeyBytes(tokenKey: string | Uint8Array): Uint8Array {
  const bytes = typeof tokenKey === 'string' ? utf8Encode(tokenKey) : tokenKey;
  if (bytes.length === 0) {
    throw new TelemetryConfigError('[Telemetry] DPM tokenKey must not be empty.');
  }
  return bytes;
}

function generateEphemeralKey(): Uint8Array {
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: unknown } }).crypto;
  const getRandomValues = webCrypto?.getRandomValues;
  if (typeof getRandomValues !== 'function') {
    throw new TelemetryConfigError(
      '[Telemetry] Pseudonymization needs a tokenKey or customTokenizer: this runtime has no crypto.getRandomValues to generate one.',
    );
  }
  const key = new Uint8Array(EPHEMERAL_KEY_BYTES);
  getRandomValues.call(webCrypto, key);
  return key;
}

export function createDpmTelemetryAdapter(options: DpmTelemetryAdapterOptions = {}): DpmTelemetryAdapter {
  const sensitiveKeys = (options.sensitiveKeys ?? DEFAULT_SENSITIVE_KEYS)
    .map(normalizeKey)
    .filter((key) => key.length > 0);
  const piiKeyPatterns = Object.entries(options.piiKeys ?? DEFAULT_PII_KEYS)
    .map(([pattern, namespace]): [string, string] => [normalizeKey(pattern), namespace])
    .filter(([pattern]) => pattern.length > 0)
    .sort(([a], [b]) => b.length - a.length);

  // An explicit key is validated eagerly; without one, a random key is drawn on first use.
  let mac: Mac | undefined =
    options.tokenKey !== undefined ? createHmacSha256(resolveKeyBytes(options.tokenKey)) : undefined;

  function keyedMac(): Mac {
    mac ??= createHmacSha256(generateEphemeralKey());
    return mac;
  }

  function tokenize(namespace: string, value: string): string {
    if (options.customTokenizer) {
      return options.customTokenizer(namespace, value);
    }
    // Length-prefixing the namespace keeps (namespace, value) pairs unambiguous.
    const digest = keyedMac()(utf8Encode(`${namespace.length}:${namespace}:${value}`));
    const cleanNs = namespace.toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `dpm_tok_${cleanNs}_${toHex(digest).slice(0, TOKEN_HEX_LENGTH)}`;
  }

  function isSensitive(key: string): boolean {
    const normalized = normalizeKey(key);
    return sensitiveKeys.some((s) => normalized.includes(s));
  }

  function piiNamespaceOf(key: string): string | undefined {
    const normalized = normalizeKey(key);
    return piiKeyPatterns.find(([pattern]) => normalized.includes(pattern))?.[1];
  }

  function protect(value: string, piiLevel: PiiLevel, namespace: string): string {
    return piiLevel === 'pseudonymized' ? tokenize(namespace, value) : MASKED_VALUE;
  }

  /**
   * @param piiNamespace set when `value` sits under an identifier key; every identifier
   *   scalar below it (strings, numbers, bigints) is masked or tokenized.
   * @param seen objects on the current path (cycle detection; shared references are fine).
   */
  function sanitizeValue(
    value: unknown,
    piiLevel: PiiLevel,
    piiNamespace: string | undefined,
    seen: WeakSet<object>,
    depth: number,
  ): unknown {
    if (value === null || typeof value !== 'object') {
      if (
        piiNamespace !== undefined &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      ) {
        return protect(String(value), piiLevel, piiNamespace);
      }
      return value;
    }

    if (depth >= MAX_SANITIZE_DEPTH) return '[MaxDepth]';
    if (seen.has(value)) return '[Circular]';

    seen.add(value);
    try {
      if (Array.isArray(value)) {
        return value.map((item: unknown) => sanitizeValue(item, piiLevel, piiNamespace, seen, depth + 1));
      }
      // Like JSON.stringify, toJSON() wins (Date → ISO string, XState actor → { xstate$$type, id }).
      const toJSON: unknown = 'toJSON' in value ? value.toJSON : undefined;
      if (typeof toJSON === 'function') {
        let json: unknown;
        try {
          json = toJSON.call(value);
        } catch {
          return '[Unserializable]';
        }
        return sanitizeValue(json, piiLevel, piiNamespace, seen, depth + 1);
      }
      if (isPlainObject(value)) {
        return sanitizeEntries(value, piiLevel, piiNamespace, seen, depth);
      }
      return describeObject(value);
    } finally {
      seen.delete(value);
    }
  }

  function sanitizeEntries(
    obj: object,
    piiLevel: PiiLevel,
    piiNamespace: string | undefined,
    seen: WeakSet<object>,
    depth: number,
  ): Record<string, unknown> {
    const protectsIdentifiers = piiLevel === 'masked' || piiLevel === 'pseudonymized';
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(obj)) {
      // 1. Secret keys are masked at every level.
      if (isSensitive(key)) {
        setOwn(result, key, MASKED_VALUE);
        continue;
      }
      // 2. Identifier keys (and everything below them) are masked or tokenized.
      const keyNamespace = piiNamespace ?? (protectsIdentifiers ? piiNamespaceOf(key) : undefined);
      setOwn(result, key, sanitizeValue(val, piiLevel, keyNamespace, seen, depth + 1));
    }

    return result;
  }

  return {
    tokenize,
    sanitize<T extends Record<string, unknown>>(
      payload: T,
      piiLevel: PiiLevel = 'none',
      _namespace?: string,
    ): T | null {
      // restricted payloads are dropped entirely.
      if (piiLevel === 'restricted') {
        return null;
      }

      const seen = new WeakSet<object>([payload]);
      // The payload keeps its keys; replaced leaves are strings (documented on the interface).
      return sanitizeEntries(payload, piiLevel, undefined, seen, 0) as T;
    },
  };
}
