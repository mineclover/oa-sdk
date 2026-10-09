/**
 * Binary Wire Codecs Plugin for TypeSpec SSOT
 *
 * Connects to TypeSpecWirePipeline in @oa-sdk/codegen, producing:
 * - Pure TypeScript Protobuf binary codecs (zero-eval, CSP compliant)
 * - MessagePack binary codecs
 * - Protocol Buffers v3 (.proto) schemas
 * - RPC Server Handlers and Client contracts
 * - Content-Type / Accept binary media type resolution
 *
 * @oa-sdk/codegen
 */

import type { TspGeneratedFile, TspPlugin, TspPluginContext } from '../types.js'
import { TypeSpecWirePipeline } from '../../wire-adapter/typespec-wire-pipeline.js'
import type { WireSchemaModel } from '../../wire-adapter/wire-schema-model.js'

export type WireCodecKind = 'protobuf' | 'msgpack' | 'proto3' | 'rpc-contract' | 'raw-binary'

export interface PluginWireOptions {
  /** Output path for wire codec bindings. Default: 'wire.ts' */
  output?: string | undefined
  /** Module specifier to import types from. Default: auto-resolved or './types.js' */
  typesFile?: string | undefined
  /** Codecs to generate bindings for. Default: ['protobuf', 'msgpack'] */
  codecs?: readonly WireCodecKind[] | undefined
  /** Output path for Protocol Buffers v3 schema (.proto). If omitted and 'proto3' codec requested, defaults to 'schema.proto' */
  proto3Output?: string | undefined
  /** Enforce zero-eval CSP safety. Default: true */
  zeroEval?: boolean | undefined
  /** Whether to add auto-generated comment banner. Default: true */
  banner?: boolean | undefined
  /** Custom pipeline instance for testing or dependency injection */
  pipeline?: TypeSpecWirePipeline | undefined
}

/**
 * Scans generated TypeScript code for top-level exported symbol names.
 */
function extractExportNames(code: string): string[] {
  const exports: string[] = []
  const matches = code.matchAll(/export\s+(?:const|function|class|type|interface)\s+([A-Za-z0-9_$]+)/g)
  for (const m of matches) {
    if (m[1]) exports.push(m[1])
  }
  return exports
}

/**
 * Finds the virtual path of generated types in context if available.
 */
function findTypesFilePath(context: TspPluginContext): string | undefined {
  if (context.hasFile('types.ts')) return 'types.ts'
  const match = context.getFiles().find(f => f.path.endsWith('types.ts') || f.kind === 'models')
  return match?.path
}

/**
 * Binary Wire Codecs Plugin for TypeSpec SSOT Code Generation.
 *
 * Declares dependencies: ['typescript'].
 */
