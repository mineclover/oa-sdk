import { assertNoPrototypePoisoning, type RuntimeChunkEnvelope } from "@oa-sdk/chunk-stream";
import type {
  ChannelConfigInput,
  ChannelDef,
  TimeSeriesAdapterOptions,
  TimeSeriesEvaluation,
  TimeSeriesPayload,
  TimeSeriesPoint,
  TimeSeriesSample,
} from "./types.js";
import { largestTriangleThreeBuckets } from "./lttb.js";
import { decimateTimeSeries, type DecimationMode } from "./decimate.js";

export const FORMAT_TIME_SERIES = "time-series@v1" as const;

export function interpolateLinear(v0: unknown, v1: unknown, alpha: number): unknown {
  if (
    typeof v0 !== "number" ||
    !Number.isFinite(v0) ||
    typeof v1 !== "number" ||
    !Number.isFinite(v1)
  ) {
    return v0;
  }
  if (v0 === v1) return v0;
  return v0 + (v1 - v0) * alpha;
}

export function findBoundingIndices(
  samples: readonly TimeSeriesSample[],
  frame: number
): { exact: number; prev: number | null; next: number | null } {
  let low = 0;
  let high = samples.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const f = samples[mid]!.frame;
    if (f === frame) {
      return { exact: mid, prev: mid, next: mid };
    }
    if (f < frame) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return {
    exact: -1,
    prev: high >= 0 ? high : null,
    next: low < samples.length ? low : null,
  };
}

export function normalizeChannelDefs(
  channels?: readonly (string | ChannelConfigInput)[] | undefined,
  options: TimeSeriesAdapterOptions = {}
): ChannelDef[] {
  if (!channels || !channels.length) return [];
  const defs: ChannelDef[] = [];
  const seen = new Set<string>();

  const defaultInterp = options.defaultInterpolation ?? "linear";
  const defaultType = options.defaultType ?? "number";
  const defaultExtrap = options.defaultExtrapolation ?? "clamp";

  for (const item of channels) {
    const raw: ChannelConfigInput = typeof item === "string" ? { name: item } : item;
    const name = raw.name;
    if (!name || typeof name !== "string") {
      throw new Error("E_CHANNEL_NAME: Channel name must be a non-empty string");
    }
    if (seen.has(name)) {
      throw new Error(`E_CHANNEL_DUPLICATE: Duplicate channel: ${name}`);
    }
    seen.add(name);

    const type = raw.type ?? defaultType;
    const interpolation = raw.interpolation ?? (type === "number" ? defaultInterp : "discrete");
    const extrapolation = raw.extrapolation ?? defaultExtrap;

    defs.push({
      name,
      type,
      interpolation,
      extrapolation,
      defaultValue: raw.defaultValue,
      unit: raw.unit,
    });
  }

  return defs;
}

export class TimeSeriesAdapter {
  readonly payloadFormat = FORMAT_TIME_SERIES;
  private readonly options: TimeSeriesAdapterOptions;
  private channelDefs: ChannelDef[];
  private channelNames: string[];
  private readonly samples: TimeSeriesSample[] = [];
  private readonly sampleMap = new Map<number, TimeSeriesSample>();
  private readonly listeners = new Set<(evaluation: TimeSeriesEvaluation) => void>();
  private disposed = false;

  constructor(options: TimeSeriesAdapterOptions = {}) {
    this.options = options;
    this.channelDefs = normalizeChannelDefs(options.channels, options);
    this.channelNames = this.channelDefs.map((c) => c.name);
  }

