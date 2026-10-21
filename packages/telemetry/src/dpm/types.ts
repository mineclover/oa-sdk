import type { PiiLevel } from '../symbols/types.js';

export interface DpmTokenOptions {
  namespace?: string;
  salt?: string;
}

export interface DpmTelemetryAdapterOptions {
  /**
   * Secret key for the built-in keyed tokenizer (HMAC-SHA-256). A string is used as its
   * UTF-8 bytes. An empty key is rejected with `TelemetryConfigError`.
   *
   * When omitted (and no `customTokenizer` is given), the adapter generates a random
   * 256-bit key with `crypto.getRandomValues` the first time it tokenizes. Tokens are
   * then stable only for the lifetime of that adapter instance (one page load or
   * process), never across sessions or devices. If the runtime has no
   * `crypto.getRandomValues`, tokenizing throws `TelemetryConfigError` instead of
   * falling back to a guessable key.
   *
   * A key shipped in a browser bundle is not secret: anyone holding it can recompute
   * the token of a guessable value (an email, a sequential id). For identifiers that
   * must stay protected against the bundle's readers, issue tokens on the server and
   * pass them as `TelemetryIdentity.pseudonymToken`, or plug a server-backed
   * `customTokenizer` (for example one backed by `@oa-sdk/dpm`'s keyed executor).
   */
  tokenKey?: string | Uint8Array;
  /**
   * Keys whose values are always replaced with `***MASKED***`, at every PII level.
   * Matching ignores case and `-`/`_` separators and matches substrings, so `'apiKey'`
   * masks `apiKey`, `api_key` and `x-api-key`. The list replaces
   * `DEFAULT_SENSITIVE_KEYS`; spread that constant to extend it.
   */
  sensitiveKeys?: readonly string[];
  /**
   * Identifier keys treated as PII under the `masked` and `pseudonymized` levels,
   * mapped to the entity namespace used in their tokens (`dpm_tok_<namespace>_<mac>`).
   * Matching ignores case and `-`/`_` separators and matches substrings (the longest
   * matching pattern wins), so `email` also covers `customerEmail` and `user_email`.
   * The map replaces `DEFAULT_PII_KEYS`; spread that constant to extend it.
   */
  piiKeys?: Readonly<Record<string, string>>;
  /**
   * Custom tokenizer that replaces the built-in keyed tokenizer (for example a
   * synchronous lookup of tokens issued by a server-side `@oa-sdk/dpm` plan).
   * It receives the entity namespace and the raw value.
   */
  customTokenizer?: (namespace: string, rawValue: string) => string;
}

export interface DpmTelemetryAdapter {
  /**
   * Returns a sanitized copy of `payload` for the given PII level, or `null` for
   * `restricted`:
   *
   * - `none`: only sensitive keys (`sensitiveKeys`) are masked.
   * - `masked`: sensitive keys and identifier keys (`piiKeys`) are masked
   *   (`***MASKED***`); identifiers cannot be correlated across events.
   * - `pseudonymized`: sensitive keys are masked and identifier values are replaced
   *   with deterministic keyed tokens, so the same entity correlates across events.
   * - `restricted`: the payload is dropped (`null`).
   *
   * Tokens are namespaced by the identifier's entity kind (`user`, `order`, ...), not by
   * the event's domain, so a user keeps one token across domains. Cyclic references
   * become `'[Circular]'`, nesting deeper than 10 levels becomes `'[MaxDepth]'`, values
   * with `toJSON()` (Date, XState actor refs) are sanitized through it, and other
   * non-plain objects (Map, Set, class instances) become `'[ClassName]'`. The result
   * keeps the payload's keys; the declared type is preserved for convenience even
   * though replaced leaves are strings.
   *
   * @param namespace Retained for compatibility; it no longer affects tokens.
   */
  sanitize<T extends Record<string, unknown>>(
    payload: T,
    piiLevel?: PiiLevel,
    namespace?: string,
  ): T | null;

  /**
   * Converts a single value into a deterministic pseudonym token
   * (`dpm_tok_<namespace>_<32 hex chars>`) under the adapter's key.
   */
  tokenize(namespace: string, value: string): string;
}