export function pluginWire(
  options: PluginWireOptions = {},
): TspPlugin<PluginWireOptions> {
  return {
    name: 'wire',
    dependencies: ['typescript'],

    async generate(context: TspPluginContext, opts?: PluginWireOptions): Promise<void> {
      const mergedOpts: PluginWireOptions = { ...options, ...opts }
      const pipeline = mergedOpts.pipeline ?? new TypeSpecWirePipeline(true)

      const doc = context.document
      if (!doc) {
        context.log('warn', '[wire] No OpenAPI document found in context.')
        return
      }

      const model: WireSchemaModel = await pipeline.extractModel(doc)
      const codecs = mergedOpts.codecs ?? ['protobuf', 'msgpack']
      const wireTsPath = mergedOpts.output ?? 'wire.ts'
      const banner = mergedOpts.banner ?? true
      const knownTypesPath = findTypesFilePath(context)

      // Resolve types import relative to wireTsPath
      const typesImport = mergedOpts.typesFile
        ?? (knownTypesPath ? context.resolveImport(wireTsPath, knownTypesPath) : './types.js')

      const wantsProto3 = codecs.includes('proto3') || Boolean(mergedOpts.proto3Output)
      const wantsProtobuf = codecs.includes('protobuf')
      const wantsMsgpack = codecs.includes('msgpack')
      const wantsRpc = codecs.includes('rpc-contract')

      // 1. Emit Protocol Buffers v3 schema (.proto) if requested
      if (wantsProto3) {
        const proto3Path = mergedOpts.proto3Output ?? 'schema.proto'
        const proto3Code = await pipeline.transform<string>(doc, 'proto3', {
          packageName: model.package ?? 'api.v1',
          includeServices: true,
        })

        context.addFile({
          path: proto3Path,
          content: proto3Code,
          sourcePlugin: 'wire',
          kind: 'proto-schema',
        })
      }

      // 2. Generate TypeScript Wire Codecs (wire.ts)
      const wireSections: string[] = []
      const clientImports = new Set<string>()
      let needsClientTypeImport = false
      const allModelNames = model.models.map(m => m.name)

      if (wantsProtobuf) {
        needsClientTypeImport = true
        const protobufRaw = await pipeline.transform<string>(doc, 'protobuf-codec', {
          typesImport,
        })
        // Strip duplicate header/imports so sections assemble cleanly
        const cleaned = protobufRaw
          .replace(/\/\/ Auto-generated Protobuf Binary Codecs[^\n]*\n?/g, '')
          .replace(/\/\/ @oa-sdk\/codegen ProtobufCodecTargetAdapter[^\n]*\n?/g, '')
          .replace(/import type \{ BinaryCodecAdapter \} from '@oa-sdk\/client';?\n?/g, '')
          .replace(/import type \{ [^}]+ \} from ['"][^'"]+['"];?\n?/g, '')
          .trim()
        wireSections.push('// ─── Protobuf Binary Codecs ──────────────────────────────────────────────────')
        wireSections.push(cleaned)
      }

      if (wantsMsgpack) {
        clientImports.add('messagePackAdapter')
        needsClientTypeImport = true
        const msgpackRaw = await pipeline.transform<string>(doc, 'messagepack', {
          typesImport,
        })
        const cleaned = msgpackRaw
          .replace(/\/\/ Auto-generated MessagePack Binary Codecs[^\n]*\n?/g, '')
          .replace(/\/\/ @oa-sdk\/codegen MessagePackTargetAdapter[^\n]*\n?/g, '')
          .replace(/import \{ messagePackAdapter(?:, type BinaryCodecAdapter)? \} from '@oa-sdk\/client';?\n?/g, '')
          .replace(/import type \{ [^}]+ \} from ['"][^'"]+['"];?\n?/g, '')
          .trim()
        wireSections.push('// ─── MessagePack Binary Codecs ─────────────────────────────────────────────')
        wireSections.push(cleaned)
      }

      if (wantsRpc) {
        needsClientTypeImport = true
        const rpcRaw = await pipeline.transform<string>(doc, 'rpc-contract', {
          typesImport,
        })
        const cleaned = rpcRaw
          .replace(/\/\/ Auto-generated RPC Service Contracts[^\n]*\n?/g, '')
          .replace(/\/\/ @oa-sdk\/codegen RpcContractTargetAdapter[^\n]*\n?/g, '')
          .replace(/import type \{ BinaryCodecAdapter \} from '@oa-sdk\/client';?\n?/g, '')
          .replace(/import type \{ [^}]+ \} from ['"][^'"]+['"];?\n?/g, '')
          .trim()
        wireSections.push('// ─── RPC Service Contracts ─────────────────────────────────────────────────')
        wireSections.push(cleaned)
      }

      // Add Content Negotiation helper
      wireSections.push('// ─── Content Negotiation & Wire Media Type Resolution ──────────────────────')
      wireSections.push(`/**
 * Resolves appropriate binary codec adapter by MIME content type.
 * Supports Protobuf ('application/x-protobuf') and MessagePack ('application/msgpack').
 */
export function resolveBinaryCodec(mediaType: string, modelName: string): BinaryCodecAdapter<any> | undefined {
  const normalized = mediaType.toLowerCase().trim()
  if (normalized.includes('protobuf') || normalized.includes('x-protobuf')) {
    ${wantsProtobuf ? 'const codecs = getGeneratedProtobufCodecs()\n    return codecs[modelName]' : 'return undefined'}
  }
  if (normalized.includes('msgpack') || normalized.includes('x-msgpack')) {
    ${wantsMsgpack ? 'const codecs = getGeneratedMessagePackCodecs()\n    return codecs[modelName]' : 'return undefined'}
  }
  return undefined
}`)

      // Assemble file header
      const headerLines: string[] = []
      if (banner) {
        headerLines.push('// @generated by @oa-sdk/codegen (pluginWire). DO NOT EDIT.')
        headerLines.push('// Auto-generated binary wire codecs and schemas from TypeSpec SSOT.')
      }

      // Client imports
      const clientImportMembers: string[] = []
      if (clientImports.size > 0) {
        clientImportMembers.push(...Array.from(clientImports))
      }
      if (needsClientTypeImport) {
        clientImportMembers.push('type BinaryCodecAdapter')
      }
      if (clientImportMembers.length > 0) {
        headerLines.push(`import { ${clientImportMembers.join(', ')} } from '@oa-sdk/client'`)
      }

      // Types imports
      if (allModelNames.length > 0) {
        headerLines.push(`import type { ${allModelNames.join(', ')} } from '${typesImport}'`)
      }
      headerLines.push('')

      const fullContent = `${headerLines.join('\n')}\n${wireSections.join('\n\n')}\n`

      context.addFile({
        path: wireTsPath,
        content: fullContent,
        sourcePlugin: 'wire',
        kind: 'wire',
        exports: extractExportNames(fullContent),
      })
    },
  }
}
