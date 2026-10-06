import * as path from 'node:path'
import { loadOaConfig, profileTargetArtifactPaths, resolveProfileTarget } from '../../config-loader.js'
import type { DetectedSchemaItem } from '../types.js'
import { scriptPath } from './scripts.js'

/** A spec target of the oa.config.ts a project already has, as `oa-gen init` reads it. */
export interface ExistingSpecTarget {
  id: string
  /** Its `schemaEntry`, as a path from the project root (where package.json scripts run). */
  schemaEntry: string
  /** The absolute path of its `schemaEntry`. */
  schemaEntryPath: string
  /** The absolute paths of the OpenAPI and JSON Schema documents `oa-gen generate` writes for it. */
  artifactPaths: string[]
}

/** The oa.config.ts a project already has: its spec targets, or why it did not load. */
export type ExistingConfig =
  | { status: 'loaded'; specTargets: ExistingSpecTarget[] }
  | { status: 'unloadable'; reason: string }

/** The spec entry point the scripts `oa-gen init` writes run on, or why it cannot tell which. */
export type ScriptSpecEntry = { schema: DetectedSchemaItem } | { unavailable: string }

/** Loads the oa.config.ts at `configPath` of the project at `cwd`, as `oa-gen generate` does. */
export async function readExistingConfig(cwd: string, configPath: string): Promise<ExistingConfig> {
  try {
    const loaded = await loadOaConfig({ configPath, cwd })
    if (loaded === null) return { status: 'unloadable', reason: `${configPath} was not found` }
    const specTargets = (loaded.config.specs ?? []).map((target): ExistingSpecTarget => {
      const resolved = resolveProfileTarget(target, loaded.rootDir)
      const { openApiPath, jsonSchemaPath } = profileTargetArtifactPaths(resolved.resolvedOutDir, target.id)
      return {
        id: target.id,
        schemaEntry: scriptPath(path.relative(cwd, resolved.resolvedSchemaEntry)),
        schemaEntryPath: resolved.resolvedSchemaEntry,
        artifactPaths: [openApiPath, jsonSchemaPath],
      }
    })
    return { status: 'loaded', specTargets }
  } catch (error) {
    return { status: 'unloadable', reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The spec entry point for the scripts `oa-gen init` writes when it keeps the project's
 * oa.config.ts: the `schemaEntry` of its spec target, the spec `oa-gen generate` builds from, and
 * never a file detected elsewhere in the project. When its spec targets have different entry
 * points, `spec` (`--spec`) names the one to use; a `spec` that is none of them is an error, since
 * the scripts would check a spec the configuration does not build.
 */
export function retainedSpecEntry(config: ExistingConfig, cwd: string, spec?: string): ScriptSpecEntry {
  if (config.status === 'unloadable') {
    return { unavailable: `the existing oa.config.ts did not load (${config.reason}); make it load, or rewrite it with --force` }
  }

  const entries = new Map<string, ExistingSpecTarget>()
  for (const target of config.specTargets) {
    if (!entries.has(target.schemaEntryPath)) entries.set(target.schemaEntryPath, target)
  }
  const listed = [...entries.values()].map(target => target.schemaEntry).join(', ')
  if (entries.size === 0) {
    return { unavailable: 'the existing oa.config.ts has no spec target (specs); add one, or rewrite it with --force' }
  }

  if (spec !== undefined) {
    const match = entries.get(path.resolve(cwd, spec))
    if (match !== undefined) return { schema: schemaItem(match) }
    return {
      unavailable: `--spec ${spec} is not the schemaEntry of a spec target in the existing oa.config.ts (${listed}); ` +
        `pass one of those, or rewrite oa.config.ts for ${spec} with --force`,
    }
  }

  const [only] = entries.values()
  if (entries.size === 1 && only !== undefined) return { schema: schemaItem(only) }
  return {
    unavailable: `the spec targets of the existing oa.config.ts have different schemaEntry values (${listed}); ` +
      'pass the one to use with --spec',
  }
}

function schemaItem(target: ExistingSpecTarget): DetectedSchemaItem {
  const type = target.schemaEntry.endsWith('.tsp')
    ? 'typespec'
    : target.schemaEntry.endsWith('.json')
      ? 'openapi-json'
      : /\.[cm]?tsx?$/.test(target.schemaEntry) ? 'jsdoc-operations' : 'openapi-yaml'
  return {
    type,
    kind: type === 'jsdoc-operations' ? 'oa-operation' : type,
    filePath: target.schemaEntry,
    path: target.schemaEntryPath,
    relativePath: target.schemaEntry,
    confidence: 1.0,
    score: 100,
    description: `schemaEntry of the spec target ${target.id} in the existing oa.config.ts`,
  }
}

/** The documents `oa-gen generate` writes for the spec targets of `config`, if it loaded. */
export function generatedArtifactPaths(config: ExistingConfig | undefined): string[] {
  return config?.status === 'loaded' ? config.specTargets.flatMap(target => target.artifactPaths) : []
}
