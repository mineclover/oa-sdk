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
      description: 'Filter generated tiers: all | keys | options | hooks. In --split mode lower tiers are emitted too, because the requested tier imports them.',
    },
    framework: {
      type: 'string',
      description: 'Target UI framework: react | vue | svelte (vue/svelte emit keys+options only; hooks are React-only)',
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
    const isVue = frameworkArg === 'vue' || frameworkArg === '@tanstack/vue-query'
    const isSvelte = frameworkArg === 'svelte' || frameworkArg === '@tanstack/svelte-query'
    if (isVue) {
      queryPackage = '@tanstack/vue-query'
      includeHooks = false
    } else if (isSvelte) {
      queryPackage = '@tanstack/svelte-query'
      includeHooks = false
    } else if (frameworkArg !== 'react' && frameworkArg !== '@tanstack/react-query') {
      queryPackage = frameworkArg
    }
    // Tier 3 is generated against React hook types (useQuery/UseQueryResult, ...). Vue and
    // Svelte need their own hook shapes (createQuery stores / refs), so refuse rather than
    // writing a file that cannot compile.
    if (tier === 'hooks' && (isVue || isSvelte)) {
      console.error(
        `오류: --tier hooks는 React 전용입니다. --framework ${isVue ? 'vue' : 'svelte'}에서는 --tier keys|options 또는 --tier all을 사용하세요.`,
      )
      throw new CliExitError(1)
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

      if (!outputArg && outputRouting) {
        keysPath = dispatcher.dispatch({ kind: 'keys' }).absolutePath
        queriesPath = dispatcher.dispatch({ kind: 'queries' }).absolutePath
        keysImport = dispatcher.resolveImport({ kind: 'queries' }, { kind: 'keys' })
        hooksPath = path.join(path.dirname(queriesPath), 'hooks.ts')
        queriesImport = `./${path.basename(queriesPath).replace(/\.tsx?$/, '.js')}`
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

      // Tiers are cumulative in split mode: queries.ts imports keys.js and hooks.ts imports
      // both, so a single-tier request still has to emit its dependencies to compile.
      artifactsToWrite.push({
        path: keysPath,
        kind: 'keys',
        content: generated.keysCode,
        sourceSpec: loadedSpec.path,
      })
      if (tier === 'all' || tier === 'options' || tier === 'hooks') {
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

      // combinedCode is self-contained for every tier: it inlines the keys and, for 'hooks', the options.
      // queriesCode and hooksCode are split-mode modules that import './keys.js' and './queries.js',
      // which a single combined file does not have.
      let content = tier === 'keys' ? generated.keysCode : generated.combinedCode

      // Ensure clientImport and typesImport are properly reflected in combined mode
      if (clientImport && !content.includes(clientImport)) {
        content = content.replace(
          /import type \{ JsonPrimitive(?:, Resolved)? \} from '@oa-sdk\/client'/,
          match => `${match}\nimport type { ApiClient } from '${clientImport}'`,
        )
      }
      if (typesImport && !content.includes(typesImport)) {
        const matches = new Set<string>()
        for (const match of content.matchAll(/\b([A-Z][a-zA-Z0-9]*(?:PathParams|QueryParams|QueryString|HeaderParams|Body|Response|Error))\b/g)) {
          if (match[1] !== 'Error' && match[1] !== 'TypeError' && match[1] !== 'SyntaxError') {
            matches.add(match[1]!)
          }
        }
        if (matches.size > 0) {
          const sorted = Array.from(matches).sort().join(', ')
          content = content.replace(
            /import type \{ JsonPrimitive(?:, Resolved)? \} from '@oa-sdk\/client'/,
            match => `${match}\nimport type { ${sorted} } from '${typesImport}'`,
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
