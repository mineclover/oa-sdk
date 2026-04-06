/**
 * @oa-sdk/codegen — Drizzle 통합 공개 API
 *
 * 사용 예시:
 *   import { generateFromDrizzle } from '@oa-sdk/codegen/drizzle'
 *
 *   await generateFromDrizzle({
 *     schemaPath: './src/db/schema.ts',
 *     output: './packages/schemas/src/domains/users/',
 *     schemas: ['select', 'insert', 'update'],
 *   })
 */

import { resolve } from 'node:path'
import { extractTablesFromPath } from './extractor.js'
import { convertTables, type DrizzleSchemaType } from './converter.js'
import { defaultNaming, type TableNaming } from './naming.js'
import { writeSchemas } from '../writer.js'
import type { OutputOptions, CodegenResult } from '../types.js'

export type { ExtractedTable, DrizzleDialect } from './extractor.js'
export type { DrizzleSchemaType, NamedOasSchema } from './converter.js'
export type { TableNaming } from './naming.js'

export type DrizzleCodegenOptions = OutputOptions & {
  /** Drizzle 스키마 파일 경로 (process.cwd() 기준) */
  schemaPath: string
  /**
   * 생성할 스키마 타입 (기본값: ['select', 'insert', 'update'])
   * - 'select': 전체 컬럼 스키마 (응답 모델)
   * - 'insert': 삽입 스키마 (create 요청 바디)
   * - 'update': 업데이트 스키마 (update 요청 바디)
   */
  schemas?: DrizzleSchemaType[]
  /** 컴포넌트 이름 변환 (기본: users → User / InsertUser / UpdateUser) */
  naming?: Partial<TableNaming>
}

/**
 * Drizzle 스키마 파일에서 OpenAPI components YAML을 생성합니다.
 */
export async function generateFromDrizzle(options: DrizzleCodegenOptions): Promise<CodegenResult> {
  const schemaTypes: DrizzleSchemaType[] = options.schemas ?? ['select', 'insert', 'update']
  const naming: TableNaming = {
    select: options.naming?.select ?? defaultNaming.select,
    insert: options.naming?.insert ?? defaultNaming.insert,
    update: options.naming?.update ?? defaultNaming.update,
  }

  const tables = await extractTablesFromPath(options.schemaPath)

  if (tables.length === 0) {
    return { components: [], files: [], warnings: ['스키마 파일에서 Drizzle 테이블을 찾을 수 없습니다.'] }
  }

  const namedSchemas = await convertTables(tables, schemaTypes, naming)
  const warnings: string[] = []

  const outputOptions: OutputOptions = {
    output: resolve(process.cwd(), options.output),
  }
  if (options.grouping !== undefined) outputOptions.grouping = options.grouping
  if (options.filename !== undefined) outputOptions.filename = options.filename
  if (options.mergeIntoSpec !== undefined) outputOptions.mergeIntoSpec = options.mergeIntoSpec
  if (options.specPath !== undefined) outputOptions.specPath = resolve(process.cwd(), options.specPath)

  const files = writeSchemas(
    namedSchemas.map(s => ({ name: s.name, schema: s.schema as Record<string, unknown> })),
    outputOptions,
    warnings,
  )

  return {
    components: namedSchemas.map(s => ({
      name: s.name,
      schema: s.schema as Record<string, unknown>,
      sourceTable: s.sourceTable,
    })),
    files,
    warnings,
  }
}
