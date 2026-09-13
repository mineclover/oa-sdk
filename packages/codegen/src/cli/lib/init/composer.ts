import type {
  TargetProfile,
  TargetGenerateOptions,
  RecommendedDependencies,
  OutputRoutingPreset,
} from './types.js'
import type { ArchetypeProfile, ArchetypeGenerateOptions } from './archetypes/types.js'

/**
 * Format a JavaScript/TypeScript object literal into formatted multi-line string.
 */
function formatObject(obj: Record<string, unknown>, indentLevel = 1): string {
  const indent = '  '.repeat(indentLevel)
  const innerIndent = '  '.repeat(indentLevel + 1)
  const entries: string[] = []

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      if (value.length === 0) {
        entries.push(`${innerIndent}${key}: [],`)
      } else if (value.every((v) => typeof v === 'string')) {
        const formattedArray = value.map((v) => `'${v}'`).join(', ')
        entries.push(`${innerIndent}${key}: [${formattedArray}],`)
      } else {
        const formattedItems = value.map((v) => {
          if (typeof v === 'object' && v !== null) {
            const itemIndent = '  '.repeat(indentLevel + 2)
            return `${itemIndent}{\n${formatObject(v as Record<string, unknown>, indentLevel + 2)}\n${itemIndent}}`
          }
          return `${'  '.repeat(indentLevel + 2)}${JSON.stringify(v)}`
        })
        entries.push(`${innerIndent}${key}: [\n${formattedItems.join(',\n')}\n${innerIndent}],`)
      }
    } else if (typeof value === 'object' && value !== null) {
      entries.push(`${innerIndent}${key}: {\n${formatObject(value as Record<string, unknown>, indentLevel + 1)}\n${innerIndent}},`)
    } else if (typeof value === 'string') {
      entries.push(`${innerIndent}${key}: '${value}',`)
    } else {
      entries.push(`${innerIndent}${key}: ${value},`)
    }
  }

  return entries.join('\n')
}

/**
 * Returns output routing configuration block for selected preset.
 */
export function getOutputRoutingSnippet(preset: OutputRoutingPreset = 'default'): Record<string, unknown> {
  switch (preset) {
    case 'fsd':
      return {
        pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
        rules: [
          {
            tag: ['common', 'shared', 'auth', 'system'],
            target: 'src/shared/api/{tag}.{kind}.ts',
          },
          {
            kind: 'schemas',
            target: 'src/shared/api/schemas.ts',
          },
        ],
        byKind: {
          client: 'src/shared/api/client.ts',
        },
      }
    case 'monorepo':
      return {
        byKind: {
          contract: 'packages/contracts/src/api.contract.ts',
          guards: 'packages/contracts/src/guards.ts',
          schemas: 'packages/contracts/src/schemas.ts',
          client: 'packages/client-sdk/src/index.ts',
          queries: 'apps/web/src/api/queries.ts',
          keys: 'apps/web/src/api/keys.ts',
        },
      }
    case 'by-kind':
      return {
        byKind: {
          contract: 'src/contracts/{tag}.contract.ts',
          client: 'src/client/{tag}.client.ts',
          queries: 'src/queries/{tag}.queries.ts',
          keys: 'src/keys/{tag}.keys.ts',
          guards: 'src/guards/{tag}.guards.ts',
          schemas: 'src/schemas/{tag}.schemas.ts',
        },
      }
    case 'default':
    default:
      return {
        pattern: 'src/api/{tag}/{tag}.{kind}.ts',
      }
  }
}

/**
 * Generates the complete, dual-layer oa.config.ts content by composing
 * the Framework Target with the Lifecycle Archetype.
 */
