import { spawn } from "node:child_process";

import type { Agent, AgentInput, AgentResult, AgentStatus } from "../types.js";

export type PromptDelivery = "argv" | "stdin";

export interface SubprocessAgentOptions {
  /** Display name surfaced to the orchestrator and notes (e.g. "codex", "claude"). */
  readonly name: string;
  /** Binary to spawn. Looked up on `PATH` unless absolute. */
  readonly bin: string;
  /**
   * Args inserted before the prompt position (when `promptDelivery==="argv"`).
   * For `promptDelivery==="stdin"` these are the full argv.
   */
  readonly args: ReadonlyArray<string>;
  /** How the prompt reaches the binary. */
  readonly promptDelivery: PromptDelivery;
  /** Per-run timeout in milliseconds. */
  readonly timeoutMs: number;
  /** Extra env merged on top of `process.env` and the per-run `input.env`. */
  readonly extraEnv?: Readonly<Record<string, string>>;
}

/**
 * Generic subprocess-based Agent. Concrete adapters (CodexAgent, ClaudeAgent)
 * subclass this with their CLI-specific defaults; nothing else should need
 * to be reimplemented per agent.
 */
export class SubprocessAgent implements Agent {
  readonly name: string;
  protected readonly opts: SubprocessAgentOptions;

  constructor(opts: SubprocessAgentOptions) {
    this.name = opts.name;
    this.opts = opts;
  }

  async run(input: AgentInput): Promise<AgentResult> {
    if (input.signal?.aborted === true) {
      return cancelled(this.name);
    }

    const argv =
      this.opts.promptDelivery === "argv"
        ? [...this.opts.args, input.prompt]
        : [...this.opts.args];

    const env: Record<string, string> = {
      ...((process.env as unknown) as Record<string, string>),
      ...(this.opts.extraEnv ?? {}),
      ...(input.env ?? {}),
    };

    return new Promise<AgentResult>((resolveResult) => {
      const child = spawn(this.opts.bin, argv, {
        cwd: input.workspacePath,
        env,
        stdio: [this.opts.promptDelivery === "stdin" ? "pipe" : "ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let killedByTimeout = false;
      let killedBySignal = false;

      // stdio config above always pipes stdout/stderr, so these are non-null
      // at runtime; TS doesn't carry that through the spawn() return type.
      child.stdout?.on("data", (b: Buffer) => {
        stdout += b.toString("utf8");
      });
      child.stderr?.on("data", (b: Buffer) => {
        stderr += b.toString("utf8");
      });

      if (this.opts.promptDelivery === "stdin" && child.stdin !== null) {
        child.stdin.on("error", () => {
          // Ignore EPIPE if the child exits before reading stdin; the close
          // handler below produces the canonical result.
        });
        child.stdin.write(input.prompt);
        child.stdin.end();
      }

      const timer = setTimeout(() => {
        killedByTimeout = true;
        child.kill("SIGTERM");
      }, this.opts.timeoutMs);

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
          summary: `${this.name} agent failed to spawn.`,
          error: err.message,
        });
      });

      child.on("close", (code, sig) => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);

        if (killedBySignal) {
          resolveResult(cancelled(this.name));
          return;
        }
        if (killedByTimeout) {
          resolveResult({
            status: "timed-out",
            summary: `${this.name} exceeded timeout of ${String(this.opts.timeoutMs)}ms.`,
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
          summary: `${this.name} exited with code=${String(code)} signal=${String(sig)}`,
          error: tail(stderr, 2_000),
        });
      });
    });
  }
}

function cancelled(name: string): AgentResult & { status: AgentStatus } {
  return {
    status: "cancelled",
    summary: `${name} agent cancelled by orchestrator.`,
  };
}

function tail(s: string, max: number): string {
  if (s.length <= max) return s;
  return `…(truncated)\n${s.slice(s.length - max)}`;
}
