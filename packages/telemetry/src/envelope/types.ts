export interface TelemetryContext {
  traceId: string;
  spanId?: string | undefined;
  actorId?: string | undefined;
  stateNode?: string | undefined;
  sessionId?: string | undefined;
  userId?: string | undefined;
  tenantId?: string | undefined;
}

export interface TelemetryEnvironment {
  appVersion: string;
  environment: 'development' | 'staging' | 'production' | 'test';
  release?: string | undefined;
}

export interface TelemetryEnvelope<T = Record<string, unknown>> {
  symbol: string;
  timestamp: number;
  context: TelemetryContext;
  environment: TelemetryEnvironment;
  payload: T;
}
