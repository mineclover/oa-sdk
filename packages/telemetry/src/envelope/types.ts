export interface TelemetryContext {
  traceId: string;
  spanId?: string | undefined;
  /** The actor's id (an invoke/spawn id is shared by every instance of that child). */
  actorId?: string | undefined;
  /**
   * XState `sessionId` of the actor: unique per actor instance, unlike `actorId`. The OTel
   * dispatcher uses it to find the actor's own span when there is no ambient span.
   */
  actorSessionId?: string | undefined;
  stateNode?: string | undefined;
  sessionId?: string | undefined;
  userId?: string | undefined;
  tenantId?: string | undefined;
}

/**
 * Context fields a caller may supply. A field given as `undefined` means "no value": it
 * never erases a default such as the generated trace id.
 */
export type TelemetryContextInput = { [K in keyof TelemetryContext]?: TelemetryContext[K] | undefined };

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
