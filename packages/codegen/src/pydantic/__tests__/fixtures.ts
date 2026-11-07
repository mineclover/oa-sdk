import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { OasDocument } from '@oa-sdk/parser'

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

/** Golden inputs: the approved TypeSpec spec, and TypeSpec-compiled polymorphism, recursion, and scalar fixtures. */
export const PYDANTIC_FIXTURE_PATHS = {
  approved: here('../../../../schemas/typespec/approved.openapi.yaml'),
  'chunk-stream': here('./fixtures/chunk-stream/chunk-stream.openapi.yaml'),
  cycles: here('./fixtures/cycles/cycles.openapi.yaml'),
  scalars: here('./fixtures/scalars/scalars.openapi.yaml'),
} as const

export type PydanticFixtureName = keyof typeof PYDANTIC_FIXTURE_PATHS

export const PYDANTIC_FIXTURE_NAMES = Object.keys(PYDANTIC_FIXTURE_PATHS) as PydanticFixtureName[]

/** A fresh parsed copy on every call. */
export function loadPydanticFixture(name: PydanticFixtureName): OasDocument {
  return parse(readFileSync(PYDANTIC_FIXTURE_PATHS[name], 'utf8')) as OasDocument
}

/** Same document with `components.schemas` keys in reverse order. */
export function withReversedSchemas(doc: OasDocument): OasDocument {
  const schemas = doc.components?.schemas ?? {}
  const reversed = Object.fromEntries(Object.entries(schemas).reverse())
  return { ...doc, components: { ...doc.components, schemas: reversed } } as OasDocument
}

export function goldenPath(relative: string): string {
  return here(`./golden/${relative}`)
}
