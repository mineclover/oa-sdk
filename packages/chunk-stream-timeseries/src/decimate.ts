import type { TimeSeriesPoint } from "./types.js";

export type DecimationMode = "min-max" | "avg" | "sum" | "count";

/**
 * Decimates time-series numeric points into a target number of buckets.
 *
 * In "min-max" mode, produces up to 2 points per bucket (preserving both local extrema
 * in chronological order) to guarantee that spikes and drops are never hidden.
 */
export function decimateTimeSeries(
  points: readonly TimeSeriesPoint[],
  bucketCount: number,
  mode: DecimationMode = "min-max"
): TimeSeriesPoint[] {
  if (!points.length || bucketCount <= 0) return [];
  if (points.length <= bucketCount) return [...points];

  const result: TimeSeriesPoint[] = [];
  const bucketSize = points.length / bucketCount;

  for (let b = 0; b < bucketCount; b++) {
    const startIdx = Math.floor(b * bucketSize);
    const endIdx = Math.min(points.length, Math.floor((b + 1) * bucketSize));
    if (startIdx >= endIdx) continue;

    const slice = points.slice(startIdx, endIdx);
    if (!slice.length) continue;

    if (mode === "min-max") {
      let minPt = slice[0]!;
      let maxPt = slice[0]!;

      for (const pt of slice) {
        if (pt.y < minPt.y) minPt = pt;
        if (pt.y > maxPt.y) maxPt = pt;
      }

      if (minPt.x === maxPt.x) {
        result.push(minPt);
      } else if (minPt.x < maxPt.x) {
        result.push(minPt, maxPt);
      } else {
        result.push(maxPt, minPt);
      }
    } else if (mode === "avg") {
      const sumY = slice.reduce((acc, p) => acc + p.y, 0);
      const midX = slice[Math.floor(slice.length / 2)]!.x;
      result.push({ x: midX, y: sumY / slice.length });
    } else if (mode === "sum") {
      const sumY = slice.reduce((acc, p) => acc + p.y, 0);
      const midX = slice[Math.floor(slice.length / 2)]!.x;
      result.push({ x: midX, y: sumY });
    } else if (mode === "count") {
      const midX = slice[Math.floor(slice.length / 2)]!.x;
      result.push({ x: midX, y: slice.length });
    }
  }

  return result;
}
