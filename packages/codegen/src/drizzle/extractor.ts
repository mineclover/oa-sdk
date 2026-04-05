/**
 * Drizzle 스키마 파일에서 테이블 정의를 추출합니다.
 *
 * drizzle-orm 1.x 변경사항:
 *   - entityKind 심볼 제거됨
 *   - 모든 테이블: Symbol.for('drizzle:IsDrizzleTable') === true
 *   - 방언 구분: Symbol.for('drizzle:PgInlineForeignKeys') / MySqlInlineForeignKeys / SQLiteInlineForeignKeys
 *   - 테이블 이름: Symbol.for('drizzle:Name')
 */

import { resolve } from 'node:path'

const IS_DRIZZLE_TABLE = Symbol.for('drizzle:IsDrizzleTable')
const PG_FK      = Symbol.for('drizzle:PgInlineForeignKeys')
const MYSQL_FK   = Symbol.for('drizzle:MySqlInlineForeignKeys')
const SQLITE_FK  = Symbol.for('drizzle:SQLiteInlineForeignKeys')
const NAME_SYM   = Symbol.for('drizzle:Name')

export type DrizzleDialect = 'pg' | 'mysql' | 'sqlite'

export type ExtractedTable = {
  /** SQL 테이블 이름 (예: 'users') */
  sqlName: string
  /** Drizzle 테이블 객체 */
  table: object
  dialect: DrizzleDialect
}

function isDrizzleTable(value: object): boolean {
  return (value as Record<symbol, unknown>)[IS_DRIZZLE_TABLE] === true
}

function getDialect(value: object): DrizzleDialect | null {
  const v = value as Record<symbol, unknown>
  if (Object.prototype.hasOwnProperty.call(v, PG_FK)) return 'pg'
  if (Object.prototype.hasOwnProperty.call(v, MYSQL_FK)) return 'mysql'
  if (Object.prototype.hasOwnProperty.call(v, SQLITE_FK)) return 'sqlite'
  return null
}

function getTableName(table: object): string {
  const name = (table as Record<symbol, unknown>)[NAME_SYM]
  if (typeof name === 'string' && name.length > 0) return name
  throw new Error('테이블 이름을 가져올 수 없습니다. drizzle-orm이 올바르게 설치되었는지 확인하세요.')
}

/**
 * 지정된 경로의 Drizzle 스키마 파일에서 테이블 정의를 추출합니다.
 *
 * @param schemaPath 스키마 파일 경로 (process.cwd() 기준 상대 경로 또는 절대 경로)
 * @returns 추출된 테이블 목록
 *
 * @example
 * const tables = await extractTablesFromPath('./src/db/schema.ts')
 * // [{ sqlName: 'users', table: ..., dialect: 'pg' }, ...]
 */
export async function extractTablesFromPath(schemaPath: string): Promise<ExtractedTable[]> {
  const resolvedPath = resolve(process.cwd(), schemaPath)
  const schemaModule = await import(resolvedPath) as Record<string, unknown>
  return extractTablesFromModule(schemaModule)
}

/**
 * 모듈 exports 객체에서 Drizzle 테이블을 추출합니다.
 * 테스트에서 직접 사용 가능.
 */
export function extractTablesFromModule(
  moduleExports: Record<string, unknown>,
): ExtractedTable[] {
  const tables: ExtractedTable[] = []

  for (const value of Object.values(moduleExports)) {
    if (value === null || typeof value !== 'object') continue
    if (!isDrizzleTable(value as object)) continue

    const dialect = getDialect(value as object)
    if (!dialect) continue

    const sqlName = getTableName(value as object)
    tables.push({ sqlName, table: value as object, dialect })
  }

  return tables
}
