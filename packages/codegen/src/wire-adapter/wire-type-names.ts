/**
 * TypeScript names of wire models and enums.
 *
 * Component names are JSON keys (`Inventory.Widget`), not identifiers. Every TypeScript adapter
 * resolves them here so declarations, type positions, and imports use the names `types.ts`
 * declares for the same components.
 *
 * @oa-sdk/codegen
 */

import { createComponentTypeNameMap } from '../typegen/type-names.js'
import type { WireSchemaModel } from './wire-schema-model.js'

/** Lower-cases the first character, for value names such as `inventoryWidgetProtobufCodec`. */
export function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1)
}

/**
 * Component name to TypeScript declaration name for every model and enum of a wire model.
 * Uses `tsTypeName` where the extractor set it, and otherwise allocates names the way
 * `types.ts` does (valid identifiers, collision suffixes).
 */
export function wireTypeNames(model: WireSchemaModel): ReadonlyMap<string, string> {
  const entities = [...model.models, ...model.enums]
  const derived = createComponentTypeNameMap(entities.map(entity => entity.name)).byComponentName
  return new Map(entities.map(entity => [entity.name, entity.tsTypeName ?? derived.get(entity.name) ?? entity.name]))
}
