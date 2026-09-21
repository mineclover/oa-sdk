export type ChannelType = "number" | "string" | "boolean" | "any";
export type InterpolationMode = "linear" | "nearest" | "discrete";
export type ExtrapolationMode = "clamp" | "null";

export interface ChannelDef {
  readonly name: string;
  readonly type: ChannelType;
  readonly interpolation: InterpolationMode;
  readonly extrapolation: ExtrapolationMode;
  readonly defaultValue?: unknown | undefined;
  readonly unit?: string | undefined;
}

export interface ChannelConfigInput {
  readonly name: string;
  readonly type?: ChannelType | undefined;
  readonly interpolation?: InterpolationMode | undefined;
  readonly extrapolation?: ExtrapolationMode | undefined;
  readonly defaultValue?: unknown | undefined;
  readonly unit?: string | undefined;
}

export interface TimeSeriesSample {
  readonly frame: number;
  readonly timestampMs?: number | undefined;
  readonly values: readonly unknown[];
}

export interface TimeSeriesPayload {
  readonly channels?: readonly (string | ChannelConfigInput)[] | undefined;
  readonly samples: readonly TimeSeriesSample[];
}

export interface TimeSeriesEvaluation {
  readonly frame: number;
  readonly timestampMs: number;
  readonly channels: readonly string[];
  readonly values: readonly unknown[];
  readonly valuesByChannel: Record<string, unknown>;
  readonly exact: boolean;
  readonly boundingSamples: {
    readonly prev: TimeSeriesSample | null;
    readonly next: TimeSeriesSample | null;
  };
}

export interface TimeSeriesPoint {
  readonly x: number;
  readonly y: number;
}

export interface TimeSeriesAdapterOptions {
  readonly channels?: readonly (string | ChannelConfigInput)[] | undefined;
  readonly defaultInterpolation?: InterpolationMode | undefined;
  readonly defaultType?: ChannelType | undefined;
  readonly defaultExtrapolation?: ExtrapolationMode | undefined;
  readonly fps?: number | undefined;
  readonly onSample?: ((evaluation: TimeSeriesEvaluation) => void) | undefined;
}
