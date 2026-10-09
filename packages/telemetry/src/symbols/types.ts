export type SymbolLayer = 'UI' | 'FSM' | 'TX' | 'SYS';

export type PiiLevel = 'none' | 'masked' | 'restricted' | 'pseudonymized';

export type KpiDimension = 'acquisition' | 'activation' | 'retention' | 'revenue' | 'referral';

export interface ParsedTrackSymbol {
  layer: SymbolLayer;
  domain: string;
  entity: string;
  action: string;
  aspect?: string | undefined;
  raw: string;
}

export interface SymbolRoutingConfig {
  gtm?: {
    eventName: string;
    category?: string | undefined;
  } | undefined;
  sentry?: {
    level?: 'debug' | 'info' | 'warning' | 'error' | undefined;
    asBreadcrumb?: boolean | undefined;
    asFingerprint?: boolean | undefined;
  } | undefined;
  otel?: {
    spanKind?: 'client' | 'internal' | 'producer' | 'consumer' | undefined;
    recordLatency?: boolean | undefined;
  } | undefined;
}

export interface SymbolDefinition {
  symbol: string;
  description: string;
  piiLevel: PiiLevel;
  kpiDimension?: KpiDimension | undefined;
  routing?: SymbolRoutingConfig | undefined;
}
