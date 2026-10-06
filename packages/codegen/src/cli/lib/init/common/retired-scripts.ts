import { z } from 'zod'

/**
 * A package.json script that earlier releases of `oa-gen init` wrote and the current one does not:
 * it failed as written, or only repeated the `generate` script.
 */
interface RetiredInitScript {
  /** The script name. */
  name: string
  /** Every command an earlier init wrote under that name, on Node and on Bun. */
  commands: readonly string[]
  /** Why the current init no longer writes it. */
  reason: string
}

const GENERATE_IGNORES_TARGET = 'oa-gen generate ignores --target, so it only repeats the "generate" script'

/**
 * The scripts earlier releases of `oa-gen init` wrote and the current one does not write, with the
 * exact commands they wrote. A script is matched on its command as well as its name, so a script
 * the project wrote itself under one of these names is never reported.
 */
const RETIRED_INIT_SCRIPTS: readonly RetiredInitScript[] = [
  {
    name: 'generate:router',
    commands: [
      'oa-gen generate --target fastify',
      'oa-gen generate --target express',
      'oa-gen generate --target hono',
      'bun x oa-gen generate --target hono',
      'bun x oa-gen generate --target elysia',
    ],
    reason: GENERATE_IGNORES_TARGET,
  },
  {
    name: 'generate:client',
    commands: ['oa-gen generate --target client', 'bun x oa-gen generate --target client'],
    reason: GENERATE_IGNORES_TARGET,
  },
  {
    name: 'generate:contract',
    commands: ['oa-gen generate --target generic', 'bun x oa-gen generate --target generic'],
    reason: GENERATE_IGNORES_TARGET,
  },
  {
    name: 'test:contract',
    commands: ['vitest run src/__tests__/contracts', 'bun test src/__tests__/contracts'],
    reason: 'it runs contract tests that oa-gen init does not write',
  },
  {
    name: 'audit:wire',
    commands: ['oa-gen audit:shape --strict', 'bun x oa-gen audit:shape --strict'],
    reason: 'oa-gen audit:shape has no --strict option',
  },
  {
    name: 'audit:csp',
    commands: ['oa-gen audit:csp --bundle ./dist', 'bun x oa-gen audit:csp --bundle ./dist'],
    reason: 'it audits a ./dist guard bundle that the scaffold does not build',
  },
  {
    name: 'audit:shape',
    commands: ['oa-gen audit:shape --fail-on-unsupported', 'bun x oa-gen audit:shape --fail-on-unsupported'],
    reason: 'oa-gen audit:shape needs --source or --bundle',
  },
  {
    name: 'personas:check',
    commands: ['oa-gen personas:check', 'bun x oa-gen personas:check'],
    reason: 'oa-gen has no personas:check command',
  },
  {
    name: 'lint:spec',
    commands: [
      'oa-gen lint --categories structure,refs,components,semantics',
      'bun x oa-gen lint --categories structure,refs,components,semantics',
    ],
    reason: 'oa-gen lint needs --spec and has no "semantics" category',
  },
  {
    name: 'diff',
    commands: [
      'oa-gen diff --base origin/main --head HEAD --fail-on-breaking',
      'bun x oa-gen diff --base origin/main --head HEAD --fail-on-breaking',
    ],
    reason: 'oa-gen diff compares two spec files, not git refs',
  },
  {
    name: 'ci:gate',
    commands: [
      'oa-gen diff --base origin/main --fail-on-breaking && oa-gen validate --require-32',
      'bun x oa-gen diff --base origin/main --fail-on-breaking && bun x oa-gen validate --require-32',
    ],
    reason: 'oa-gen diff compares two spec files, not a git ref, and needs --head',
  },
]

/**
 * A script of package.json (after the patch) that an earlier `oa-gen init` wrote and the current
 * one does not, with what to do about it: `remove` it, or `replace` its command with the one the
 * current init writes under the same name, which the patch did not apply (no `--force`).
 */
export interface RetiredInitScriptEntry {
  name: string
  command: string
  reason: string
  fix: { action: 'remove' } | { action: 'replace'; replacement: string }
}

const ManifestScripts = z.object({ scripts: z.record(z.string(), z.unknown()).optional() })

/**
 * The scripts of `packageJson` (the text of a package.json) that an earlier `oa-gen init` wrote
 * and that this one no longer writes. init never removes a script and, without `--force`, keeps a
 * script whose name it writes again, so a rerun on the package.json of an earlier init leaves
 * them in place. `written` are the scripts this run of init writes: one of them under the same
 * name is what replaces the retired command; the others are to be removed.
 *
 * A JSON value other than an object with a script map has no scripts; text that is not JSON throws.
 */
export function findRetiredInitScripts(
  packageJson: string,
  written: Readonly<Record<string, string>>,
): RetiredInitScriptEntry[] {
  const manifest = ManifestScripts.safeParse(JSON.parse(packageJson))
  if (!manifest.success) return []
  const scripts = manifest.data.scripts ?? {}
  const entries: RetiredInitScriptEntry[] = []
  for (const retired of RETIRED_INIT_SCRIPTS) {
    const command = scripts[retired.name]
    if (typeof command !== 'string' || !retired.commands.includes(command)) continue
    const replacement = Object.hasOwn(written, retired.name) ? written[retired.name] : undefined
    entries.push({
      name: retired.name,
      command,
      reason: retired.reason,
      fix: replacement === undefined ? { action: 'remove' } : { action: 'replace', replacement },
    })
  }
  return entries
}
