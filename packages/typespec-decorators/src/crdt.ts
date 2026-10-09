import type { DecoratorContext, Model, ModelProperty } from '@typespec/compiler'
import { setExtension } from '@typespec/openapi'
import { reportDiagnostic } from './lib.js'
import {
  VALID_CRDT_COMPACTIONS,
  VALID_CRDT_ENGINES,
  VALID_CRDT_RESOLUTIONS,
  VALID_CRDT_ROLES,
  VALID_CRDT_TYPES,
  namespace,
} from './constants.js'

export {
  VALID_CRDT_COMPACTIONS,
  VALID_CRDT_ENGINES,
  VALID_CRDT_RESOLUTIONS,
  VALID_CRDT_ROLES,
  VALID_CRDT_TYPES,
  namespace,
} from './constants.js'

export const CRDT_EXTENSION = 'x-oa-sdk-crdt'
export const CRDT_ENTITY_EXTENSION = 'x-oa-sdk-crdt-entity'

/**
 * Declares CRDT semantics and conflict resolution strategy for a model property.
 * Emits the `x-oa-sdk-crdt` OpenAPI extension payload.
 */
export function $crdt(
  context: DecoratorContext,
  target: ModelProperty,
  options: Record<string, unknown>,
): void {
  if (typeof options !== 'object' || options === null) {
    reportDiagnostic(context.program, {
      code: 'invalid-crdt-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: 'Options object required for @crdt decorator.',
      },
    })
    return
  }

  const { type, resolution, engine, role } = options as {
    type?: unknown
    resolution?: unknown
    engine?: unknown
    role?: unknown
  }

  if (typeof type !== 'string' || !VALID_CRDT_TYPES.has(type)) {
    reportDiagnostic(context.program, {
      code: 'invalid-crdt-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid CRDT type "${String(type)}". Expected one of: ${[...VALID_CRDT_TYPES].join(', ')}.`,
      },
    })
    return
  }

  if (resolution !== undefined && (typeof resolution !== 'string' || !VALID_CRDT_RESOLUTIONS.has(resolution))) {
    reportDiagnostic(context.program, {
      code: 'invalid-crdt-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid CRDT resolution "${String(resolution)}". Expected one of: ${[...VALID_CRDT_RESOLUTIONS].join(', ')}.`,
      },
    })
    return
  }

  if (engine !== undefined && (typeof engine !== 'string' || !VALID_CRDT_ENGINES.has(engine))) {
    reportDiagnostic(context.program, {
      code: 'invalid-crdt-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid CRDT engine "${String(engine)}". Expected one of: ${[...VALID_CRDT_ENGINES].join(', ')}.`,
      },
    })
    return
  }

  if (role !== undefined && (typeof role !== 'string' || !VALID_CRDT_ROLES.has(role))) {
    reportDiagnostic(context.program, {
      code: 'invalid-crdt-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid CRDT role "${String(role)}". Expected one of: ${[...VALID_CRDT_ROLES].join(', ')}.`,
      },
    })
    return
  }

  const payload: Record<string, unknown> = {
    type,
    ...(resolution !== undefined ? { resolution } : {}),
    ...(engine !== undefined ? { engine } : {}),
    ...(role !== undefined ? { role } : {}),
  }

  setExtension(context.program, target, CRDT_EXTENSION, payload)
}

/**
 * Declares CRDT partitioning, sharding, and compaction lifecycle for a model.
 * Emits the `x-oa-sdk-crdt-entity` OpenAPI extension payload.
 */
export function $crdtEntity(
  context: DecoratorContext,
  target: Model,
  options: Record<string, unknown>,
): void {
  if (typeof options !== 'object' || options === null) {
    reportDiagnostic(context.program, {
      code: 'invalid-crdt-entity-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: 'Options object required for @crdtEntity decorator.',
      },
    })
    return
  }

  const { partitionKey, timeRange, compaction, strategy } = options as {
    partitionKey?: unknown
    timeRange?: unknown
    compaction?: unknown
    strategy?: unknown
  }

  if (compaction !== undefined && (typeof compaction !== 'string' || !VALID_CRDT_COMPACTIONS.has(compaction))) {
    reportDiagnostic(context.program, {
      code: 'invalid-crdt-entity-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid CRDT compaction "${String(compaction)}". Expected one of: ${[...VALID_CRDT_COMPACTIONS].join(', ')}.`,
      },
    })
    return
  }

  const payload: Record<string, unknown> = {
    ...(partitionKey !== undefined ? { partitionKey } : {}),
    ...(timeRange !== undefined ? { timeRange } : {}),
    ...(compaction !== undefined ? { compaction } : {}),
    ...(strategy !== undefined ? { strategy } : {}),
  }

  setExtension(context.program, target, CRDT_ENTITY_EXTENSION, payload)
}