  get channels(): readonly string[] {
    return this.channelNames;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  on(listener: (evaluation: TimeSeriesEvaluation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ingest(envelope: RuntimeChunkEnvelope): boolean {
    if (this.disposed) return false;
    if (envelope.payloadFormat !== FORMAT_TIME_SERIES) return false;

    const data = envelope.data as TimeSeriesPayload | undefined;
    if (!data || !Array.isArray(data.samples)) return false;

    // Dynamically discover channels if none configured yet
    if (this.channelDefs.length === 0 && data.channels && data.channels.length > 0) {
      this.channelDefs = normalizeChannelDefs(data.channels, this.options);
      this.channelNames = this.channelDefs.map((c) => c.name);
    }

    for (const sample of data.samples) {
      if (typeof sample.frame !== "number" || !Array.isArray(sample.values)) continue;
      assertNoPrototypePoisoning(sample);

      if (this.sampleMap.has(sample.frame)) {
        // Update existing sample
        const existingIdx = this.samples.findIndex((s) => s.frame === sample.frame);
        if (existingIdx !== -1) {
          this.samples[existingIdx] = sample;
        }
      } else {
        // Binary insert by frame to keep monotonic order
        const { next } = findBoundingIndices(this.samples, sample.frame);
        if (next === null) {
          this.samples.push(sample);
        } else {
          this.samples.splice(next, 0, sample);
        }
      }
      this.sampleMap.set(sample.frame, sample);
    }

    return true;
  }

  evaluateFrame(frame: number, context: { readonly signal?: AbortSignal | undefined } = {}): TimeSeriesEvaluation {
    if (this.disposed) throw new Error("E_DISPOSED: TimeSeriesAdapter has been disposed");
    if (context.signal?.aborted) throw new Error("E_ABORT: Evaluation aborted");
    if (!Number.isSafeInteger(frame) || frame < 0) {
      throw new Error(`E_FRAME: Frame must be a non-negative safe integer: ${frame}`);
    }

    const fps = this.options.fps ?? 30;
    const timestampMs = (frame / fps) * 1000;
    const channels = [...this.channelNames];

    let values: unknown[] = [];
    let exact = false;
    let prevSample: TimeSeriesSample | null = null;
    let nextSample: TimeSeriesSample | null = null;

    if (this.samples.length === 0) {
      values = this.channelDefs.map((d) =>
        d.extrapolation === "clamp" && d.defaultValue !== undefined ? d.defaultValue : null
      );
    } else if (this.sampleMap.has(frame)) {
      const sample = this.sampleMap.get(frame)!;
      exact = true;
      prevSample = sample;
      nextSample = sample;
      values = [...sample.values];
    } else {
      const bounds = findBoundingIndices(this.samples, frame);
      if (bounds.prev === null) {
        nextSample = this.samples[bounds.next!] ?? null;
        values = this.channelDefs.map((def, idx) => {
          if (def.extrapolation === "clamp" && nextSample) return nextSample.values[idx];
          return def.defaultValue !== undefined ? def.defaultValue : null;
        });
      } else if (bounds.next === null) {
        prevSample = this.samples[bounds.prev!] ?? null;
        values = this.channelDefs.map((def, idx) => {
          if (def.extrapolation === "clamp" && prevSample) return prevSample.values[idx];
          return def.defaultValue !== undefined ? def.defaultValue : null;
        });
      } else {
        const pSample = this.samples[bounds.prev!]!;
        const nSample = this.samples[bounds.next!]!;
        prevSample = pSample;
        nextSample = nSample;
        const f0 = pSample.frame;
        const f1 = nSample.frame;
        const alpha = f1 > f0 ? (frame - f0) / (f1 - f0) : 0;

        values = this.channelDefs.map((def, idx) => {
          const v0 = pSample.values[idx];
          const v1 = nSample.values[idx];

          if (def.interpolation === "discrete") return v0;
          if (def.interpolation === "nearest") {
            const d0 = frame - f0;
            const d1 = f1 - frame;
            return d0 <= d1 ? v0 : v1;
          }
          return interpolateLinear(v0, v1, alpha);
        });
      }
    }

    const valuesByChannel: Record<string, unknown> = {};
    for (let i = 0; i < channels.length; i++) {
      valuesByChannel[channels[i]!] = values[i];
    }

    const evaluation: TimeSeriesEvaluation = {
      frame,
      timestampMs,
      channels,
      values,
      valuesByChannel,
      exact,
      boundingSamples: { prev: prevSample, next: nextSample },
    };

    for (const listener of this.listeners) {
      try {
        listener(evaluation);
      } catch {
        /* observer isolation */
      }
    }
    this.options.onSample?.(evaluation);

    return evaluation;
  }

  getChannelSeries(channelName: string): TimeSeriesPoint[] {
    const idx = this.channelNames.indexOf(channelName);
    if (idx === -1) return [];

    const points: TimeSeriesPoint[] = [];
    for (const s of this.samples) {
      const val = s.values[idx];
      if (typeof val === "number" && Number.isFinite(val)) {
        points.push({ x: s.frame, y: val });
      }
    }
    return points;
  }

  downsampleChannel(
    channelName: string,
    targetPoints: number,
    algorithm: "lttb" | "decimate" = "lttb",
    decimationMode: DecimationMode = "min-max"
  ): TimeSeriesPoint[] {
    const series = this.getChannelSeries(channelName);
    if (series.length <= targetPoints) return series;

    if (algorithm === "lttb") {
      return largestTriangleThreeBuckets(series, targetPoints);
    }
    return decimateTimeSeries(series, targetPoints, decimationMode);
  }

  getValue(channel: string, frame?: number): unknown {
    if (frame !== undefined) {
      const evaluation = this.evaluateFrame(frame);
      return evaluation.valuesByChannel[channel] ?? null;
    }
    if (!this.samples.length) return null;
    const last = this.samples[this.samples.length - 1]!;
    const idx = this.channelNames.indexOf(channel);
    return idx !== -1 ? last.values[idx] : null;
  }

  dispose(): void {
    this.disposed = true;
    this.samples.length = 0;
    this.sampleMap.clear();
    this.listeners.clear();
  }
}
