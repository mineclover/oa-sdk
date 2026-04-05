/**
 * 공유 출력 로직 — components.yaml 쓰기 + spec.yaml 병합
 *
 * generator.ts와 drizzle/index.ts 모두 이 모듈을 사용합니다.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { mergeIntoSpec } from './spec-merge.js'
import type { OutputOptions, NamedSchema } from './types.js'

/**
 * NamedSchema[]를 OutputOptions에 따라 파일로 출력합니다.
 *
 * @returns 생성된 파일 경로 목록
 */
export function writeSchemas(
  schemas: NamedSchema[],
  options: OutputOptions,
  warnings: string[],
): string[] {
  if (options.mergeIntoSpec && options.specPath) {
    mergeIntoSpec(schemas, options.specPath, warnings)
    return [options.specPath]
  }

  mkdirSync(options.output, { recursive: true })
  const grouping = options.grouping ?? 'single'
  const files: string[] = []

  if (grouping === 'single') {
    const filename = options.filename ?? 'components'
    const outputPath = join(options.output, `${filename}.yaml`)
    writeFileSync(outputPath, buildComponentsYaml(schemas), 'utf8')
    files.push(outputPath)
  } else {
    for (const entry of schemas) {
      const outputPath = join(options.output, `${toKebabCase(entry.name)}.yaml`)
      writeFileSync(outputPath, buildComponentsYaml([entry]), 'utf8')
      files.push(outputPath)
    }
  }

  return files
}

function buildComponentsYaml(schemas: NamedSchema[]): string {
  const spec = {
    components: {
      schemas: Object.fromEntries(schemas.map(s => [s.name, s.schema])),
    },
  }
  return stringifyYaml(spec, { lineWidth: 0 })
}

function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '')
}
