import { describe, it, expect } from "vitest";
import { RuntimeChunkEnvelope } from "@oa-sdk/chunk-stream";
import {
  largestTriangleThreeBuckets,
  decimateTimeSeries,
  TimeSeriesAdapter,
  FORMAT_TIME_SERIES,
  type TimeSeriesPoint,
} from "../src/index.js";

describe("@oa-sdk/chunk-stream-timeseries LTTB Downsampler", () => {
  it("preserves endpoints, peaks, and troughs when downsampling", () => {
    // Generate a signal with a prominent spike
    const points: TimeSeriesPoint[] = [];
    for (let i = 0; i < 100; i++) {
      let y = Math.sin(i * 0.1);
      if (i === 50) y = 100; // massive spike
      if (i === 75) y = -50; // massive trough
      points.push({ x: i, y });
    }

    const downsampled = largestTriangleThreeBuckets(points, 10);
    expect(downsampled.length).toBe(10);
    // Preserves first and last point
    expect(downsampled[0]).toEqual(points[0]);
    expect(downsampled[downsampled.length - 1]).toEqual(points[points.length - 1]);

    // Check that the massive spike at x=50 and trough at x=75 are preserved!
    const hasSpike = downsampled.some((p) => p.x === 50 && p.y === 100);
    const hasTrough = downsampled.some((p) => p.x === 75 && p.y === -50);
    expect(hasSpike).toBe(true);
    expect(hasTrough).toBe(true);
  });

  it("handles edge cases gracefully", () => {
    const data: TimeSeriesPoint[] = [
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 3 },
    ];
    expect(largestTriangleThreeBuckets(data, 5)).toHaveLength(3);
    expect(largestTriangleThreeBuckets(data, 2)).toEqual([data[0], data[2]]);
  });
});

describe("@oa-sdk/chunk-stream-timeseries Decimation", () => {
  it("preserves min and max points in min-max mode", () => {
    const points: TimeSeriesPoint[] = [
      { x: 0, y: 10 },
      { x: 1, y: 100 },
      { x: 2, y: -20 },
      { x: 3, y: 5 },
    ];

    const decimated = decimateTimeSeries(points, 1, "min-max");
    expect(decimated).toHaveLength(2);
    // chronologically ordered min and max
    expect(decimated.some((p) => p.y === 100)).toBe(true);
    expect(decimated.some((p) => p.y === -20)).toBe(true);
  });

  it("computes bucket averages in avg mode", () => {
    const points: TimeSeriesPoint[] = [
      { x: 0, y: 10 },
      { x: 1, y: 20 },
      { x: 2, y: 30 },
      { x: 3, y: 40 },
    ];

    const decimated = decimateTimeSeries(points, 2, "avg");
    expect(decimated).toHaveLength(2);
    expect(decimated[0]!.y).toBe(15);
    expect(decimated[1]!.y).toBe(35);
  });
});

describe("@oa-sdk/chunk-stream-timeseries TimeSeriesAdapter", () => {
  it("ingests time-series envelopes, interpolates, and downsamples channel", () => {
    const adapter = new TimeSeriesAdapter({
      channels: [
        { name: "cpu", type: "number", interpolation: "linear" },
        { name: "status", type: "string", interpolation: "discrete" },
      ],
      fps: 30,
    });

    const envelope1 = new RuntimeChunkEnvelope({
      id: "ts_chunk_1",
      sequence: 0,
      streamId: "sys_metrics",
      fromFrame: 0,
      toFrame: 60,
      payloadFormat: FORMAT_TIME_SERIES,
      data: {
        samples: [
          { frame: 0, values: [10, "ok"] },
          { frame: 20, values: [50, "warning"] },
          { frame: 60, values: [90, "critical"] },
        ],
      },
      state: {},
      resources: [],
      residentBytes: 2048,
    });

    const accepted = adapter.ingest(envelope1);
    expect(accepted).toBe(true);
    expect(adapter.sampleCount).toBe(3);

    // Exact frame evaluation
    const eval0 = adapter.evaluateFrame(0);
    expect(eval0.exact).toBe(true);
    expect(eval0.valuesByChannel["cpu"]).toBe(10);
    expect(eval0.valuesByChannel["status"]).toBe("ok");

    // Linear interpolation at frame 10 (halfway between 0 and 20)
    const eval10 = adapter.evaluateFrame(10);
    expect(eval10.exact).toBe(false);
    expect(eval10.valuesByChannel["cpu"]).toBe(30); // (10 + 50) / 2
    expect(eval10.valuesByChannel["status"]).toBe("ok"); // discrete holds previous

    // Extrapolation beyond bounds clamps
    const eval100 = adapter.evaluateFrame(100);
    expect(eval100.valuesByChannel["cpu"]).toBe(90);

    // Channel downsampling
    const cpuSeries = adapter.getChannelSeries("cpu");
    expect(cpuSeries).toHaveLength(3);
    const downsampled = adapter.downsampleChannel("cpu", 2, "lttb");
    expect(downsampled).toHaveLength(2);
    expect(downsampled[0]!.y).toBe(10);
    expect(downsampled[1]!.y).toBe(90);

    adapter.dispose();
  });
});
