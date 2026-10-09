import type { TelemetryContext, TelemetryEnvelope, TelemetryEnvironment } from './types.js';

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
  context?: Partial<TelemetryContext>;
  environment?: Partial<TelemetryEnvironment>;
}

export function createTelemetryEnvelope<T extends Record<string, unknown> = Record<string, unknown>>(
  options: CreateEnvelopeOptions<T>,
): TelemetryEnvelope<T> {
  const defaultEnv: TelemetryEnvironment = {
    appVersion: '1.0.0',
    environment: (typeof process !== 'undefined' && process.env?.NODE_ENV as any) || 'development',
  };

  const defaultContext: TelemetryContext = {
    traceId: options.context?.traceId || generateTraceId(),
    sessionId: options.context?.sessionId || 'sess_anonymous',
    ...options.context,
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
