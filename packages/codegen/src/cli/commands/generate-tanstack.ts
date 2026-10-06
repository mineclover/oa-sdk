import * as path from 'node:path'
import type { Command, CommandArgValue, CommandContext } from '../lib/types.js'
import { optStr, bool } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { loadSpecDocumentAsync } from '../lib/load-spec.js'
import { loadOaConfig } from '../lib/config-loader.js'
import { companionImporterFrom, requireCompanion } from '../lib/companion-packages.js'
import { createPathDispatcher } from '../../routing/index.js'
import { MANIFEST_PRODUCERS, OaManifestManager, type WriteArtifactInput } from '../../routing/manifest-manager.js'

export const generateTanstackCommand: Command = {
  name: 'generate:tanstack',
  description: 'Generate TanStack Query v5 3-tier keys, options, and hooks from OpenAPI specification',
  options: {
    spec: {
      type: 'string',
      short: 's',
      required: true,
      description: 'Path to OpenAPI 3.1/3.2 specification file',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output directory for generated artifacts',
    },
    config: {
      type: 'string',
      short: 'c',
      description: 'Explicit path to oa.config.ts',
    },
    tier: {
      type: 'string',
      description: 'Filter generated tiers: all | keys | options | hooks',
    },
    framework: {
      type: 'string',
      description: 'Target UI framework: react | vue | svelte',
    },
    'types-import': {
      type: 'string',
      description: 'Module specifier for wire types',
    },
    'client-import': {
      type: 'string',
      description: 'Module specifier for client fetch SDK',
    },
    split: {
      type: 'boolean',
      description: 'Whether to split output into keys, queries, and hooks',
    },
  },
  async run(args, context) {
    const specArg = optStr(args, 'spec')
    if (!specArg) {
      console.error('오류: --spec <파일 경로> 옵션이 필요합니다')
      throw new CliExitError(1)
    }

    const { generateTanstackQuery } = await requireCompanion('generate:tanstack', {
      output: 'TanStack Query options',
      importer: companionImporterFrom(context),
    })

    const rootDir = (context as any)?.rootDir ?? context?.projectRoot ?? (context as any)?.cwd ?? process.cwd()

    let loadedSpec: Awaited<ReturnType<typeof loadSpecDocumentAsync>>
    try {
      loadedSpec = await loadSpecDocumentAsync(specArg, rootDir)
    } catch (err) {
      console.error(`오류: 스펙 파일 로드 실패: ${err instanceof Error ? err.message : String(err)}`)
      throw new CliExitError(1)
    }

    const configPath = optStr(args, 'config')
    const loadedConfig = await loadOaConfig({
      ...(configPath ? { configPath } : {}),
      ...(context?.cwd !== undefined ? { cwd: context.cwd } : {}),
      ...(context?.projectRoot !== undefined ? { explicitRoot: context.projectRoot } : {}),
    })

    const outputArg = optStr(args, 'output')
    const tierArg = optStr(args, 'tier') as 'all' | 'keys' | 'options' | 'hooks' | undefined
    const tier = tierArg ?? 'all'
    const frameworkArg = optStr(args, 'framework') ?? 'react'
    const typesImport = optStr(args, 'types-import')
    const clientImport = optStr(args, 'client-import')
    const split = bool(args, 'split')

    // Framework to query package resolution
    let queryPackage = '@tanstack/react-query'
    let includeHooks = true
    if (frameworkArg === 'vue' || frameworkArg === '@tanstack/vue-query') {
      queryPackage = '@tanstack/vue-query'
      includeHooks = false
    } else if (frameworkArg === 'svelte' || frameworkArg === '@tanstack/svelte-query') {
      queryPackage = '@tanstack/svelte-query'
      includeHooks = false
    } else if (frameworkArg !== 'react' && frameworkArg !== '@tanstack/react-query') {
      queryPackage = frameworkArg
    }
    if (tier === 'keys' || tier === 'options') {
      includeHooks = false
    } else if (tier === 'hooks') {
      includeHooks = true
    }

    // Output routing resolution
    const outputRouting = loadedConfig?.config?.product?.outputRouting ?? loadedConfig?.config?.outputRouting
    const dispatcher = createPathDispatcher(outputRouting, loadedConfig?.rootDir ?? rootDir)

    const manifestManager = new OaManifestManager(loadedConfig?.rootDir ?? rootDir)
    const artifactsToWrite: WriteArtifactInput[] = []

    if (split) {
      // Split mode: keys.ts, queries.ts, hooks.ts
      let keysPath: string
      let queriesPath: string
      let hooksPath: string
      let keysImport: string | undefined
      let queriesImport: string | undefined

      if (outputRouting) {
        keysPath = dispatcher.dispatch({ kind: 'keys' }).absolutePath
        queriesPath = dispatcher.dispatch({ kind: 'queries' }).absolutePath
        keysImport = dispatcher.resolveImport({ kind: 'queries' }, { kind: 'keys' })
        hooksPath = path.join(path.dirname(queriesPath), 'hooks.ts')
        queriesImport = './queries.js'
      } else {
        const baseOutDir = outputArg
          ? path.resolve(rootDir, outputArg)
          : path.resolve(rootDir, 'src/api/generated')
        keysPath = path.join(baseOutDir, 'keys.ts')
        queriesPath = path.join(baseOutDir, 'queries.ts')
        hooksPath = path.join(baseOutDir, 'hooks.ts')
        keysImport = './keys.js'
        queriesImport = './queries.js'
      }

      const generated = generateTanstackQuery(loadedSpec.document, {
        queryPackage,
        typesImport,
        clientImport,
        keysImport,
        queriesImport,
        includeHooks,
        tier,
        basePath: loadedSpec.path,
      })

      if (tier === 'all' || tier === 'keys') {
        artifactsToWrite.push({
          path: keysPath,
          kind: 'keys',
          content: generated.keysCode,
          sourceSpec: loadedSpec.path,
        })
      }
      if (tier === 'all' || tier === 'options') {
        artifactsToWrite.push({
          path: queriesPath,
          kind: 'queries',
          content: generated.queriesCode,
          sourceSpec: loadedSpec.path,
        })
      }
      if ((tier === 'all' || tier === 'hooks') && includeHooks && generated.hooksCode) {
        artifactsToWrite.push({
          path: hooksPath,
          kind: 'queries',
          content: generated.hooksCode,
          sourceSpec: loadedSpec.path,
        })
      }
    } else {
      // Combined mode: single file
      let targetPath: string
      if (outputArg) {
        targetPath = outputArg.endsWith('.ts')
          ? path.resolve(rootDir, outputArg)
          : path.join(path.resolve(rootDir, outputArg), 'tanstack-query.ts')
      } else if (outputRouting) {
        targetPath = dispatcher.dispatch({ kind: 'queries' }).absolutePath
      } else {
        targetPath = path.resolve(rootDir, 'src/api/generated/tanstack-query.ts')
      }

      const generated = generateTanstackQuery(loadedSpec.document, {
        queryPackage,
        typesImport,
        clientImport,
        includeHooks,
        tier,
        basePath: loadedSpec.path,
      })

      let content = generated.combinedCode
      if (tier === 'keys') content = generated.keysCode
      else if (tier === 'options') content = generated.queriesCode
      else if (tier === 'hooks') content = generated.hooksCode

      // Ensure clientImport and typesImport are properly reflected in combined mode
      if (clientImport && !content.includes(clientImport)) {
        content = content.replace(
          /import type \{ JsonPrimitive, Resolved \} from '@oa-sdk\/client'/,
          `import type { JsonPrimitive, Resolved } from '@oa-sdk/client'\nimport type { ApiClient } from '${clientImport}'`,
        )
      }
      if (typesImport && !content.includes(typesImport)) {
        const matches = new Set<string>()
        for (const match of content.matchAll(/\b([A-Z][a-zA-Z0-9]*(?:PathParams|QueryParams|QueryString|HeaderParams|Body|Response|ClientError))\b/g)) {
          matches.add(match[1]!)
        }
        if (matches.size > 0) {
          const sorted = Array.from(matches).sort().join(', ')
          content = content.replace(
            /import type \{ JsonPrimitive, Resolved \} from '@oa-sdk\/client'/,
            `import type { JsonPrimitive, Resolved } from '@oa-sdk/client'\nimport type { ${sorted} } from '${typesImport}'`,
          )
        }
      }

      artifactsToWrite.push({
        path: targetPath,
        kind: 'queries',
        content,
        sourceSpec: loadedSpec.path,
      })
    }

    // Recorded as this command's artifacts, which `oa-gen generate` never prunes.
    const { written, skipped } = await manifestManager.writeArtifacts(
      artifactsToWrite.map(artifact => ({ ...artifact, producer: MANIFEST_PRODUCERS.generateTanstack })),
    )

    console.log(`\n🚀 [oa-gen generate:tanstack] TanStack Query v5 Artifact Generation Complete`)
    for (const art of written) {
      console.log(`   ✅ Written: ${art}`)
    }
    for (const art of skipped) {
      console.log(`   ⚡️ Skipped (unchanged): ${art}`)
    }
  },
}

export default generateTanstackCommand
