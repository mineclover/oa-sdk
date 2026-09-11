/**
 * V8 Memory and Retained Heap Delta Measurement Toolkit for oa-sdk Benchmarking.
 *
 * Dynamically enables V8 garbage collection via `--expose_gc`, executes multi-pass
 * GC to flush weak references and finalizers, and measures true retained heap memory delta.
 */

import * as v8 from 'node:v8';
import * as vm from 'node:vm';

export interface MemoryDelta {
  initialHeapMb: number;
  finalHeapMb: number;
  heapDeltaMb: number;
  gcRuns: number;
  baselineHeapBytes?: number;
  postHeapBytes?: number;
  retainedHeapBytes?: number;
  rssBytes?: number;
}

/**
 * Ensures that `global.gc()` is available in the current Node.js process.
 * If not already enabled, attempts to set V8 flags and bind `gc` from a new VM context.
 */
export function ensureGc(): () => void {
  if (typeof global.gc === 'function') {
    return global.gc;
  }

  try {
    v8.setFlagsFromString('--expose_gc');
    const gc = vm.runInNewContext('gc');
    if (typeof gc === 'function') {
      (global as any).gc = gc;
      return gc;
    }
  } catch {
    // If V8 flags are frozen or restricted, return no-op fallback
  }

  return () => {};
}

/**
 * Run multiple passes of garbage collection to clear queued weak references,
 * unreferenced closures, and deferred finalizers.
 *
 * @param passes Number of GC cycles to execute (default: 3).
 * @returns The number of GC passes successfully executed.
 */
export function runGc(passes = 3): number {
  const gc = ensureGc();
  let executed = 0;

  for (let i = 0; i < passes; i++) {
    try {
      if (typeof global.gc === 'function') {
        global.gc();
        executed++;
      } else if (typeof gc === 'function') {
        gc();
        executed++;
      }
    } catch {
      break;
    }
  }

  return executed;
}

/**
 * Get current process heap usage in megabytes.
 */
export function getHeapUsageMb(): number {
  return Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(3));
}

/**
 * Measure retained heap memory delta across an asynchronous or synchronous workload.
 * Runs multi-pass GC before and after the workload to isolate true retained allocations.
 *
 * @param fn Workload to execute and measure.
 * @returns Result object containing workload output and MemoryDelta metrics.
 */
export async function measureMemoryDelta<T>(
  fn: () => Promise<T> | T
): Promise<{ result: T; delta: MemoryDelta } & MemoryDelta> {
  // Pre-workload GC purge
  const gcRunsBefore = runGc(3);
  const initialMem = process.memoryUsage();
  const initialHeapMb = Number((initialMem.heapUsed / (1024 * 1024)).toFixed(3));

  const result = await fn();

  // Post-workload GC purge to reclaim transient garbage
  const gcRunsAfter = runGc(3);
  const finalMem = process.memoryUsage();
  const finalHeapMb = Number((finalMem.heapUsed / (1024 * 1024)).toFixed(3));
  const heapDeltaMb = Number((finalHeapMb - initialHeapMb).toFixed(3));
  const retainedHeapBytes = Math.max(0, finalMem.heapUsed - initialMem.heapUsed);

  const delta: MemoryDelta = {
    initialHeapMb,
    finalHeapMb,
    heapDeltaMb,
    gcRuns: gcRunsBefore + gcRunsAfter,
    baselineHeapBytes: initialMem.heapUsed,
    postHeapBytes: finalMem.heapUsed,
    retainedHeapBytes,
    rssBytes: finalMem.rss,
  };

  return {
    result,
    delta,
    ...delta,
  };
}

/**
 * Alias for measureMemoryDelta providing backward compatibility.
 */
export const measureRetainedMemoryDelta = measureMemoryDelta;
