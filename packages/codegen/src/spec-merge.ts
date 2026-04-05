/**
 * 내부 공유 유틸: OpenAPI spec.yaml에 components.schemas를 병합합니다.
 * generator.ts와 drizzle/index.ts에서 공통으로 사용됩니다.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { NamedSchema } from './types.js'

/**
 * 기존 OpenAPI spec.yaml에 components.schemas를 병합합니다.
 * 이미 존재하는 키는 경고 후 덮어씁니다.
 */
export function mergeIntoSpec(
  components: NamedSchema[],
  specPath: string,
  warnings: string[],
): void {
  let spec: Record<string, unknown> = {}

  if (existsSync(specPath)) {
    const raw = readFileSync(specPath, 'utf8')
    spec = (parseYaml(raw) as Record<string, unknown>) ?? {}
  }

  const existingComponents = (spec['components'] as Record<string, unknown> | undefined) ?? {}
  const existingSchemas = (existingComponents['schemas'] as Record<string, unknown> | undefined) ?? {}

  for (const { name, schema } of components) {
    if (Object.prototype.hasOwnProperty.call(existingSchemas, name)) {
      warnings.push(`components.schemas.${name} 이미 존재 — 덮어씁니다`)
    }
    existingSchemas[name] = schema
  }

  spec['components'] = { ...existingComponents, schemas: existingSchemas }
  mkdirSync(dirname(specPath), { recursive: true })
  writeFileSync(specPath, stringifyYaml(spec, { lineWidth: 0 }), 'utf8')
}
