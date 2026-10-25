import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  generateStandaloneGuards as renderGuards,
  type GeneratedGuardArtifact,
  type StandaloneGuardGeneratorOptions,
} from '@oa-sdk/ast-sync/guards'
import type { OasDocument } from '@oa-sdk/parser'
import { generateTypesFromSpec } from '../typegen/generate-types.js'
import { createComponentTypeNameMap } from '../typegen/type-names.js'

export type {
  GeneratedGuardArtifact,
  StandaloneGuardGeneratorOptions,
  StandaloneGuardTarget,
} from '@oa-sdk/ast-sync/guards'

/** One naming contract for CLI, configured guards and plugin-generated declarations. */
export async function generateStandaloneGuards(
  options: StandaloneGuardGeneratorOptions,
): Promise<GeneratedGuardArtifact[]> {
  // 1. Resolve schema identities and the typegen declaration names.
  const doc = options.schemaDocument
  const schemas = (doc.components as { schemas?: Record<string, unknown> } | undefined)?.schemas
    ?? (doc.$defs as Record<string, unknown> | undefined)
    ?? (doc.definitions as Record<string, unknown> | undefined)
    ?? { [typeof doc.title === 'string' ? doc.title : 'Root']: doc }
  const names = Object.fromEntries(createComponentTypeNameMap(Object.keys(schemas)).byComponentName)
  const ownTypes = !options.typeImportSpecifier && options.generateDeclarations !== false

  // 2. Render in memory so every caller uses the same validation engine.
  const artifacts = await renderGuards({
    ...options,
    dryRun: true,
    typeNames: { ...names, ...options.typeNames },
    ...(ownTypes ? { typeImportSpecifier: options.split ? '../types.js' : './types.js' } : {}),
  })

  // 3. Complete the declaration set when no external type module was selected.
  if (ownTypes && artifacts.length > 0) {
    const modelDocument = {
      openapi: '3.2.0',
      info: { title: 'Guard types', version: '1' },
      paths: {},
      components: { schemas: remapDefinitionRefs(schemas) },
    } as OasDocument
    const content = generateTypesFromSpec(modelDocument)
    const filePath = join(resolve(options.outDir), 'types.d.ts')
    artifacts.push({ filePath, content, kind: 'dts' })
  }

  // 4. Publish only after the complete artifact set has rendered successfully.
  if (!options.dryRun && artifacts.length > 0) {
    await mkdir(resolve(options.outDir), { recursive: true })
    try {
      await writeFile(
        join(resolve(options.outDir), 'package.json'),
        JSON.stringify({ type: 'module' }) + '\n',
        { flag: 'wx' },
      )
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
    for (const artifact of artifacts) {
      await mkdir(resolve(artifact.filePath, '..'), { recursive: true })
      await writeFile(artifact.filePath, artifact.content, 'utf8')
    }
  }
  return artifacts
}

function remapDefinitionRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(remapDefinitionRefs)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === '$ref' && typeof child === 'string'
        ? child.replace(/^#\/(?:\$defs|definitions)\//, '#/components/schemas/')
        : remapDefinitionRefs(child),
    ]),
  )
}
