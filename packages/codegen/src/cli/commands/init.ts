import type { Command } from '../lib/types.js'
import { bool, optStr } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { runInit } from '../lib/init/index.js'
import type { ContractBaselineResult, DependencySection, UninstallableOaSdkEntry } from '../lib/init/index.js'

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
    }

    if (result.contractBaseline) console.log(describeContractBaseline(result.contractBaseline))
  },
}

/**
 * One line on the contract baseline: what init did, and, when the gate cannot run yet, what makes
 * it run. The scripts are named as the enterprise archetype adds them.
 */
function describeContractBaseline(baseline: ContractBaselineResult): string {
  switch (baseline.status) {
    case 'created':
      return `📌 Contract baseline: created ${baseline.path} from ${baseline.specPath}; commit it. The "diff" script fails on changes that break it, and "baseline:update" moves it to the spec when you release.`
    case 'exists':
      return `📌 Contract baseline: kept the existing ${baseline.path}`
    case 'planned':
      return `🔍 [dry-run] contract baseline would be created at ${baseline.path} from ${baseline.specPath}`
    case 'not-created':
      return `⚠️ Contract baseline ${baseline.path} not created: ${baseline.reason}. Run the "baseline:update" script once the spec loads; "diff" and "ci:gate" need it.`
  }
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
