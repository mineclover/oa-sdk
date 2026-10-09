import type { DecoratorContext, Model, ModelProperty, Namespace } from '@typespec/compiler'
import { setExtension } from '@typespec/openapi'
import { namespace } from './constants.js'

export { namespace }
export const STORAGE_REF_EXTENSION = 'x-oa-sdk-storage-ref'
export const STORAGE_CATALOG_EXTENSION = 'x-oa-sdk-storage-catalog'

/**
 * Binds a Model or ModelProperty to an Atlas physical table or column identifier.
 * Used for read-only catalog evidence and drift verification without DDL mutation.
 * Emits internal `x-oa-sdk-storage-ref: { target: tableOrColumn }`.
 */
export function $storageRef(
  context: DecoratorContext,
  target: Model | ModelProperty,
  tableOrColumn: string,
): void {
  setExtension(context.program, target, STORAGE_REF_EXTENSION, {
    target: tableOrColumn,
  })
}

/**
 * Declares the physical storage catalog origin for a namespace (e.g. "sqlite", "postgres", "d1").
 * Emits internal `x-oa-sdk-storage-catalog: { catalog: catalogName }`.
 */
export function $storageCatalog(
  context: DecoratorContext,
  target: Namespace,
  catalogName: string,
): void {
  setExtension(context.program, target, STORAGE_CATALOG_EXTENSION, {
    catalog: catalogName,
  })
}
