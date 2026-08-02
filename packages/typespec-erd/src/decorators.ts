import type { DecoratorContext, Model, ModelProperty, Namespace } from '@typespec/compiler'
import { reportDiagnostic } from './lib.js'
import {
  datasets,
  entities,
  fields,
  foreignKeys,
  primaryKeys,
  primaryKeyParts,
  relationships,
  uniques,
} from './state.js'

export const namespace = 'OaSdkErd'

const CARDINALITIES = new Set(['one-to-one', 'one-to-many', 'many-to-one'])

export function $dataset(context: DecoratorContext, target: Namespace, id: string): void {
  const state = datasets(context.program)
  if (duplicateId([...state.values()].map(value => value.id), id)) {
    reportDiagnostic(context.program, { code: 'duplicate-id', target: context.getArgumentTarget(0) ?? target, format: { kind: 'dataset', id } })
    return
  }
  state.set(target, { id, target, ...(context.getArgumentTarget(0) ? { decoratorTarget: context.getArgumentTarget(0)! } : {}) })
}

export function $entity(context: DecoratorContext, target: Model, id: string): void {
  const state = entities(context.program)
  if (duplicateId([...state.values()].map(value => value.id), id)) {
    reportDiagnostic(context.program, { code: 'duplicate-id', target: context.getArgumentTarget(0) ?? target, format: { kind: 'entity', id } })
    return
  }
  state.set(target, { id, target, ...(context.getArgumentTarget(0) ? { decoratorTarget: context.getArgumentTarget(0)! } : {}) })
}

export function $field(context: DecoratorContext, target: ModelProperty, id: string): void {
  const state = fields(context.program)
  if (duplicateId([...state.values()].map(value => value.id), id)) {
    reportDiagnostic(context.program, { code: 'duplicate-id', target: context.getArgumentTarget(0) ?? target, format: { kind: 'field', id } })
    return
  }
  state.set(target, { id, target, ...(context.getArgumentTarget(0) ? { decoratorTarget: context.getArgumentTarget(0)! } : {}) })
}

export function $primaryKey(context: DecoratorContext, target: ModelProperty, groupId?: string, order?: number): void {
  primaryKeys(context.program).add(target)
  if (groupId === undefined && order === undefined) return
  const numericOrder = order
  if (!groupId || numericOrder === null || numericOrder === undefined || !Number.isSafeInteger(numericOrder) || numericOrder < 1) {
    reportDiagnostic(context.program, {
      code: 'invalid-key',
      target: context.getArgumentTarget(order === undefined ? 0 : 1) ?? target,
      format: { message: 'Composite primary-key parts require a non-empty group id and a positive integer order.' },
    })
    return
  }
  const state = primaryKeyParts(context.program)
  const duplicate = [...state.values()].some(value => value.target.model === target.model && value.groupId === groupId && value.order === numericOrder)
  if (duplicate) {
    reportDiagnostic(context.program, {
      code: 'invalid-key',
      target: context.getArgumentTarget(1) ?? target,
      format: { message: `Composite primary-key group ${groupId} repeats component order ${numericOrder}.` },
    })
    return
  }
  state.set(target, {
    groupId,
    order: numericOrder,
    target,
    ...(context.getArgumentTarget(0) ? { decoratorTarget: context.getArgumentTarget(0)! } : {}),
  })
}

export function $unique(context: DecoratorContext, target: ModelProperty): void {
  uniques(context.program).add(target)
}

export function $foreignKey(context: DecoratorContext, target: ModelProperty, targetField: ModelProperty): void {
  foreignKeys(context.program).set(target, {
    target,
    targetField,
    ...(context.getArgumentTarget(0) ? { decoratorTarget: context.getArgumentTarget(0)! } : {}),
  })
}

export function $relationship(
  context: DecoratorContext,
  target: Namespace,
  id: string,
  from: ModelProperty,
  to: ModelProperty,
  cardinality: string,
): void {
  if (!CARDINALITIES.has(cardinality)) {
    reportDiagnostic(context.program, { code: 'invalid-cardinality', target: context.getArgumentTarget(3) ?? target, format: { cardinality } })
    return
  }
  const state = relationships(context.program)
  const declarations = [...state.values()].flat()
  if (duplicateId(declarations.map(value => value.id), id)) {
    reportDiagnostic(context.program, { code: 'duplicate-id', target: context.getArgumentTarget(0) ?? target, format: { kind: 'relationship', id } })
    return
  }
  const declaration = {
    id,
    target,
    from,
    to,
    cardinality,
    ...(context.getArgumentTarget(0) ? { decoratorTarget: context.getArgumentTarget(0)! } : {}),
  }
  state.set(target, [...(state.get(target) ?? []), declaration])
}

function duplicateId(ids: readonly string[], id: string): boolean {
  return !id || ids.includes(id)
}
