import { SubprocessAgent } from "./subprocess.js";

export interface CodexAgentOptions {
  /** Override the binary if it is not on PATH. Defaults to "codex". */
  readonly bin?: string;
  /** Extra args inserted before the subcommand (e.g. `--config foo=bar`). */
  readonly globalArgs?: ReadonlyArray<string>;
  /** Subcommand to run. Defaults to "exec" (one-shot non-interactive mode). */
  readonly subcommand?: string;
  /** Per-run timeout in milliseconds. Defaults to 30 minutes. */
  readonly timeoutMs?: number;
  /** Extra env merged on top of process.env and per-run env. */
  readonly extraEnv?: Readonly<Record<string, string>>;
}

/**
 * Subprocess wrapper around the Codex CLI.
 *
 * Phase A invokes `codex exec <prompt>` in the workspace and captures
 * stdout/stderr. Phase B may switch to `codex app-server` for streaming
 * events and multi-turn continuation, mirroring Symphony SPEC §10. The
 * Agent interface hides which transport is used.
 */
export class CodexAgent extends SubprocessAgent {
  constructor(opts: CodexAgentOptions = {}) {
    const args = [...(opts.globalArgs ?? []), opts.subcommand ?? "exec"];
    super({
      name: "codex",
      bin: opts.bin ?? "codex",
      args,
      promptDelivery: "argv",
      timeoutMs: opts.timeoutMs ?? 30 * 60 * 1000,
      ...(opts.extraEnv !== undefined ? { extraEnv: opts.extraEnv } : {}),
    });
  }
}
