import type { DiagnosticTarget, Model, ModelProperty, Namespace, Program } from '@typespec/compiler'

export type ErdDatasetDeclaration = { id: string; target: Namespace; decoratorTarget?: DiagnosticTarget }
export type ErdEntityDeclaration = { id: string; target: Model; decoratorTarget?: DiagnosticTarget }
export type ErdFieldDeclaration = { id: string; target: ModelProperty; decoratorTarget?: DiagnosticTarget }
export type ErdPrimaryKeyPartDeclaration = {
  groupId: string
  order: number
  target: ModelProperty
  decoratorTarget?: DiagnosticTarget
}
export type ErdForeignKeyDeclaration = { target: ModelProperty; targetField: ModelProperty; decoratorTarget?: DiagnosticTarget }
export type ErdRelationshipDeclaration = {
  id: string
  target: Namespace
  from: ModelProperty
  to: ModelProperty
  cardinality: string
  decoratorTarget?: DiagnosticTarget
}

const datasetStateKey = Symbol('oa-sdk.typespec-erd.dataset')
const entityStateKey = Symbol('oa-sdk.typespec-erd.entity')
const fieldStateKey = Symbol('oa-sdk.typespec-erd.field')
const primaryKeyStateKey = Symbol('oa-sdk.typespec-erd.primary-key')
const primaryKeyPartStateKey = Symbol('oa-sdk.typespec-erd.primary-key-part')
const uniqueStateKey = Symbol('oa-sdk.typespec-erd.unique')
const foreignKeyStateKey = Symbol('oa-sdk.typespec-erd.foreign-key')
const relationshipStateKey = Symbol('oa-sdk.typespec-erd.relationship')

export function datasets(program: Program): Map<Namespace, ErdDatasetDeclaration> {
  return program.stateMap(datasetStateKey) as Map<Namespace, ErdDatasetDeclaration>
}

export function entities(program: Program): Map<Model, ErdEntityDeclaration> {
  return program.stateMap(entityStateKey) as Map<Model, ErdEntityDeclaration>
}

export function fields(program: Program): Map<ModelProperty, ErdFieldDeclaration> {
  return program.stateMap(fieldStateKey) as Map<ModelProperty, ErdFieldDeclaration>
}

export function primaryKeys(program: Program): Set<ModelProperty> {
  return program.stateSet(primaryKeyStateKey) as Set<ModelProperty>
}

export function primaryKeyParts(program: Program): Map<ModelProperty, ErdPrimaryKeyPartDeclaration> {
  return program.stateMap(primaryKeyPartStateKey) as Map<ModelProperty, ErdPrimaryKeyPartDeclaration>
}

export function uniques(program: Program): Set<ModelProperty> {
  return program.stateSet(uniqueStateKey) as Set<ModelProperty>
}

export function foreignKeys(program: Program): Map<ModelProperty, ErdForeignKeyDeclaration> {
  return program.stateMap(foreignKeyStateKey) as Map<ModelProperty, ErdForeignKeyDeclaration>
}

export function relationships(program: Program): Map<Namespace, ErdRelationshipDeclaration[]> {
  return program.stateMap(relationshipStateKey) as Map<Namespace, ErdRelationshipDeclaration[]>
}
