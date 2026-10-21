import type { Command } from '../lib/types.js'
import { bool, optStr } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { runInit } from '../lib/init/index.js'
import type {
  ContractBaselineResult,
  DependencySection,
  PatchAction,
  RetiredInitScriptEntry,
  UninstallableOaSdkEntry,
} from '../lib/init/index.js'

export const init: Command = {
  name: 'init',
  description: 'Target-separated onboarding engine: generates oa.config.ts and configures runtime scripts',
  options: {
    target: {
      type: 'string',
      short: 't',
      description: 'Target framework: fastify | elysia | hono | express | nestjs | generic',
    },
    archetype: {
      type: 'string',
      short: 'a',
      description: 'Lifecycle archetype preset: mvp | microservice | enterprise',
    },
    routing: {
      type: 'string',
      short: 'r',
      description: 'Output path routing preset: default | fsd | monorepo | by-kind',
    },
    cwd: {
      type: 'string',
      description: 'Target project directory (default: current working directory)',
    },
    spec: {
      type: 'string',
      short: 's',
      description: 'OpenAPI or TypeSpec schema entrypoint path',
    },
    yes: {
      type: 'boolean',
      short: 'y',
      description: 'Non-interactive mode, accepts all defaults automatically',
    },
    force: {
      type: 'boolean',
      short: 'f',
      description: 'Overwrite existing oa.config.ts and conflicting scripts',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Preview planned changes without writing to disk',
    },
  },
  async run(args, context) {
    const cwd = optStr(args, 'cwd') ?? context?.cwd ?? process.cwd()
    const target = optStr(args, 'target')
    const archetype = optStr(args, 'archetype')
    const routing = optStr(args, 'routing')
    const spec = optStr(args, 'spec')
    const yes = bool(args, 'yes')
    const force = bool(args, 'force')
    const dryRun = bool(args, 'dry-run')

    if (archetype && !['mvp', 'microservice', 'enterprise'].includes(archetype.toLowerCase().trim())) {
      console.error(`❌ Invalid archetype: "${archetype}". Allowed values: mvp, microservice, enterprise`)
      throw new CliExitError(1)
    }

    if (routing && !['default', 'fsd', 'monorepo', 'by-kind'].includes(routing.toLowerCase().trim())) {
      console.error(`❌ Invalid routing preset: "${routing}". Allowed values: default, fsd, monorepo, by-kind`)
      throw new CliExitError(1)
    }

    console.log('🚀 Initializing @oa-sdk onboarding...')

    const result = await runInit({
      cwd,
      target,
      archetype,
      routing,
      spec,
      yes,
      force,
      dryRun,
    })

    console.log(`\n✅ Target framework selected: ${result.targetId} (runtime: ${result.runtime})`)
    console.log(`🎯 Lifecycle archetype preset: ${result.archetypeId}`)
    if (result.routing) {
      console.log(`🗂️ Output path routing preset: ${result.routing}`)
    }
    if (result.detectedSchema) {
      console.log(`📄 Schema entrypoint: ${result.detectedSchema.filePath} (${result.detectedSchema.description})`)
    }
    if (dryRun) {
      console.log(`🔍 [dry-run] oa.config.ts would be generated at: ${result.configPath}`)
    } else if (result.configFileCreated) {
      console.log(`📝 Generated: ${result.configPath}`)
    } else {
      console.log(`ℹ️ Existing config retained: ${result.configPath}`)
    }

    if (result.patchResult) {
      console.log(`📦 package.json patches (${result.patchResult.filePath ?? 'package.json'}):`)
      for (const s of result.patchResult.scripts) {
        console.log(`   - script "${s.key}": ${s.action} (${s.after})`)
      }
      for (const d of result.patchResult.devDependencies) {
        console.log(`   - devDependency "${d.key}": ${d.action} (${d.after})`)
      }
      for (const d of result.patchResult.dependencies) {
        console.log(`   - dependency "${d.key}": ${d.action} (${d.after})`)
      }
      const uninstallable = result.uninstallableEntries ?? []
      for (const p of result.unavailablePackages ?? []) {
        // An entry package.json already has is reported below, with what to do about it.
        if (uninstallable.some(entry => entry.name === p.name)) continue
        console.log(`   - devDependency "${p.name}": not added (${p.reason})`)
      }
      if (uninstallable.length > 0) {
        console.log(`⚠️ package.json lists @oa-sdk packages this project cannot install where it lives${dryRun ? ' (after the planned patch)' : ''}:`)
        for (const entry of uninstallable) console.log(`   - ${describeUninstallableEntry(entry)}`)
      }
      const retired = result.retiredScripts ?? []
      if (retired.length > 0) {
        console.log(`⚠️ package.json keeps scripts an earlier oa-gen init wrote, which this one no longer writes${dryRun ? ' (after the planned patch)' : ''}:`)
        for (const script of retired) console.log(`   - ${describeRetiredScript(script)}`)
      }
    }

    if (result.contractBaseline) {
      console.log(describeContractBaseline(result.contractBaseline, result.patchResult?.scripts))
    }

    if (!dryRun) {
      console.log('\n📦 Next steps:')
      console.log('   1. Install the dependencies listed above (pnpm install, npm install or bun install).')
      console.log('   2. Run the generated scripts, starting with `generate` (pnpm run generate / npm run generate).')
    }
  },
}

