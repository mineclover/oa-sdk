/**
 * merge.ts — 도메인 spec 병합 스크립트
 *
 * 실행:
 *   pnpm merge                  → local 프로필 (기본값)
 *   pnpm merge staging          → staging 프로필
 *   PROFILE=production pnpm merge
 *
 * 동작:
 *   1. src/openapi.yaml (info, tags) 를 base로 읽음
 *   2. src/profiles/{profile}.yaml 에서 servers 주입
 *   3. src/domains/{*}/spec.yaml 를 스캔하여 paths / components 병합
 *   4. src/.merged.yaml 로 출력 (validate/bundle의 입력)
 *
 * 병합 규칙:
 *   - paths: 중복 경로 → 오류
 *   - components.*: 중복 키 → 경고 후 나중 도메인이 우선
 *   - 도메인 처리 순서: common → 나머지 (알파벳 순)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'

const __dir = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dir, '../src')
const outPath = join(srcDir, '.merged.yaml')

export type OpenApiSpec = {
  openapi?: string
  info?: unknown
  tags?: unknown[]
  servers?: unknown[]
  paths?: Record<string, unknown>
  components?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

export type MergeResult = {
  document: OpenApiSpec
  pathCount: number
  componentCount: number
  warnings: string[]
}

/**
 * 도메인별 spec을 하나로 병합하는 핵심 로직 (순수 함수)
 *
 * @param baseSpec   openapi.yaml 에서 파싱된 base 스펙
 * @param profileSpec   프로필에서 파싱된 { servers: ... }
 * @param domainSpecs   도메인 이름 → 파싱된 spec 맵 (이미 정렬된 순서로 전달)
 */
export function mergeSpecs(
  baseSpec: OpenApiSpec,
  profileSpec: { servers: unknown[] },
  domainSpecs: Array<{ name: string; spec: OpenApiSpec }>,
): MergeResult {
  const base: OpenApiSpec = { ...baseSpec }
  base.paths = {}
  base.components = {}
  base.servers = profileSpec.servers

  const warnings: string[] = []
  let pathCount = 0
  let componentCount = 0

  for (const { name, spec: domain } of domainSpecs) {
    // tags 병합 (도메인이 자체 태그를 선언한 경우)
    if (domain.tags) {
      base.tags ??= []
      const existingNames = new Set((base.tags as Array<{ name: string }>).map(t => t.name))
      for (const tag of domain.tags as Array<{ name: string }>) {
        if (!existingNames.has(tag.name)) {
          base.tags.push(tag)
          existingNames.add(tag.name)
        }
      }
    }

    // paths 병합
    if (domain.paths) {
      for (const [path, item] of Object.entries(domain.paths)) {
        if (base.paths![path] !== undefined) {
          throw new Error(`중복 경로: '${path}' (도메인: ${name})`)
        }
        base.paths![path] = item
        pathCount++
      }
    }

    // components 병합 (schemas, responses, parameters, securitySchemes 등)
    if (domain.components) {
      for (const [section, items] of Object.entries(domain.components)) {
        base.components![section] ??= {}
        for (const [key, val] of Object.entries(items)) {
          if (base.components![section]![key] !== undefined) {
            warnings.push(
              `중복 컴포넌트: ${section}.${key} (도메인: ${name}, 기존 정의를 덮어씀). ` +
              `스키마 이름 충돌 방지를 위해 도메인 접두사 또는 공통 컴포넌트 소유권을 확인하세요.`,
            )
          }
          base.components![section]![key] = val
          componentCount++
        }
      }
    }
  }

  return { document: base, pathCount, componentCount, warnings }
}

/**
 * 도메인 이름 배열을 common-first + 알파벳 순으로 정렬
 */
export function sortDomainNames(names: string[]): string[] {
  return [...names].sort((a, b) => (a === 'common' ? -1 : b === 'common' ? 1 : a.localeCompare(b)))
}

export function countComponents(components: Record<string, Record<string, unknown>> | undefined): number {
  if (!components) return 0
  return Object.values(components).reduce((sum, section) => sum + Object.keys(section).length, 0)
}

function run(): void {
  const profile = process.env['PROFILE'] ?? process.argv[2] ?? 'local'
  const profilePath = join(srcDir, 'profiles', `${profile}.yaml`)

  if (!existsSync(profilePath)) {
    const available = readdirSync(join(srcDir, 'profiles'))
      .filter(f => f.endsWith('.yaml'))
      .map(f => f.replace('.yaml', ''))
    console.error(`❌ 프로필 '${profile}' 없음. 사용 가능: ${available.join(', ')}`)
    process.exit(1)
  }

  // 1. base (info + tags)
  const baseSpec = parse(readFileSync(join(srcDir, 'openapi.yaml'), 'utf8')) as OpenApiSpec

  // 2. profile → servers
  const profileSpec = parse(readFileSync(profilePath, 'utf8')) as { servers: unknown[] }
  console.log(`📌 Profile: ${profile}`)

  // 3. domain specs — common 먼저, 나머지 알파벳 순
  const domainsDir = join(srcDir, 'domains')
  const domainNames = sortDomainNames(
    readdirSync(domainsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name),
  )

  const domainSpecs: Array<{ name: string; spec: OpenApiSpec }> = []
  for (const name of domainNames) {
    const specPath = join(domainsDir, name, 'spec.yaml')
    if (!existsSync(specPath)) continue
    domainSpecs.push({ name, spec: parse(readFileSync(specPath, 'utf8')) as OpenApiSpec })
  }

  try {
    const result = mergeSpecs(baseSpec, profileSpec, domainSpecs)

    for (const w of result.warnings) {
      console.warn(`⚠️  ${w}`)
    }
    for (const { name, spec } of domainSpecs) {
      console.log(`  ✓ ${name} (paths: ${Object.keys(spec.paths ?? {}).length}, components: ${countComponents(spec.components)})`)
    }

    writeFileSync(outPath, stringify(result.document, { lineWidth: 0 }))
    console.log(`\n📦 .merged.yaml 생성 완료`)
    console.log(`   경로: ${result.pathCount}개 / 컴포넌트: ${result.componentCount}개`)
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`)
    process.exit(1)
  }
}

run()
