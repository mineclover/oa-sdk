/**
 * Produce an environment-specific deployment projection from the restored
 * TypeSpec contract. Only `servers` may vary; this never promotes or mutates
 * the approved contract snapshot.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { checkTypeSpecBundle, formatTypeSpecBundleCheckFailure, shouldFailTypeSpecBundleCheck } from '../packages/codegen/src/cli/lib/typespec-bundle-check.js'
import { loadSpecWithPath } from '../packages/codegen/src/cli/lib/load-spec.js'
import { stringifyOpenApiYaml } from '../packages/codegen/src/cli/lib/openapi-collect.js'
import { validateDocument } from '../packages/parser/src/index.ts'

type Server = { url: string; description?: string }
type ProjectionConfig = {
  schemaVersion: 'oa-sdk.typespec-projections.v1'
  profiles: Record<string, { servers: Server[] }>
}

const root = resolve(process.cwd())
const args = parseArgs(process.argv.slice(2))
const configPath = resolve(root, args.config)
const config = parseProjectionConfig(JSON.parse(readFileSync(configPath, 'utf8')))
const profile = config.profiles[args.profile]
if (!profile) throw new Error(`unknown TypeSpec projection profile ${args.profile}; allowed: ${Object.keys(config.profiles).sort().join(', ')}`)

const outputPath = resolve(root, args.output ?? `packages/schemas/src/.projected/${args.profile}.openapi.yaml`)
assertPathInsideRoot(outputPath, 'output')
const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-projection-'))
const restoredPath = join(workspace, 'restored.openapi.yaml')

try {
  const result = await checkTypeSpecBundle({
    manifest: args.manifest,
    output: restoredPath,
    failOnBreaking: true,
  })
  if (shouldFailTypeSpecBundleCheck(result.report, { failOnBreaking: true })) {
    throw new Error(`cannot project TypeSpec contract: ${formatTypeSpecBundleCheckFailure(result.report)}`)
  }

  const { document } = loadSpecWithPath(restoredPath)
  const projected = cloneDocument(document as Record<string, unknown>)
  projected.servers = profile.servers.map(server => ({
    url: server.url,
    ...(server.description ? { description: server.description } : {}),
  }))
  const validation = validateDocument(projected, { basePath: outputPath, requireOpenApi32: true })
  if (!validation.valid) throw new Error(`projected OpenAPI validation failed: ${validation.summary}`)

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, stringifyOpenApiYaml(projected))
  console.log(`TypeSpec ${args.profile} projection: ${relative(root, outputPath)}`)
  console.log(`  source manifest: ${args.manifest}`)
  console.log(`  server count: ${profile.servers.length}`)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

function parseArgs(raw: string[]): { profile: string; manifest: string; config: string; output?: string } {
  const profile = readOption(raw, '--profile')
  if (!profile) throw new Error('--profile is required')
  return {
    profile,
    manifest: readOption(raw, '--manifest') ?? 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
    config: readOption(raw, '--config') ?? 'packages/schemas/typespec/oa-sdk.typespec-projections.json',
    ...(readOption(raw, '--output') ? { output: readOption(raw, '--output') } : {}),
  }
}

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function parseProjectionConfig(value: unknown): ProjectionConfig {
  if (!isRecord(value) || value.schemaVersion !== 'oa-sdk.typespec-projections.v1' || !isRecord(value.profiles)) {
    throw new Error('invalid TypeSpec projection config')
  }
  const profiles: Record<string, { servers: Server[] }> = {}
  for (const [name, profile] of Object.entries(value.profiles)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || !isRecord(profile) || !Array.isArray(profile.servers) || profile.servers.length === 0) {
      throw new Error(`invalid TypeSpec projection profile ${name}`)
    }
    profiles[name] = {
      servers: profile.servers.map((server, index) => {
        if (!isRecord(server) || typeof server.url !== 'string' || server.url.trim() === '' || (server.description !== undefined && typeof server.description !== 'string')) {
          throw new Error(`invalid server ${name}[${index}]`)
        }
        return { url: server.url, ...(typeof server.description === 'string' ? { description: server.description } : {}) }
      }),
    }
  }
  return { schemaVersion: 'oa-sdk.typespec-projections.v1', profiles }
}

function assertPathInsideRoot(path: string, label: string): void {
  const pathRelative = relative(root, path)
  if (pathRelative === '..' || pathRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`${label} must stay inside the repository`)
  }
}

function cloneDocument(document: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(document)) as Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
