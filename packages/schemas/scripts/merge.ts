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
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'

const __dir = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dir, '../src')
const outPath = join(srcDir, '.merged.yaml')

type OpenApiSpec = {
  openapi?: string
  info?: unknown
  tags?: unknown[]
  servers?: unknown[]
  paths?: Record<string, unknown>
  components?: Record<string, Record<string, unknown>>
  [key: string]: unknown
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
  const base = parse(readFileSync(join(srcDir, 'openapi.yaml'), 'utf8')) as OpenApiSpec
  base.paths = {}
  base.components = {}

  // 2. profile → servers
  const profileSpec = parse(readFileSync(profilePath, 'utf8')) as { servers: unknown[] }
  base.servers = profileSpec.servers
  console.log(`📌 Profile: ${profile}`)

  // 3. domain specs — common 먼저, 나머지 알파벳 순
  const domainsDir = join(srcDir, 'domains')
  const domainNames = readdirSync(domainsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort((a, b) => (a === 'common' ? -1 : b === 'common' ? 1 : a.localeCompare(b)))

  let pathCount = 0
  let componentCount = 0

  for (const name of domainNames) {
    const specPath = join(domainsDir, name, 'spec.yaml')
    if (!existsSync(specPath)) continue

    const domain = parse(readFileSync(specPath, 'utf8')) as OpenApiSpec

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
        if (base.paths[path] !== undefined) {
          console.error(`❌ 중복 경로: '${path}' (도메인: ${name})`)
          process.exit(1)
        }
        base.paths[path] = item
        pathCount++
      }
    }

    // components 병합 (schemas, responses, parameters, securitySchemes 등)
    if (domain.components) {
      for (const [section, items] of Object.entries(domain.components)) {
        base.components[section] ??= {}
        for (const [key, val] of Object.entries(items)) {
          if (base.components[section]![key] !== undefined) {
            console.warn(`⚠️  중복 컴포넌트: ${section}.${key} (도메인: ${name}, 덮어씀)`)
          }
          base.components[section]![key] = val
          componentCount++
        }
      }
    }

    console.log(`  ✓ ${name} (paths: ${Object.keys(domain.paths ?? {}).length}, components: ${countComponents(domain.components)})`)
  }

  writeFileSync(outPath, stringify(base, { lineWidth: 0 }))
  console.log(`\n📦 .merged.yaml 생성 완료`)
  console.log(`   경로: ${pathCount}개 / 컴포넌트: ${componentCount}개`)
}

function countComponents(components: Record<string, Record<string, unknown>> | undefined): number {
  if (!components) return 0
  return Object.values(components).reduce((sum, section) => sum + Object.keys(section).length, 0)
}

run()
