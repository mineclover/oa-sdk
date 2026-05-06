import type { Agent, AgentInput, AgentResult } from "../types.js";

/**
 * Deterministic agent used for tests, dry-runs, and end-to-end smoke tests
 * of the orchestrator wiring. It does no I/O outside its workspace and does
 * not spawn subprocesses.
 */
export class EchoAgent implements Agent {
  readonly name = "echo";

  async run(input: AgentInput): Promise<AgentResult> {
    if (input.signal?.aborted === true) {
      return {
        status: "cancelled",
        summary: "EchoAgent cancelled before run.",
      };
    }
    const lines: string[] = [
      `EchoAgent received issue ${input.issue.iid}: ${input.issue.title}`,
      `Workspace: ${input.workspacePath}`,
      `Prompt length: ${input.prompt.length} chars`,
    ];
    return {
      status: "succeeded",
      summary: lines.join("\n"),
    };
  }
}
