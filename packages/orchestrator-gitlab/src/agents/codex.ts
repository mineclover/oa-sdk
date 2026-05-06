import { spawn } from "node:child_process";

import type { Agent, AgentInput, AgentResult } from "../types.js";

export interface CodexAgentOptions {
  /** Override the binary if it is not on PATH. Defaults to "codex". */
  readonly bin?: string;
  /** Extra args inserted before the subcommand (e.g. `--config foo=bar`). */
  readonly globalArgs?: ReadonlyArray<string>;
  /** Subcommand to run. Defaults to "exec" (one-shot non-interactive mode). */
  readonly subcommand?: string;
  /** Per-run timeout in milliseconds. Defaults to 30 minutes. */
  readonly timeoutMs?: number;
}

/**
 * Subprocess wrapper around the Codex CLI in non-interactive mode.
 *
 * Phase A invokes `codex exec <prompt>` in the workspace directory and
 * captures stdout/stderr. Phase B may switch to `codex app-server` for
 * streaming events and multi-turn continuation, mirroring Symphony's path —
 * see SPEC §10. This adapter intentionally hides which transport is used
 * behind the Agent interface so that swap is internal.
 */
export class CodexAgent implements Agent {
  readonly name = "codex";
  readonly #opts: Required<Omit<CodexAgentOptions, "globalArgs">> & {
    readonly globalArgs: ReadonlyArray<string>;
  };

  constructor(opts: CodexAgentOptions = {}) {
    this.#opts = {
      bin: opts.bin ?? "codex",
      globalArgs: opts.globalArgs ?? [],
      subcommand: opts.subcommand ?? "exec",
      timeoutMs: opts.timeoutMs ?? 30 * 60 * 1000,
    };
  }

  async run(input: AgentInput): Promise<AgentResult> {
    const args = [...this.#opts.globalArgs, this.#opts.subcommand, input.prompt];

    return new Promise<AgentResult>((resolveResult) => {
      const child = spawn(this.#opts.bin, args, {
        cwd: input.workspacePath,
        env: { ...process.env, ...(input.env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let killedByTimeout = false;
      let killedBySignal = false;

      child.stdout.on("data", (b: Buffer) => {
        stdout += b.toString("utf8");
      });
      child.stderr.on("data", (b: Buffer) => {
        stderr += b.toString("utf8");
      });

      const timer = setTimeout(() => {
        killedByTimeout = true;
        child.kill("SIGTERM");
      }, this.#opts.timeoutMs);

      const onAbort = (): void => {
        killedBySignal = true;
        child.kill("SIGTERM");
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });

      child.on("error", (err) => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
        resolveResult({
          status: "failed",
          summary: "CodexAgent failed to spawn.",
          error: err.message,
        });
      });

      child.on("close", (code, signal) => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);

        if (killedBySignal) {
          resolveResult({
            status: "cancelled",
            summary: "CodexAgent cancelled by orchestrator.",
          });
          return;
        }
        if (killedByTimeout) {
          resolveResult({
            status: "timed-out",
            summary: `CodexAgent exceeded timeout of ${this.#opts.timeoutMs}ms.`,
            error: tail(stderr, 2_000),
          });
          return;
        }
        if (code === 0) {
          resolveResult({
            status: "succeeded",
            summary: tail(stdout, 4_000) || "(no stdout)",
          });
          return;
        }
        resolveResult({
          status: "failed",
          summary: `CodexAgent exited with code=${String(code)} signal=${String(signal)}`,
          error: tail(stderr, 2_000),
        });
      });
    });
  }
}

function tail(s: string, max: number): string {
  if (s.length <= max) return s;
  return `…(truncated)\n${s.slice(s.length - max)}`;
}
