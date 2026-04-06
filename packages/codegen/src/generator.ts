/**
 * generator.ts — Zod 스키마 → OpenAPI components YAML 생성
 *
 * Zod 스키마 맵을 받아 OAS 3.2 components YAML로 변환합니다.
 * 출력은 writer.ts에 위임합니다.
 */

import type { z } from 'zod'
import { zodToSchema } from './zod-to-schema.js'
import { writeSchemas } from './writer.js'
import type { OutputOptions, CodegenResult } from './types.js'

/**
 * 이름이 지정된 Zod 스키마 맵을 OpenAPI components YAML로 변환합니다.
 */
export function generateComponents(
  schemas: Record<string, z.ZodTypeAny>,
  options: OutputOptions,
): CodegenResult {
  // Build refs map for $ref resolution (ZodLazy recursive schemas)
  const refs = new Map<z.ZodTypeAny, string>()
  for (const [name, schema] of Object.entries(schemas)) {
    refs.set(schema, name)
  }
  const context = { refs }

  const components = Object.entries(schemas).map(([name, schema]) => ({
    name,
    schema: zodToSchema(schema, context) as Record<string, unknown>,
  }))

  const warnings: string[] = []
  const files = writeSchemas(components, options, warnings)

  return {
    components: components.map(c => ({ ...c, sourceTable: '' })),
    files,
    warnings,
  }
}
