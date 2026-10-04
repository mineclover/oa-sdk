import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { parseDocument } from '@oa-sdk/parser'
import {
  buildSurfaceIr,
  emitForgeOverlays,
  toForgeProjection,
  type SurfaceIrOptions,
  type SurfaceOperationOverride,
  type SurfaceAvailability,
} from '@oa-sdk/surface-ir'
import type { Command } from '../lib/types.js'
import { bool, choice, optResolveArgPath, optStr, resolveArgPath, str } from '../lib/args.js'
import { loadSpecDocumentAsync } from '../lib/load-spec.js'
import { CliExitError } from '../lib/errors.js'

type SurfaceMappingFile = {
  defaultAvailability?: SurfaceAvailability
  defaultEnvelope?: 'direct' | 'cloudflare'
  defaultErrors?: 'status-body' | 'cloudflare-envelope'
  operations?: Record<string, SurfaceOperationOverride>
}

type SurfaceManifest = {
  schemaVersion: 'oa-sdk.surface-manifest.v1'
  target: 'forge'
  source: {
    specPath: string
    openapiVersion: string
    artifactHash: string
  }
  surfaceIrPath: string
  projectionPath: string
  overlays: Array<{ name: string; path: string }>
  summary: {
    operations: number
    commands: number
    errors: number
    warnings: number
  }
  versionHash: string
}

export const surface: Command = {
  name: 'surface',
  description: 'OpenAPI/TypeSpec artifact에서 target surface IR과 Forge projection 생성',
  options: {
    spec: {
      type: 'string',
      short: 's',
      required: true,
      description: 'OpenAPI YAML/JSON 또는 TypeSpec .tsp 경로',
    },
    target: {
      type: 'string',
      description: 'surface target (현재 forge)',
    },
    'out-dir': {
      type: 'string',
      short: 'o',
      description: 'surface-ir.json, Forge projection, Overlay, manifest 출력 디렉토리',
    },
    mapping: {
      type: 'string',
      description: 'operation group/method/lifecycle/CLI override JSON 또는 YAML 경로',
    },
    'fail-on-warning': {
      type: 'boolean',
      description: 'warning diagnostic이 있으면 실패',
    },
  },
  async run(args, context) {
    const target = choice(args, 'target', ['forge'] as const, 'forge')
    const specArg = str(args, 'spec')
    const outDirArg = optStr(args, 'out-dir') ?? 'artifacts/surface/forge'
    const specPath = resolveArgPath(args, 'spec', context?.projectRoot)
    const mappingPath = optResolveArgPath(args, 'mapping', context?.projectRoot)
    const mapping = mappingPath ? readMapping(mappingPath) : {}
    const loaded = await loadSpecDocumentAsync(specArg, context?.projectRoot)
    const parsed = parseDocument(loaded.document)

    const surfaceOptions: SurfaceIrOptions = {
      target,
      ...(mapping.defaultAvailability === undefined ? {} : { defaultAvailability: mapping.defaultAvailability }),
      ...(mapping.defaultEnvelope === undefined ? {} : { defaultEnvelope: mapping.defaultEnvelope }),
      ...(mapping.defaultErrors === undefined ? {} : { defaultErrors: mapping.defaultErrors }),
      ...(mapping.operations === undefined ? {} : { operationOverrides: mapping.operations }),
    }
    const ir = buildSurfaceIr(parsed, surfaceOptions)
    const projection = toForgeProjection(ir, parsed)
    const overlays = emitForgeOverlays(ir, parsed)
    const diagnostics = projection.diagnostics
    const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error')
    const warnings = diagnostics.filter(diagnostic => diagnostic.severity === 'warning')
    const outDir = resolve(process.cwd(), outDirArg)
    mkdirSync(outDir, { recursive: true })

    const surfaceIrPath = join(outDir, 'surface-ir.json')
    const projectionPath = join(outDir, 'forge-projection.json')
    writeJson(surfaceIrPath, ir)
    writeJson(projectionPath, projection)

    const overlayPaths = overlays.map(item => {
      const overlayPath = join(outDir, `forge.${item.name}.overlay.yaml`)
      writeFileSync(overlayPath, stringifyYaml(item.overlay, { lineWidth: 0 }), 'utf8')
      return { name: item.name, path: relative(process.cwd(), overlayPath) }
    })

    const manifest: SurfaceManifest = {
      schemaVersion: 'oa-sdk.surface-manifest.v1',
      target: 'forge',
      source: {
        specPath: relative(process.cwd(), specPath),
        openapiVersion: ir.source.openapiVersion,
        artifactHash: ir.source.artifactHash,
      },
      surfaceIrPath: relative(process.cwd(), surfaceIrPath),
      projectionPath: relative(process.cwd(), projectionPath),
      overlays: overlayPaths,
      summary: {
        operations: ir.source.operationCount,
        commands: Object.keys(projection.commands).length,
        errors: errors.length,
        warnings: warnings.length,
      },
      versionHash: ir.versionHash,
    }
    const manifestPath = join(outDir, 'surface-manifest.json')
    writeJson(manifestPath, manifest)

    console.log(`✅ Surface IR generated: ${relative(process.cwd(), surfaceIrPath)}`)
    console.log(`✅ Forge projection generated: ${relative(process.cwd(), projectionPath)}`)
    console.log(`✅ Forge overlays generated: ${overlayPaths.length}`)
    console.log(`✅ Surface manifest generated: ${relative(process.cwd(), manifestPath)}`)
    console.log(`   operations=${ir.source.operationCount} commands=${Object.keys(projection.commands).length} errors=${errors.length} warnings=${warnings.length}`)

    if (errors.length > 0 || (bool(args, 'fail-on-warning') && warnings.length > 0)) {
      throw new CliExitError(1)
    }
  },
}

function readMapping(path: string): SurfaceMappingFile {
  let value: unknown
  try {
    const raw = readFileSync(path, 'utf8')
    value = path.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)
  } catch (error) {
    throw new Error(`surface mapping 읽기 실패: ${path}\n${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(value)) throw new Error(`surface mapping은 object여야 합니다: ${path}`)

  const result: SurfaceMappingFile = {}
  if (value.defaultAvailability !== undefined) {
    result.defaultAvailability = parseAvailability(value.defaultAvailability)
  }
  if (value.defaultEnvelope !== undefined) {
    if (value.defaultEnvelope !== 'direct' && value.defaultEnvelope !== 'cloudflare') {
      throw new Error(`surface mapping defaultEnvelope 값이 잘못되었습니다: ${String(value.defaultEnvelope)}`)
    }
    result.defaultEnvelope = value.defaultEnvelope
  }
  if (value.defaultErrors !== undefined) {
    if (value.defaultErrors !== 'status-body' && value.defaultErrors !== 'cloudflare-envelope') {
      throw new Error(`surface mapping defaultErrors 값이 잘못되었습니다: ${String(value.defaultErrors)}`)
    }
    result.defaultErrors = value.defaultErrors
  }
  if (value.operations !== undefined) {
    if (!isRecord(value.operations)) throw new Error('surface mapping operations는 object여야 합니다')
    result.operations = value.operations as Record<string, SurfaceOperationOverride>
  }
  return result
}

function parseAvailability(value: unknown): SurfaceAvailability {
  const allowed: readonly SurfaceAvailability[] = [
    'alpha',
    'beta',
    'preview',
    'generally-available',
    'deprecated',
    'legacy',
  ]
  if (typeof value === 'string' && allowed.includes(value as SurfaceAvailability)) {
    return value as SurfaceAvailability
  }
  throw new Error(`surface mapping availability 값이 잘못되었습니다: ${String(value)}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
