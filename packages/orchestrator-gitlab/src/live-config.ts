import { watch, type FSWatcher } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { OrchestratorConfig, LogRecord } from "./config.js";
import type { OrchestratorRuntime } from "./runtime.js";
import { loadWorkflow, type LoadWorkflowOverrides } from "./workflow.js";

/**
 * Holds the *current* OrchestratorConfig and lets `run()` re-read it each tick.
 * Fields are swapped wholesale on reload — in-flight workers keep the snapshot
 * they were started with for their lifetime.
 */
export class LiveConfigProvider {
  #config: OrchestratorConfig;

  constructor(initial: OrchestratorConfig) {
    this.#config = initial;
  }

  current(): OrchestratorConfig {
    return this.#config;
  }

  swap(next: OrchestratorConfig): void {
    this.#config = next;
  }
}

export function isLiveConfigProvider(x: unknown): x is LiveConfigProvider {
  return x instanceof LiveConfigProvider;
}

export interface WatchOptions {
  /** Debounce window after a fs.watch event before we re-parse. Default 100ms. */
  readonly debounceMs?: number;
  /** Logger (Symphony §6.2 says reload errors must be operator-visible, never crash the service). */
  readonly log?: (record: LogRecord) => void;
  /** Optional runtime to record reload count + last reload error on. */
  readonly runtime?: OrchestratorRuntime;
  /** Override logic when (re-)loading the workflow — usually the same `agent` you started with. */
  readonly overrides?: LoadWorkflowOverrides;
}

export interface WatchHandle {
  readonly provider: LiveConfigProvider;
  close(): void;
}

/**
 * Start watching `workflowPath`. On every change event:
 *   1. Wait `debounceMs` to coalesce rapid edits.
 *   2. Re-parse + validate via `loadWorkflow`.
 *   3. On success: swap the LiveConfigProvider (no in-flight workers killed).
 *      Apply takes effect at the next tick / next agent dispatch / next turn build.
 *   4. On failure: keep the previous config + log the error + record it on the
 *      runtime. The orchestrator keeps running with the last-known-good config.
 *
 * In-flight workers retain the snapshot they were dispatched with — see
 * Symphony SPEC §6.2. Agent reconfiguration mid-flight is intentionally out
 * of scope for this phase.
 */
export async function watchWorkflow(
  workflowPath: string,
  options: WatchOptions = {},
): Promise<WatchHandle> {
  const absPath = resolvePath(workflowPath);
  const debounceMs = options.debounceMs ?? 100;
  const log = options.log;

  const initial = await loadWorkflow(absPath, options.overrides ?? {});
  const provider = new LiveConfigProvider(initial);

  let pending: NodeJS.Timeout | undefined;
  let closed = false;

  const reload = async (): Promise<void> => {
    if (closed) return;
    try {
      const next = await loadWorkflow(absPath, options.overrides ?? {});
      provider.swap(next);
      if (options.runtime !== undefined) {
        options.runtime.reloadCount++;
        options.runtime.lastReloadError = undefined;
      }
      log?.({ level: "info", msg: `workflow reloaded from ${absPath}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (options.runtime !== undefined) {
        options.runtime.lastReloadError = { msg, at: Date.now() };
      }
      log?.({ level: "error", msg: `workflow reload failed; keeping last-known-good`, error: err });
    }
  };

  let watcher: FSWatcher;
  try {
    watcher = watch(absPath, { persistent: false }, () => {
      if (closed) return;
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = undefined;
        void reload();
      }, debounceMs);
    });
  } catch (err) {
    log?.({ level: "warn", msg: `fs.watch unavailable for ${absPath}; hot reload disabled`, error: err });
    // Return a handle that still has the initial provider but no watcher.
    return {
      provider,
      close(): void {
        closed = true;
      },
    };
  }

  // fs.watch does not surface errors as Promise rejections; just log if it does.
  watcher.on("error", (err) => {
    log?.({ level: "warn", msg: `fs.watch error on ${absPath}`, error: err });
  });

  return {
    provider,
    close(): void {
      closed = true;
      if (pending !== undefined) {
        clearTimeout(pending);
        pending = undefined;
      }
      watcher.close();
    },
  };
}
