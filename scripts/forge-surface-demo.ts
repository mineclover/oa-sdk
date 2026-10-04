#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { parseDocument } from '../packages/parser/src/index.ts'
import { buildSurfaceIr, emitForgeOverlays } from '../packages/surface-ir/src/index.ts'

type ForgeModule = {
  init: (
    document: Record<string, unknown>,
    overlays: Array<{ name: string; overlay: unknown }>,
    options: { writeArtifacts: boolean },
  ) => Promise<{
    commands: Map<string, unknown>
    methodStats: () => { total: number; byMethod: Record<string, number> }
    getOperationIds: () => string[]
  }>
}

const specPath = option('--spec') ?? 'packages/schemas/src/.merged.yaml'
const forgeRoot = option('--forge-root')
if (!forgeRoot) {
  throw new Error('--forge-root <cloudflare/forge checkout> is required')
}

const spec = parse(readFileSync(resolve(specPath), 'utf8')) as Record<string, unknown>
const parsed = parseDocument(spec as never)
const surface = buildSurfaceIr(parsed, { target: 'forge' })
const overlays = emitForgeOverlays(surface, parsed)
const forgeModule = await import(
  pathToFileURL(resolve(forgeRoot, 'packages/forge/index.ts')).href,
) as unknown as ForgeModule

const forge = await forgeModule.init(
  spec,
  overlays,
  { writeArtifacts: false },
)
const stats = forge.methodStats()
const summary = {
  sourceOperations: surface.source.operationCount,
  surfaceErrors: surface.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length,
  surfaceWarnings: surface.diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length,
  forgeCommands: [...forge.commands.keys()].sort(),
  forgeMethods: stats.total,
  forgeOperations: forge.getOperationIds().length,
  parity: {
    operations: surface.source.operationCount === forge.getOperationIds().length,
    methods: surface.source.operationCount === stats.total,
  },
}

console.log(JSON.stringify(summary, null, 2))
if (!summary.parity.operations || !summary.parity.methods || summary.surfaceErrors > 0) {
  process.exitCode = 1
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  return value && !value.startsWith('-') ? value : undefined
}
