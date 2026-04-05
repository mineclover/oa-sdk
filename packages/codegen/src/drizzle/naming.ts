/**
 * Drizzle 테이블 이름 → OpenAPI 컴포넌트 이름 변환
 *
 * 기본 규칙 (SQL snake_case → PascalCase):
 *   users          → User        (select)
 *                  → InsertUser  (insert)
 *                  → UpdateUser  (update)
 *   blog_posts     → BlogPost
 *   order_items    → OrderItem
 */

export type TableNaming = {
  select: (sqlName: string) => string
  insert: (sqlName: string) => string
  update: (sqlName: string) => string
}

import { pascalCase } from '@oa-sdk/core'

export const defaultNaming: TableNaming = {
  select: (name) => toSingularPascal(name),
  insert: (name) => `Insert${toSingularPascal(name)}`,
  update: (name) => `Update${toSingularPascal(name)}`,
}

function toSingularPascal(sqlName: string): string {
  const parts = sqlName.split('_')
  parts[parts.length - 1] = singularize(parts[parts.length - 1]!)
  return pascalCase(parts.join('_'))
}

function singularize(word: string): string {
  // 복수형 → 단수형 간단 규칙 (영어 기준)
  if (word.endsWith('sses') || word.endsWith('xes') || word.endsWith('zes')) {
    return word.slice(0, -2)  // addresses → address, boxes → box
  }
  if (word.endsWith('shes') || word.endsWith('ches')) {
    return word.slice(0, -2)  // dishes → dish, watches → watch
  }
  // ses (not sses): statuses → status, buses → bus
  // 단, base가 se로 끝나는 경우(cases→case)는 제외 — candidate가 s/sh/ch/x/z로 끝나야 es 제거
  if (word.endsWith('ses') && !word.endsWith('sses')) {
    const candidate = word.slice(0, -2)
    if (/[sxz]$/.test(candidate) || candidate.endsWith('sh') || candidate.endsWith('ch')) {
      return candidate  // statuses → status, buses → bus
    }
  }
  if (word.endsWith('ies')) {
    return word.slice(0, -3) + 'y'  // categories → category
  }
  if (word.endsWith('ves')) {
    return word.slice(0, -3) + 'f'  // leaves → leaf (approximation)
  }
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) {
    return word.slice(0, -1)  // users → user, posts → post
  }
  return word
}