export function composeInitConfig(
  target: TargetProfile,
  archetype: ArchetypeProfile,
  options: TargetGenerateOptions,
): string {
  const schemaEntry = options.detectedSchema?.filePath ?? 'openapi.yaml'
  const archetypeOptions: ArchetypeGenerateOptions = {
    ...options,
    archetypeId: archetype.id,
  }

  const snippet = archetype.getArchetypeConfig(archetypeOptions)

  // Determine spec target properties
  const specObj: Record<string, unknown> = {
    id: `${target.id}-api`,
    schemaEntry,
    outDir: './src/generated',
    target: target.id,
    ...(snippet.specFields ?? {}),
  }

  // Compose Shared Platform Core SSOT
  const coreConfig: Record<string, unknown> = {
    dialect: {
      oasVersion: '3.2.0',
      jsonSchemaDialect: 'draft-2020-12',
      canonicalProjection: true,
    },
    contracts: {
      pureHandlers: true,
      contractName: 'ApiHandlers',
      banner: true,
      ...(archetype.id === 'microservice' ? { outDir: './src/contracts' } : {}),
    },
    client: {
      enabled: true,
      wireFormatSafety: archetype.id !== 'mvp',
      ...(archetype.id === 'mvp' ? { outDir: './src/client' } : {}),
    },
    typegen: {
      resolveSymbolCycles: archetype.id !== 'mvp',
      discriminatedUnions: true,
    },
    gates: {
      driftCheck: archetype.id !== 'mvp',
      failOnBreaking: archetype.id === 'enterprise',
      ...(archetype.id === 'enterprise' ? { baseRef: 'origin/main' } : {}),
      preflightLint: archetype.id === 'mvp' ? 'warn' : 'error',
    },
  }

  // Compose Product-Specific Domain Layer
  const productConfig: Record<string, unknown> = {
    archetype: archetype.id,
    framework: target.id,
    runtime: options.runtime,
    jitSchema: target.id === 'fastify',
    zeroCopy: target.id === 'elysia',
    outputRouting: getOutputRoutingSnippet(options.routing ?? 'default'),
    ...(archetype.id === 'enterprise'
      ? {
          personas: {
            enforceCoverage: true,
            minCoverageRatio: 0.8,
          },
        }
      : {}),
  }

  return `import { defineConfig } from '@oa-sdk/codegen'

export default defineConfig({
  rootDir: '.',
  archetype: '${archetype.id}',
  specs: [
    {
${formatObject(specObj, 2)}
    },
  ],
  // Shared Platform Core SSOT
  core: {
${formatObject(coreConfig, 1)}
  },
  // Product-Specific Domain Extensions
  product: {
${formatObject(productConfig, 1)}
  },
})
`
}

/**
 * Composes recommended package.json scripts with strict runtime isolation.
 */
export function composeInitScripts(
  target: TargetProfile,
  archetype: ArchetypeProfile,
  options: TargetGenerateOptions,
): Record<string, string> {
  const targetScripts = target.getRecommendedScripts(options)
  const archetypeScripts = archetype.getRecommendedScripts({
    ...options,
    archetypeId: archetype.id,
  })

  const merged: Record<string, string> = {
    ...targetScripts,
    ...archetypeScripts,
  }

  // STRICT RUNTIME ISOLATION:
  // If runtime is Bun, sanitize all scripts: strictly NO tsx, vitest, or node tooling
  if (options.runtime === 'bun') {
    for (const [key, cmd] of Object.entries(merged)) {
      let sanitized = cmd
      if (sanitized.includes('vitest run')) {
        sanitized = sanitized.replace(/vitest run/g, 'bun test')
      } else if (sanitized.includes('vitest')) {
        sanitized = sanitized.replace(/vitest/g, 'bun test')
      }
      if (sanitized.startsWith('oa-gen ')) {
        sanitized = `bun x ${sanitized}`
      }
      merged[key] = sanitized
    }
  }

  return merged
}

/**
 * Composes recommended dependencies and devDependencies with strict runtime isolation.
 */
export function composeInitDependencies(
  target: TargetProfile,
  archetype: ArchetypeProfile,
  options: TargetGenerateOptions,
): RecommendedDependencies {
  const targetDeps = target.getRecommendedDependencies(options)
  const archetypeDeps = archetype.getRecommendedDependencies({
    ...options,
    archetypeId: archetype.id,
  })

  const dependencies: Record<string, string> = {
    ...(targetDeps.dependencies ?? {}),
    ...(archetypeDeps.dependencies ?? {}),
  }

  const devDependencies: Record<string, string> = {
    ...(targetDeps.devDependencies ?? {}),
    ...(archetypeDeps.devDependencies ?? {}),
  }

  // STRICT RUNTIME ISOLATION GUARANTEE:
  if (options.runtime === 'bun') {
    // Prohibit all Node tooling in Bun projects
    delete devDependencies['tsx']
    delete devDependencies['nodemon']
    delete devDependencies['@types/node']
    delete devDependencies['vitest']

    // Ensure Bun native types are present
    devDependencies['@types/bun'] = devDependencies['@types/bun'] ?? 'latest'
  } else {
    // Prohibit Bun tooling in Node projects
    delete devDependencies['@types/bun']
    if (devDependencies['typescript'] && !devDependencies['@types/node']) {
      devDependencies['@types/node'] = '^20.0.0'
    }
  }

  return {
    dependencies,
    devDependencies,
  }
}

/**
 * Composes all package patches (scripts, dependencies, devDependencies).
 */
export function composeInitPackagePatches(
  target: TargetProfile,
  archetype: ArchetypeProfile,
  options: TargetGenerateOptions,
): {
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
} {
  const scripts = composeInitScripts(target, archetype, options)
  const deps = composeInitDependencies(target, archetype, options)

  return {
    scripts,
    dependencies: deps.dependencies ?? {},
    devDependencies: deps.devDependencies,
  }
}
