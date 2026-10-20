import type { TelemetryContext, TelemetryContextInput, TelemetryEnvelope, TelemetryEnvironment } from './types.js';

function generateRandomHex(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function generateTraceId(): string {
  // W3C Trace Context 32-char hex string
  return generateRandomHex(32);
}

export function generateSpanId(): string {
  // W3C Trace Context 16-char hex string
  return generateRandomHex(16);
}

export interface CreateEnvelopeOptions<T> {
  symbol: string;
  payload: T;
  context?: TelemetryContextInput;
  environment?: Partial<TelemetryEnvironment>;
}

const ENVIRONMENT_NAMES: ReadonlySet<string> = new Set<TelemetryEnvironment['environment']>([
  'development',
  'staging',
  'production',
  'test',
]);

function isEnvironmentName(value: unknown): value is TelemetryEnvironment['environment'] {
  return typeof value === 'string' && ENVIRONMENT_NAMES.has(value);
}

function detectEnvironment(): TelemetryEnvironment['environment'] {
  const nodeEnv: unknown = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;
  return isEnvironmentName(nodeEnv) ? nodeEnv : 'development';
}

/**
 * Builds an envelope. Context fields given as `undefined` (or an empty `traceId` /
 * `sessionId`) never erase the defaults: a missing trace id is generated and a
 * missing session id becomes `'sess_anonymous'`.
 */
export function createTelemetryEnvelope<T extends Record<string, unknown> = Record<string, unknown>>(
  options: CreateEnvelopeOptions<T>,
): TelemetryEnvelope<T> {
  const defaultEnv: TelemetryEnvironment = {
    appVersion: '1.0.0',
    environment: detectEnvironment(),
  };

  const ctx = options.context ?? {};
  const defaultContext: TelemetryContext = {
    ...ctx,
    traceId: ctx.traceId || generateTraceId(),
    sessionId: ctx.sessionId || 'sess_anonymous',
  };

  return {
    symbol: options.symbol,
    timestamp: Date.now(),
    context: defaultContext,
    environment: {
      ...defaultEnv,
      ...options.environment,
    },
    payload: options.payload,
  };
}
