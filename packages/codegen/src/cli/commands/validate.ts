import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { str } from '../lib/args.js'

export const validate: Command = {
  name: 'validate',
  description: '종합 검증 (파싱 + 린트 + 3.1 호환)',
  options: {
    spec: { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
  },
  async run(args) {
    const { validateDocument } = await import('@oa-sdk/parser')
    const specPath = str(args, 'spec')
    const { document: doc, path: resolvedSpecPath } = loadSpecWithPath(specPath)

    console.log('━━━ Step 1: 파싱 + 구조 검증 ━━━')
    const result = validateDocument(doc, { basePath: resolvedSpecPath })

    for (const r of [...result.errors, ...result.warnings, ...result.infos]) {
      const icon = r.severity === 'error' ? '❌' : r.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.log(`  ${icon} [${r.rule}] ${r.message}`)
    }
    console.log(result.summary)

    console.log('\n━━━ Step 2: 3.1 호환성 ━━━')
    const version = (doc as Record<string, unknown>)['openapi'] as string
    if (version === '3.2.0') {
      const raw = readFileSync(resolve(process.cwd(), specPath), 'utf8')
      const features32 = [
        { name: 'dataValue', count: (raw.match(/dataValue/g) ?? []).length },
        { name: 'serializedValue', count: (raw.match(/serializedValue/g) ?? []).length },
        { name: 'itemSchema', count: (raw.match(/itemSchema/g) ?? []).length },
        { name: 'deviceAuthorization', count: (raw.match(/deviceAuthorization/g) ?? []).length },
        { name: 'oauth2MetadataUrl', count: (raw.match(/oauth2MetadataUrl/g) ?? []).length },
      ].filter(f => f.count > 0)

      if (features32.length > 0) {
        console.log('  3.2 전용 필드 사용:')
        for (const f of features32) console.log(`    ${f.name}: ${f.count}회`)
        console.log('  → pnpm --filter @oa-sdk/schemas run downgrade:3.1 로 3.1 변환 가능')
      } else {
        console.log('  3.2 전용 필드 미사용 — 3.1과 완전 호환')
      }
    } else {
      console.log(`  이미 OAS ${version} — 3.1 호환`)
    }

    if (!result.valid) process.exit(1)
  },
}
