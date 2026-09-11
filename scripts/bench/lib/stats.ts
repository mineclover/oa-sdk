/**
 * Latency Percentile Statistics & High-Precision Timing Toolkit for oa-sdk Benchmarking.
 *
 * Computes exact statistical distributions (min, p50, p90, p95, p99, max, mean, stddev, QPS)
 * from sub-millisecond latency samples and provides high-precision execution timers.
 */

import { performance } from 'node:perf_hooks';

export interface LatencyStats {
  samples: number;
  minMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
  stddevMs: number;
  qps: number;

  // Ergonomic aliases
  min: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  stddev: number;
  throughput: number;
}

/**
 * Calculate statistical latency distribution and throughput from an array of millisecond timings.
 *
 * @param latenciesMs Array of measured execution latencies in milliseconds.
 * @param totalDurationMs Optional total wall-clock duration of the benchmark run (useful for concurrent load).
 */
export function calculateLatencyStats(
  latenciesMs: number[],
  totalDurationMs?: number
): LatencyStats {
  const n = latenciesMs.length;
  if (n === 0) {
    return {
      samples: 0,
      minMs: 0,
      p50Ms: 0,
      p90Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      meanMs: 0,
      stddevMs: 0,
      qps: 0,
      min: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      max: 0,
      mean: 0,
      stddev: 0,
      throughput: 0,
    };
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[n - 1]!;

  // Linear interpolation percentile calculation
  function percentile(p: number): number {
    if (n === 1) return sorted[0]!;
    const index = (n - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower]!;
    return sorted[lower]! + (index - lower) * (sorted[upper]! - sorted[lower]!);
  }

  const p50 = percentile(0.5);
  const p90 = percentile(0.9);
  const p95 = percentile(0.95);
  const p99 = percentile(0.99);

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += sorted[i]!;
  }
  const mean = sum / n;

  let sumSqDiff = 0;
  for (let i = 0; i < n; i++) {
    const diff = sorted[i]! - mean;
    sumSqDiff += diff * diff;
  }
  const stddev = Math.sqrt(sumSqDiff / n);

  let qps: number;
  if (totalDurationMs !== undefined && totalDurationMs > 0) {
    qps = Math.round(n / (totalDurationMs / 1000));
  } else if (mean > 0) {
    qps = Math.round(1000 / mean);
  } else {
    qps = 0;
  }

  const round3 = (v: number) => Number(v.toFixed(3));

  return {
    samples: n,
    minMs: round3(min),
    p50Ms: round3(p50),
    p90Ms: round3(p90),
    p95Ms: round3(p95),
    p99Ms: round3(p99),
    maxMs: round3(max),
    meanMs: round3(mean),
    stddevMs: round3(stddev),
    qps,
    min: round3(min),
    p50: round3(p50),
    p90: round3(p90),
    p95: round3(p95),
    p99: round3(p99),
    max: round3(max),
    mean: round3(mean),
    stddev: round3(stddev),
    throughput: qps,
  };
}

/**
 * Returns current timestamp in milliseconds with sub-millisecond precision.
 */
export function now(): number {
  return performance.now();
}

/**
 * Measure execution duration in milliseconds for an asynchronous or synchronous function.
 */
export async function measureDuration<T>(
  fn: () => Promise<T> | T
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = Number((performance.now() - start).toFixed(3));
  return { result, durationMs };
}

/**
 * Measure execution duration in milliseconds for a synchronous function.
 */
export function measureDurationSync<T>(
  fn: () => T
): { result: T; durationMs: number } {
  const start = performance.now();
  const result = fn();
  const durationMs = Number((performance.now() - start).toFixed(3));
  return { result, durationMs };
}

/**
 * Asynchronously pauses execution for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format a millisecond duration into a human-readable string (µs, ms, or s).
 */
export function formatMs(ms: number): string {
  if (ms <= 0) return '0 ms';
  if (ms < 0.0001) return '<0.1 µs';
  if (ms < 1) return `${(ms * 1000).toFixed(1)} µs`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Format a QPS number into a formatted rate string (e.g. 5,815 ops/s).
 */
export function formatQps(qps: number): string {
  return `${Math.round(qps).toLocaleString()} ops/s`;
}
