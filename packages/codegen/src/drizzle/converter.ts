/// <reference path="./vendor.d.ts" />
/**
 * Drizzle 테이블 → Zod → OpenAPI Schema 변환
 *
 * drizzle-orm 1.x에서 zod 스키마 함수는 'drizzle-orm/zod' 경로로 통합됨.
 *
 * 생성 스키마 종류:
 *   - select: 전체 컬럼 (nullable/optional 컬럼 포함)
 *   - insert: 삽입 시 필요한 필드 (defaulted/generated 제외)
 *   - update: 업데이트용 (모든 필드 optional)
 */

import { zodToSchema, type OasSchema } from '../zod-to-schema.js'
import type { ExtractedTable } from './extractor.js'
import type { TableNaming } from './naming.js'

export type DrizzleSchemaType = 'select' | 'insert' | 'update'

export type NamedOasSchema = {
  name: string
  schema: OasSchema
  sourceTable: string
  schemaType: DrizzleSchemaType
}

type ZodSchemaFactory = {
  createSelectSchema: (table: object) => import('zod').ZodTypeAny
  createInsertSchema: (table: object) => import('zod').ZodTypeAny
  createUpdateSchema: (table: object) => import('zod').ZodTypeAny
}

/**
 * drizzle-orm/zod를 동적으로 로드합니다. (drizzle-orm 1.x 전용)
 */
async function loadZodFactory(): Promise<ZodSchemaFactory> {
  try {
    return await import('drizzle-orm/zod') as unknown as ZodSchemaFactory
  } catch {
    throw new Error(
      'drizzle-orm/zod를 로드할 수 없습니다.\n' +
      'drizzle-orm@>=1.0.0-beta.20을 설치하세요:\n' +
      '  pnpm add drizzle-orm@beta',
    )
  }
}

/**
 * 단일 테이블을 지정된 스키마 타입들로 변환합니다.
 * factory를 외부에서 주입받아 convertTables와 일관성 유지.
 */
function convertTableWithFactory(
  table: ExtractedTable,
  types: DrizzleSchemaType[],
  naming: TableNaming,
  factory: ZodSchemaFactory,
): NamedOasSchema[] {
  const result: NamedOasSchema[] = []

  if (types.includes('select')) {
    result.push({
      name: naming.select(table.sqlName),
      schema: zodToSchema(factory.createSelectSchema(table.table)),
      sourceTable: table.sqlName,
      schemaType: 'select',
    })
  }
  if (types.includes('insert')) {
    result.push({
      name: naming.insert(table.sqlName),
      schema: zodToSchema(factory.createInsertSchema(table.table)),
      sourceTable: table.sqlName,
      schemaType: 'insert',
    })
  }
  if (types.includes('update')) {
    result.push({
      name: naming.update(table.sqlName),
      schema: zodToSchema(factory.createUpdateSchema(table.table)),
      sourceTable: table.sqlName,
      schemaType: 'update',
    })
  }

  return result
}

/**
 * 단일 테이블을 지정된 스키마 타입들로 변환합니다.
 */
export async function convertTable(
  table: ExtractedTable,
  types: DrizzleSchemaType[],
  naming: TableNaming,
): Promise<NamedOasSchema[]> {
  const factory = await loadZodFactory()
  return convertTableWithFactory(table, types, naming, factory)
}

/**
 * 여러 테이블을 일괄 변환합니다. factory는 한 번만 로드합니다.
 */
export async function convertTables(
  tables: ExtractedTable[],
  types: DrizzleSchemaType[],
  naming: TableNaming,
): Promise<NamedOasSchema[]> {
  const factory = await loadZodFactory()
  return tables.flatMap(t => convertTableWithFactory(t, types, naming, factory))
}
