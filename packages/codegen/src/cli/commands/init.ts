import type { Command } from '../lib/types.js'
import { bool, optStr } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { runInit } from '../lib/init/index.js'

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
    }
  },
}

export const initCommand = init
