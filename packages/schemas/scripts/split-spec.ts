/**
 * split-spec.ts
 *
 * OpenAPI 3.2.0 공식 스펙 원문을 의미 단위로 분할합니다.
 * 원본(submodule)은 수정하지 않고 docs/spec-reference/oas32/ 에 출력합니다.
 *
 * 실행: tsx scripts/split-spec.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
// __dir = oa-sdk/packages/schemas/scripts
const ROOT = join(__dir, '../../..')   // oa-sdk/
const SPEC_PATH = join(ROOT, 'references/OpenAPI-Specification/versions/3.2.0.md')
const OUT_DIR = join(ROOT, 'docs/references/oas32')

// ─── 출력 파일 정의 ──────────────────────────────────────────────────────────
// Objects and Fields 섹션(~4660줄)을 의미 단위로 그룹화
// key: 출력 파일명, value: 포함할 ### 헤더 목록 (정확히 일치)

type SectionGroup = {
  file: string
  title: string
  h3s: string[]  // 포함할 ### 헤더 목록. 빈 배열이면 ## 전체 포함
}

const OBJECTS_GROUPS: SectionGroup[] = [
  {
    file: '03-document-structure.md',
    title: 'Document Structure — OpenAPI / Info / Contact / License',
    h3s: ['OpenAPI Object', 'Info Object', 'Contact Object', 'License Object'],
  },
  {
    file: '04-server.md',
    title: 'Server — Server / Server Variable',
    h3s: ['Server Object', 'Server Variable Object'],
  },
  {
    file: '05-components-paths.md',
    title: 'Components & Paths — Components / Paths',
    h3s: ['Components Object', 'Paths Object'],
  },
  {
    file: '06-operations.md',
    title: 'Operations — Path Item / Operation / External Docs',
    h3s: ['Path Item Object', 'Operation Object', 'External Documentation Object'],
  },
  {
    file: '07-parameters.md',
    title: 'Parameters — Parameter Object',
    h3s: ['Parameter Object'],
  },
  {
    file: '08-request-body.md',
    title: 'Request Body & Media Types — Request Body / Media Type / Encoding',
    h3s: ['Request Body Object', 'Media Type Object', 'Encoding Object'],
  },
  {
    file: '09-responses.md',
    title: 'Responses — Responses / Response / Callback',
    h3s: ['Responses Object', 'Response Object', 'Callback Object'],
  },
  {
    file: '10-examples-links.md',
    title: 'Examples & Links — Example / Link',
    h3s: ['Example Object', 'Link Object'],
  },
  {
    file: '11-headers-tags-refs.md',
    title: 'Headers, Tags & References — Header / Tag / Reference',
    h3s: ['Header Object', 'Tag Object', 'Reference Object'],
  },
  {
    file: '12-schema.md',
    title: 'Schema — Schema Object / Discriminator',
    h3s: ['Schema Object', 'Discriminator Object'],
  },
  {
    file: '13-xml.md',
    title: 'XML Object',
    h3s: ['XML Object'],
  },
  {
    file: '14-security.md',
    title: 'Security — Security Scheme / OAuth Flows / Security Requirement',
    h3s: ['Security Scheme Object', 'OAuth Flows Object', 'OAuth Flow Object', 'Security Requirement Object'],
  },
]

// ─── 파싱 ────────────────────────────────────────────────────────────────────

type ParsedSection = {
  level: 2 | 3
  title: string
  content: string  // 헤더 포함 전체 텍스트
  startLine: number
}

function parseSpec(raw: string): ParsedSection[] {
  const lines = raw.split('\n')
  const sections: ParsedSection[] = []
  let current: { level: 2 | 3; title: string; startLine: number; lines: string[] } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const h2 = line.match(/^## (.+)$/)
    const h3 = line.match(/^### (.+)$/)

    const heading = h2 ?? h3
    if (!heading) {
      current?.lines.push(line)
      continue
    }

    if (current) {
      sections.push({
        level: current.level,
        title: current.title,
        content: current.lines.join('\n').trimEnd(),
        startLine: current.startLine,
      })
    }

    current = {
      level: h2 ? 2 : 3,
      title: heading[1]!.trim(),
      startLine: i + 1,
      lines: [line],
    }
  }

  if (current) {
    sections.push({
      level: current.level,
      title: current.title,
      content: current.lines.join('\n').trimEnd(),
      startLine: current.startLine,
    })
  }

  return sections
}

// ─── 출력 ────────────────────────────────────────────────────────────────────

function backLink(): string {
  return '\n\n---\n← [index](./index.md)\n'
}

function writeSection(filename: string, title: string, content: string): void {
  const path = join(OUT_DIR, filename)
  writeFileSync(path, `<!-- source: OAI/OpenAPI-Specification@3.2.0 -->\n\n${content}${backLink()}`)
  console.log(`  ✓ ${filename} (${content.split('\n').length}줄)`)
}

function run(): void {
  console.log('📖 OpenAPI 3.2.0 스펙 분할 시작\n')

  if (!existsSync(SPEC_PATH)) {
    console.error(`❌ 스펙 파일이 없습니다: ${SPEC_PATH}`)
    console.error('   git submodule update --init --recursive 를 먼저 실행하세요.')
    process.exit(1)
  }

  const raw = readFileSync(SPEC_PATH, 'utf8')
  const sections = parseSpec(raw)

  mkdirSync(join(OUT_DIR, 'appendices'), { recursive: true })

  const h2Map = new Map<string, ParsedSection>()
  const h3Map = new Map<string, ParsedSection>()

  for (const s of sections) {
    if (s.level === 2) h2Map.set(s.title, s)
    else h3Map.set(s.title, s)
  }

  const indexEntries: string[] = [
    '# OpenAPI 3.2.0 스펙 참조 인덱스\n',
    '> source: [OAI/OpenAPI-Specification](../../../../references/OpenAPI-Specification/versions/3.2.0.md) @ 3.2.0\n',
    '> 원본 보존, 탐색 편의를 위한 분할본입니다.\n',
  ]

  // 1. 서두 섹션들 (## Version, ## Introduction, ## Format)
  const introH2s = ['Version 3.2.0', 'Introduction', 'Format']
  const introParts = introH2s.map(t => h2Map.get(t)?.content ?? '').filter(Boolean)
  writeSection('00-overview.md', 'Overview', introParts.join('\n\n'))
  indexEntries.push('\n## 개요\n')
  indexEntries.push('- [00-overview.md](./00-overview.md) — Version, Introduction, Format')

  // 2. Objects and Fields 서두 (##와 직속 ### 들 — OpenAPI Object 이전)
  const formatH3s = ['Versions and Deprecation', 'Undefined and Implementation-Defined Behavior',
    'JSON and YAML Compatibility', 'Case Sensitivity', 'Rich Text Formatting']
  const formatParts = formatH3s.map(t => h3Map.get(t)?.content ?? '').filter(Boolean)
  writeSection('01-format-rules.md', 'Format Rules', formatParts.join('\n\n'))
  indexEntries.push('- [01-format-rules.md](./01-format-rules.md) — Versions, Behavior, JSON/YAML, Formatting')

  // 3. Specification Extensions (## 레벨)
  const extContent = h2Map.get('Specification Extensions')?.content ?? ''
  writeSection('02-extensions.md', 'Specification Extensions', extContent)
  indexEntries.push('- [02-extensions.md](./02-extensions.md) — Specification Extensions')

  // 4. Objects 그룹
  indexEntries.push('\n## Objects & Fields\n')
  for (const group of OBJECTS_GROUPS) {
    const parts = group.h3s.map(h => h3Map.get(h)?.content ?? '').filter(Boolean)
    if (parts.length === 0) {
      console.warn(`  ⚠️  ${group.file}: h3 없음 — 건너뜀`)
      continue
    }
    writeSection(group.file, group.title, parts.join('\n\n'))
    indexEntries.push(`- [${group.file}](./${group.file}) — ${group.title}`)
  }

  // 5. Security Considerations (## 레벨)
  const secConsH2 = h2Map.get('Security Considerations')?.content ?? ''
  // 하위 ### 들도 포함
  const secConsH3s = ['OpenAPI Description Formats', 'Tooling and Usage Scenarios',
    'Security Schemes', 'Security Filtering', 'Handling External Resources',
    'Handling Reference Cycles', 'Markdown and HTML Sanitization']
  const secConsParts = [secConsH2, ...secConsH3s.map(t => h3Map.get(t)?.content ?? '').filter(Boolean)]
  writeSection('15-security-considerations.md', 'Security Considerations', secConsParts.join('\n\n'))
  indexEntries.push('\n## Security\n')
  indexEntries.push('- [15-security-considerations.md](./15-security-considerations.md) — Security Considerations')

  // 6. Appendices
  const appendixMap: Array<{ file: string; h2: string; h3s?: string[] }> = [
    { file: 'appendices/a-revision-history.md', h2: 'Appendix A: Revision History' },
    { file: 'appendices/b-data-type-conversion.md', h2: 'Appendix B: Data Type Conversion' },
    {
      file: 'appendices/c-rfc6570-serialization.md', h2: 'Appendix C: Using RFC6570-Based Serialization',
      h3s: ['Equivalences Between Fields and RFC6570 Operators', 'Delimiters in Parameter Values',
        'Non-RFC6570 Field Values and Combinations', 'Examples'],
    },
    {
      file: 'appendices/d-headers-cookies.md', h2: 'Appendix D: Serializing Headers and Cookies',
      h3s: ['Percent-Encoding and Cookies'],
    },
    {
      file: 'appendices/e-percent-encoding.md', h2: 'Appendix E: Percent-Encoding and Form Media Types',
      h3s: ['Percent-Encoding Character Classes', 'Percent-Encoding and `form-urlencoded`',
        'Percent-Encoding and `form-data`', 'Generating and Validating URIs and `form-urlencoded` Strings',
        'Decoding URIs and `form-urlencoded` Strings', 'Percent-Encoding and Illegal or Reserved Delimiters'],
    },
    {
      file: 'appendices/f-base-uri.md', h2: 'Appendix F: Examples of Base URI Determination and Reference Resolution',
      h3s: ['Base URI Within Content', 'Base URI From Encapsulating Entity',
        'Base URI From the Retrieval URI', 'Application-Specific Default Base URI',
        'Resolving Relative `$self` and `$id`'],
    },
    {
      file: 'appendices/g-parsing-resolution.md', h2: 'Appendix G: Parsing and Resolution Guidance',
      h3s: ['Warnings Regarding Fragmentary Parsing', 'Conflicts Between Field Types and Reference Contexts',
        'Guidance Regarding Implicit Connections'],
    },
  ]

  indexEntries.push('\n## Appendices\n')
  for (const a of appendixMap) {
    const h2Content = h2Map.get(a.h2)?.content ?? ''
    const h3Parts = (a.h3s ?? []).map(t => h3Map.get(t)?.content ?? '').filter(Boolean)
    const combined = [h2Content, ...h3Parts].filter(Boolean).join('\n\n')
    if (!combined) { console.warn(`  ⚠️  ${a.file}: 내용 없음`); continue }
    writeSection(a.file, a.h2, combined)
    indexEntries.push(`- [${a.file}](./${a.file}) — ${a.h2}`)
  }

  // 7. index.md 생성
  writeFileSync(join(OUT_DIR, 'index.md'), indexEntries.join('\n') + '\n')
  console.log(`\n✅ index.md 생성 완료`)
  console.log(`📁 출력 경로: docs/spec-reference/oas32/`)
}

run()