/** The scripts of the enterprise archetype that use the contract baseline. */
const BASELINE_SCRIPTS = ['diff', 'baseline:update', 'ci:gate']

/**
 * One line on the contract baseline: what init did, and, when the gate cannot run yet or was not
 * added, what makes it run. `scripts` is the patch of the package.json scripts, if the project
 * has a package.json.
 */
function describeContractBaseline(baseline: ContractBaselineResult, scripts: readonly PatchAction[] | undefined): string {
  let summary: string
  switch (baseline.status) {
    case 'no-gate':
      return `⚠️ Contract baseline ${baseline.path} and the "lint:spec", "diff", "baseline:update" and "ci:gate" scripts not added: ${baseline.reason}.`
    case 'created':
      summary = `📌 Contract baseline: created ${baseline.path} from ${baseline.specPath}; commit it.`
      break
    case 'exists':
      summary = `📌 Contract baseline: kept the existing ${baseline.path}.`
      break
    case 'planned':
      summary = `🔍 [dry-run] contract baseline would be created at ${baseline.path} from ${baseline.specPath}.`
      break
    case 'not-created':
      summary = `⚠️ Contract baseline ${baseline.path} not created: ${baseline.reason}.`
      break
  }
  const note = baselineScriptsNote(baseline.status, scripts)
  return note === undefined ? summary : `${summary} ${note}`
}

/**
 * What the scripts that use the contract baseline do with it, as package.json has them: the
 * scripts the archetype adds; the project's own commands under some of those names, which the
 * patch keeps without --force (an earlier init's `diff` and `ci:gate`, say), so the gate is not
 * set up until they are replaced; or none at all, without a package.json.
 */
function baselineScriptsNote(
  status: 'created' | 'exists' | 'planned' | 'not-created',
  scripts: readonly PatchAction[] | undefined,
): string | undefined {
  if (scripts === undefined) return 'There is no package.json, so init added none of the scripts that use it.'

  const kept = BASELINE_SCRIPTS.filter(name => scripts.some(script => script.key === name && script.action === 'skipped'))
  if (kept.length > 0) {
    const replace = `package.json keeps its own ${quotedList(kept)} ${kept.length === 1 ? 'script' : 'scripts'}, which init did not replace; ` +
      `replace ${kept.length === 1 ? 'it with the command' : 'them with the commands'} listed above`
    return status === 'not-created'
      ? `${replace}, then run "baseline:update" once the spec loads.`
      : `${replace} to gate the spec against it.`
  }

  switch (status) {
    case 'created':
      return 'The "diff" script fails on changes that break it, and "baseline:update" moves it to the spec when you release.'
    case 'not-created':
      return 'Run the "baseline:update" script once the spec loads; "diff" and "ci:gate" need it.'
    default:
      return undefined
  }
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
function quotedList(names: readonly string[]): string {
  const quoted = names.map(name => `"${name}"`)
  return quoted.length === 1 ? quoted[0]! : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
}

/** One line for a script an earlier init wrote, ending with what to do about it. */
function describeRetiredScript(script: RetiredInitScriptEntry): string {
  const fix = script.fix.action === 'remove' ? 'remove it' : `replace it with "${script.fix.replacement}"`
  return `script "${script.name}": "${script.command}" (${script.reason}); ${fix}`
}

const SECTION_LABELS: Record<DependencySection, string> = {
  dependencies: 'dependency',
  devDependencies: 'devDependency',
  optionalDependencies: 'optionalDependency',
  peerDependencies: 'peerDependency',
}

/** One line for an entry of package.json the project cannot install, ending with what to do about it. */
function describeUninstallableEntry(entry: UninstallableOaSdkEntry): string {
  const fix = entry.fix.action === 'remove'
    ? 'remove it'
    : entry.fix.replacement === undefined
      ? 'replace it with a version published to the registry, or remove it'
      : `replace it with "${entry.fix.replacement}"`
  return `${SECTION_LABELS[entry.section]} "${entry.name}": "${entry.specifier}" cannot be installed here (${entry.reason}); ${fix}`
}

export const initCommand = init
