/**
 * Pluggable Target Adapter Interface
 *
 * Defines the contract that every target transformer implements
 * between the canonical WireSchemaModel (.tsp SSOT) and desired target artifacts.
 *
 * @oa-sdk/codegen
 */

import type { WireSchemaModel } from './wire-schema-model.js'

export interface TypeSpecWireTargetAdapter<TOutput = unknown, TOptions = unknown> {
  /** Unique identifier for the adapter, e.g. 'proto3', 'protobuf-codec', 'rpc-contract' */
  readonly id: string

  /** Human-readable name of the adapter */
  readonly name: string

  /** Target domain, e.g. 'protobuf', 'typescript', 'rpc', 'messagepack' */
  readonly target: string

  /** Target file extension, e.g. '.proto', '.ts' */
  readonly fileExtension?: string | undefined

  /**
   * Transforms canonical WireSchemaModel into the target output artifact.
   */
  transform(model: WireSchemaModel, options?: TOptions): TOutput | Promise<TOutput>
}

export interface WireTransformationResult {
  readonly model: WireSchemaModel
  readonly artifacts: Record<string, unknown>
}
