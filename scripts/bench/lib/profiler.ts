/**
 * V8 CPU Profiler Toolkit for oa-sdk Benchmarking.
 *
 * Programmatically samples CPU execution using Node.js `node:inspector/promises`,
 * writes standard Chrome DevTools compatible `.cpuprofile` files, and extracts
 * line-level hotspot call frames.
 */

import { Session } from 'node:inspector/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

export interface Hotspot {
  functionName: string;
  url: string;
  lineNumber: number;
  hitCount: number;
  percentage: number;
}

export interface CpuProfileResult {
  name: string;
  profilePath: string;
  totalHitCount: number;
  durationMs: number;
  topHotspots: Hotspot[];
  rawProfile?: unknown;
}

export interface CpuProfileOptions {
  /** Sampling interval in microseconds (default: 1000 µs = 1 ms) */
  samplingIntervalUs?: number;
  /** Directory where .cpuprofile will be saved (default: .bench/) */
  outputDir?: string;
  /** Number of top hotspots to retain (default: 15) */
  topHotspotCount?: number;
  /** Whether to retain the full raw inspector profile object on the result (default: false) */
  saveRawProfile?: boolean;
}

/**
 * Execute a workload under V8 CPU profiling and extract hotspot metrics.
 *
 * @param name Descriptive identifier for this profile session (used in filename).
 * @param fn Synchronous or asynchronous workload to profile.
 * @param options Configuration for sampling rate, output directory, and hotspot count.
 */
export async function withCpuProfile<T>(
  name: string,
  fn: () => Promise<T> | T,
  options?: CpuProfileOptions
): Promise<{ result: T; profile: CpuProfileResult }> {
  const session = new Session();
  session.connect();

  await session.post('Profiler.enable');

  if (options?.samplingIntervalUs !== undefined && options.samplingIntervalUs > 0) {
    await session.post('Profiler.setSamplingInterval', {
      interval: options.samplingIntervalUs,
    });
  }

  await session.post('Profiler.start');
  const startMs = performance.now();

  let result: T;
  let rawProfile: any;

  try {
    result = await fn();
  } finally {
    try {
      const stopResponse = await session.post('Profiler.stop');
      rawProfile = stopResponse.profile;
    } finally {
      session.disconnect();
    }
  }

  const durationMs = Number((performance.now() - startMs).toFixed(3));

  // Determine output path and ensure directory exists
  const outputDir = options?.outputDir ?? path.resolve(process.cwd(), '.bench');
  fs.mkdirSync(outputDir, { recursive: true });

  const sanitizedName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const profilePath = path.join(outputDir, `${sanitizedName}.cpuprofile`);
  fs.writeFileSync(profilePath, JSON.stringify(rawProfile, null, 2), 'utf8');

  // Traverse call tree nodes to calculate total hit counts and aggregate hotspots
  const nodes = rawProfile?.nodes ?? [];
  let totalHitCount = 0;
  for (const node of nodes) {
    totalHitCount += node.hitCount ?? 0;
  }

  const hotspotMap = new Map<string, Hotspot>();
  for (const node of nodes) {
    const hitCount = node.hitCount ?? 0;
    if (hitCount <= 0) continue;

    const functionName = node.callFrame?.functionName || '(anonymous)';
    const url = node.callFrame?.url || '';
    const lineNumber = node.callFrame?.lineNumber ?? -1;
    const key = `${functionName}|${url}|${lineNumber}`;

    const existing = hotspotMap.get(key);
    if (existing) {
      existing.hitCount += hitCount;
    } else {
      hotspotMap.set(key, {
        functionName,
        url,
        lineNumber,
        hitCount,
        percentage: 0,
      });
    }
  }

  const topLimit = options?.topHotspotCount ?? 15;
  const topHotspots: Hotspot[] = Array.from(hotspotMap.values())
    .map(h => ({
      ...h,
      percentage: totalHitCount > 0 ? Number(((h.hitCount / totalHitCount) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, topLimit);

  const profileResult: CpuProfileResult = {
    name,
    profilePath,
    totalHitCount,
    durationMs,
    topHotspots,
    rawProfile: options?.saveRawProfile ? rawProfile : undefined,
  };

  return {
    result,
    profile: profileResult,
  };
}

/**
 * Alias for withCpuProfile providing backward compatibility with survey scripts.
 */
export const profileBlock = withCpuProfile;
