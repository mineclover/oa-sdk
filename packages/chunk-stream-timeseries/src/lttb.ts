import type { TimeSeriesPoint } from "./types.js";

/**
 * Largest Triangle Three Buckets (LTTB) downsampling algorithm.
 * Downsamples numeric time-series data while preserving visual peaks, troughs,
 * and trend dynamics.
 *
 * @param data Monotonically increasing data points by x (e.g. frame or timestamp)
 * @param threshold Target number of output points (must be >= 2)
 */
export function largestTriangleThreeBuckets(
  data: readonly TimeSeriesPoint[],
  threshold: number
): TimeSeriesPoint[] {
  const dataLen = data.length;
  if (threshold >= dataLen || threshold <= 0) {
    return [...data];
  }

  if (threshold === 1) {
    return [data[0]!];
  }

  if (threshold === 2) {
    return [data[0]!, data[dataLen - 1]!];
  }

  const sampled: TimeSeriesPoint[] = [];
  let sampledIndex = 0;

  // Bucket size. Leave room for start and end data points
  const every = (dataLen - 2) / (threshold - 2);

  // Initially a is the first point in the data
  let a = 0;
  sampled[sampledIndex++] = data[a]!;

  for (let i = 0; i < threshold - 2; i++) {
    // Calculate point average for next bucket (containing c)
    let avgX = 0;
    let avgY = 0;
    let avgRangeStart = Math.floor((i + 1) * every) + 1;
    let avgRangeEnd = Math.floor((i + 2) * every) + 1;
    avgRangeEnd = avgRangeEnd < dataLen ? avgRangeEnd : dataLen;

    const avgRangeLength = avgRangeEnd - avgRangeStart;

    for (; avgRangeStart < avgRangeEnd; avgRangeStart++) {
      avgX += data[avgRangeStart]!.x;
      avgY += data[avgRangeStart]!.y;
    }

    avgX /= avgRangeLength || 1;
    avgY /= avgRangeLength || 1;

    // Get the range for this bucket
    let rangeOffs = Math.floor(i * every) + 1;
    const rangeTo = Math.floor((i + 1) * every) + 1;

    // Point a
    const pointAx = data[a]!.x;
    const pointAy = data[a]!.y;

    let maxArea = -1;
    let nextA = rangeOffs;

    for (; rangeOffs < rangeTo; rangeOffs++) {
      // Calculate triangle area over three buckets
      const area = Math.abs(
        (pointAx - avgX) * (data[rangeOffs]!.y - pointAy) -
          (pointAx - data[rangeOffs]!.x) * (avgY - pointAy)
      ) * 0.5;

      if (area > maxArea) {
        maxArea = area;
        nextA = rangeOffs; // Pick this point for next bucket
      }
    }

    sampled[sampledIndex++] = data[nextA]!;
    a = nextA; // This a is the next a (chosen point)
  }

  // Always add last
  sampled[sampledIndex++] = data[dataLen - 1]!;

  return sampled;
}
