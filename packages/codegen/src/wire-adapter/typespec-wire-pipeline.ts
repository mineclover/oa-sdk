/**
 * TypeSpec Wire Transformation Pipeline
 *
 * Implements the Pluggable Adapter Pattern between TypeSpec (.tsp SSOT)
 * and target artifacts (Proto3 schema, TS Protobuf codecs, RPC contracts, MessagePack).
 *
 * Pipeline Architecture:
 *   TypeSpec (.tsp SSOT)
 *       │
 *       ▼
 *   WireSchemaExtractor (Extracts canonical WireSchemaModel IR)
 *       │
 *       ▼ [Pluggable Target Adapters]
 *       ├── Proto3TargetAdapter            ─► .proto (Protocol Buffers v3 schema)
 *       ├── ProtobufCodecTargetAdapter     ─► TS BinaryCodecAdapter (Pure TS / Typia)
 *       ├── RpcContractTargetAdapter       ─► RPC Server Handlers & Client
 *       └── MessagePackTargetAdapter       ─► MessagePack binary bindings
 *
 * @oa-sdk/codegen
 */

import type { OasDocument } from '@oa-sdk/parser'
import type { WireSchemaModel } from './wire-schema-model.js'
import type { TypeSpecWireTargetAdapter } from './wire-adapter-types.js'
import { extractWireSchemaFromOas } from './wire-schema-extractor.js'
import { Proto3TargetAdapter } from './adapters/proto3-target-adapter.js'
import { ProtobufCodecTargetAdapter } from './adapters/protobuf-codec-target-adapter.js'
import { RpcContractTargetAdapter } from './adapters/rpc-contract-target-adapter.js'
import { MessagePackTargetAdapter } from './adapters/messagepack-target-adapter.js'
import { compileTypeSpecInMemory } from '../cli/lib/typespec-mock-compiler.js'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TransformationBundle {
  readonly model: WireSchemaModel
  readonly proto3?: string | undefined
  readonly protobufCodec?: string | undefined
  readonly rpcContract?: string | undefined
  readonly messagepack?: string | undefined
  readonly customArtifacts: Record<string, unknown>
}

export class TypeSpecWirePipeline {
  private readonly adapters = new Map<string, TypeSpecWireTargetAdapter<any, any>>()

  constructor(registerDefaults = true) {
    if (registerDefaults) {
      this.registerAdapter(new Proto3TargetAdapter())
      this.registerAdapter(new ProtobufCodecTargetAdapter())
      this.registerAdapter(new RpcContractTargetAdapter())
      this.registerAdapter(new MessagePackTargetAdapter())
    }
  }

  /**
   * Registers a pluggable target adapter.
   */
  registerAdapter(adapter: TypeSpecWireTargetAdapter<any, any>): this {
    this.adapters.set(adapter.id, adapter)
    return this
  }

  /**
   * Retrieves an adapter by its ID.
   */
  getAdapter(id: string): TypeSpecWireTargetAdapter<any, any> | undefined {
    return this.adapters.get(id)
  }

  /**
   * Checks whether an adapter is registered.
   */
  hasAdapter(id: string): boolean {
    return this.adapters.has(id)
  }

  /**
   * Returns all registered adapter IDs.
   */
  get registeredAdapterIds(): string[] {
    return Array.from(this.adapters.keys())
  }

  /**
   * Extracts canonical WireSchemaModel from TypeSpec source code, file path, or OAS Document.
   */
  async extractModel(input: string | OasDocument): Promise<WireSchemaModel> {
    if (typeof input === 'object' && input !== null) {
      return extractWireSchemaFromOas(input)
    }

    // Input is a string: could be raw .tsp source or path
    const trimmed = input.trim()
    const isSource = trimmed.includes('namespace') || trimmed.includes('model') || trimmed.includes('service')

    let oasDoc: OasDocument

    if (isSource) {
      // Compile raw TypeSpec source in a temporary directory
      const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-wire-pipeline-'))
      try {
        const tspPath = join(tmp, 'main.tsp')
        writeFileSync(tspPath, input, 'utf8')
        const compilation = await compileTypeSpecInMemory(tspPath)
        oasDoc = compilation.document
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    } else {
      // Input is a file path
      const compilation = await compileTypeSpecInMemory(input)
      oasDoc = compilation.document
    }

    return extractWireSchemaFromOas(oasDoc)
  }

  /**
   * Transforms TypeSpec or OAS input into a specific target artifact using a registered adapter.
   */
  async transform<TOutput = unknown>(
    input: string | OasDocument,
    targetId: string,
    options?: unknown,
  ): Promise<TOutput> {
    const adapter = this.adapters.get(targetId)
    if (!adapter) {
      throw new Error(`Target adapter "${targetId}" not found. Available adapters: ${this.registeredAdapterIds.join(', ')}`)
    }

    const model = await this.extractModel(input)
    return await adapter.transform(model, options) as TOutput
  }

  /**
   * Transforms input across all registered adapters simultaneously into a comprehensive bundle.
   */
  async transformAll(
    input: string | OasDocument,
    optionsByTarget: Record<string, unknown> = {},
  ): Promise<TransformationBundle> {
    const model = await this.extractModel(input)
    const customArtifacts: Record<string, unknown> = {}

    let proto3: string | undefined
    let protobufCodec: string | undefined
    let rpcContract: string | undefined
    let messagepack: string | undefined

    for (const [id, adapter] of this.adapters.entries()) {
      const opts = optionsByTarget[id]
      const output = await adapter.transform(model, opts)

      if (id === 'proto3') proto3 = output as string
      else if (id === 'protobuf-codec') protobufCodec = output as string
      else if (id === 'rpc-contract') rpcContract = output as string
      else if (id === 'messagepack') messagepack = output as string
      else customArtifacts[id] = output
    }

    return {
      model,
      proto3,
      protobufCodec,
      rpcContract,
      messagepack,
      customArtifacts,
    }
  }
}

/** Pre-instantiated singleton pipeline for convenient top-level usage */
export const typeSpecWirePipeline = new TypeSpecWirePipeline()
