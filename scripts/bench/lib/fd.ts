/**
 * File Descriptor (FD) and libuv Handle Leak Tracking Toolkit for oa-sdk Benchmarking.
 *
 * Inspects OS open file descriptors via `/dev/fd` on Darwin/macOS and Linux,
 * falls back to libuv active handles on unsupported platforms, and asserts zero FD leaks
 * across repeated lifecycle iterations.
 */

import * as fs from 'node:fs';

export interface FdLeakResult {
  initialFds: number;
  finalFds: number;
  leaked: number;
  iterations: number;
  hasLeak: boolean;
  activeHandles?: number;
}

export interface FdLeakOptions {
  /** If true, throws an Error when leaked > 0 (default: false) */
  throwOnLeak?: boolean;
  /** Milliseconds to wait for OS and libuv handles to settle (default: 30 ms) */
  settleMs?: number;
}

/**
 * Returns the count of currently open file descriptors for the Node.js process.
 * On Darwin/macOS and Linux, inspects `/dev/fd`.
 * On other platforms or fallback, counts active libuv handles via `process._getActiveHandles()`.
 */
export function getOpenFdCount(): number {
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const entries = fs.readdirSync('/dev/fd');
      return entries.length;
    }
  } catch {
    // Fall back if /dev/fd is inaccessible or restricted
  }

  const handles = (process as any)._getActiveHandles?.() ?? [];
  return handles.length;
}

/**
 * Capture detailed snapshot of open file descriptors and active libuv handles.
 */
export function getOpenFdDetails(): {
  openFds: number[];
  count: number;
  activeHandles: number;
  handleTypes: string[];
} {
  let openFds: number[] = [];
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      openFds = fs.readdirSync('/dev/fd').map(Number).filter(Number.isInteger);
    }
  } catch {
    // Fall back if /dev/fd is unavailable
  }

  const handles = (process as any)._getActiveHandles?.() ?? [];
  const handleTypes: string[] = handles.map((h: any) => h?.constructor?.name ?? typeof h);

  return {
    openFds,
    count: openFds.length > 0 ? openFds.length : handles.length,
    activeHandles: handles.length,
    handleTypes,
  };
}

/**
 * Execute an action repeatedly and assert zero leaked file descriptors or handles.
 * Flushes pending libuv close events with `setImmediate` and settle micro-sleep.
 *
 * @param action Workload to execute repeatedly (e.g. server start/stop or file watch/close).
 * @param iterations Number of times to execute the action (default: 10).
 * @param options Configuration for settling duration and whether to throw on leak.
 * @returns FdLeakResult with initial, final, and leaked FD counts.
 */
export async function assertZeroFdLeak(
  action: () => Promise<void> | void,
  iterations = 10,
  options?: FdLeakOptions
): Promise<FdLeakResult> {
  // Prime internal file descriptor caches and settle libuv
  getOpenFdCount();
  getOpenFdCount();
  await new Promise(resolve => setImmediate(resolve));

  const initialFds = getOpenFdCount();

  for (let i = 0; i < iterations; i++) {
    await action();
  }

  // Allow libuv to flush UV_HANDLE_CLOSING callbacks and release sockets/files
  await new Promise(resolve => setImmediate(resolve));
  const settleTime = options?.settleMs ?? 30;
  if (settleTime > 0) {
    await new Promise(resolve => setTimeout(resolve, settleTime));
  }
  await new Promise(resolve => setImmediate(resolve));

  const finalFds = getOpenFdCount();
  const leaked = Math.max(0, finalFds - initialFds);
  const activeHandles = ((process as any)._getActiveHandles?.() ?? []).length;

  const result: FdLeakResult = {
    initialFds,
    finalFds,
    leaked,
    iterations,
    hasLeak: leaked > 0,
    activeHandles,
  };

  if (options?.throwOnLeak && leaked > 0) {
    throw new Error(
      `FD Leak detected: ${leaked} file descriptors leaked across ${iterations} iterations (initial: ${initialFds}, final: ${finalFds})`
    );
  }

  return result;
}
