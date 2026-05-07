import { Liquid } from "liquidjs";

import type { Issue, PromptBuilder, PromptInput } from "./types.js";

export interface LiquidPromptBuilderOptions {
  /**
   * If `true`, also expose Symphony-style aliases on the rendering context so
   * existing Symphony WORKFLOW.md files render unchanged. Defaults to `true`.
   *
   * Aliases:
   *   - `issue.identifier` → `"#${issue.iid}"` (Symphony §4.1.1's `identifier`
   *     is project-prefixed for Linear, e.g. `"ABC-123"`; for GitLab the
   *     equivalent display form is `#42`, which also auto-links in notes).
   *   - `attempt` → `null` on the first attempt within a turn, integer
   *     otherwise (Symphony §5.4 contract).
   */
  readonly symphonyAliases?: boolean;
}

/**
 * Liquid-compatible prompt template renderer in strict mode.
 *
 * - Unknown variables fail rendering (`strictVariables: true`).
 * - Unknown filters fail rendering (`strictFilters: true`).
 *
 * This matches Symphony SPEC §5.4. Operator typos surface immediately rather
 * than producing silently-empty interpolations.
 */
export class LiquidPromptBuilder implements PromptBuilder {
  readonly #engine: Liquid;
  readonly #template: string;
  readonly #symphonyAliases: boolean;

  constructor(template: string, opts: LiquidPromptBuilderOptions = {}) {
    this.#engine = new Liquid({
      strictVariables: true,
      strictFilters: true,
    });
    this.#template = template;
    this.#symphonyAliases = opts.symphonyAliases ?? true;
  }

  async build(input: PromptInput): Promise<string> {
    const ctx = this.buildContext(input);
    return await this.#engine.parseAndRender(this.#template, ctx);
  }

  private buildContext(input: PromptInput): Record<string, unknown> {
    const issueCtx: Record<string, unknown> = { ...input.issue };
    if (this.#symphonyAliases) {
      issueCtx.identifier = `#${input.issue.iid}`;
    }
    const attempt =
      this.#symphonyAliases && input.attempt <= 1 ? null : input.attempt;

    const ctx: Record<string, unknown> = {
      issue: issueCtx,
      attempt,
      turn_number: input.turnNumber,
    };
    if (input.previousTurnResult !== undefined) {
      ctx.previous_turn_result = input.previousTurnResult;
    }
    return ctx;
  }
}

/** Convenience: render a single template without instantiating a class. */
export async function renderPromptOnce(
  template: string,
  input: PromptInput,
  opts: LiquidPromptBuilderOptions = {},
): Promise<string> {
  const builder = new LiquidPromptBuilder(template, opts);
  return await builder.build(input);
}

/** Default minimal template used when WORKFLOW.md body is blank — matches Symphony §5.4. */
export const DEFAULT_PROMPT_TEMPLATE = "You are working on a GitLab issue.";

/** Re-export for convenience when wiring tests. */
export type { Issue };
