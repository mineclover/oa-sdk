import { SubprocessAgent } from "./subprocess.js";

export interface ClaudeAgentOptions {
  /** Override the binary if it is not on PATH. Defaults to "claude". */
  readonly bin?: string;
  /**
   * Args before the prompt. Defaults to `["--print"]` which puts Claude Code
   * into headless one-shot mode. Override for `--model`, `--output-format`,
   * or other CLI flags supported by your installed `claude` version.
   */
  readonly args?: ReadonlyArray<string>;
  /**
   * How the prompt reaches the binary.
   *
   * - `"stdin"` (default): prompt is piped on stdin. Avoids argv length
   *   limits and quoting hazards for large issue descriptions.
   * - `"argv"`: prompt is appended as the last positional argument. Use this
   *   if your `claude` CLI version requires the prompt as argv.
   */
  readonly promptDelivery?: "argv" | "stdin";
  /** Per-run timeout in milliseconds. Defaults to 30 minutes. */
  readonly timeoutMs?: number;
  /**
   * Extra env merged on top of process.env. Typical use: forward
   * `ANTHROPIC_API_KEY` (the orchestrator does not assume any auth model).
   */
  readonly extraEnv?: Readonly<Record<string, string>>;
}

/**
 * Subprocess wrapper around the `claude` CLI in headless mode (`--print`).
 *
 * Defaults assume `claude --print` reads the prompt on stdin. If your
 * installed Claude Code CLI requires the prompt as argv, set
 * `{ promptDelivery: "argv" }`. The orchestrator never inspects what the
 * agent does inside the workspace; pass any additional flags via `args`.
 */
export class ClaudeAgent extends SubprocessAgent {
  constructor(opts: ClaudeAgentOptions = {}) {
    super({
      name: "claude",
      bin: opts.bin ?? "claude",
      args: [...(opts.args ?? ["--print"])],
      promptDelivery: opts.promptDelivery ?? "stdin",
      timeoutMs: opts.timeoutMs ?? 30 * 60 * 1000,
      ...(opts.extraEnv !== undefined ? { extraEnv: opts.extraEnv } : {}),
    });
  }
}
