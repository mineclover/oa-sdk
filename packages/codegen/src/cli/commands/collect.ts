import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { optStr, str } from '../lib/args.js'
import {
  createOpenApiCollectReport,
  normalizeOpenApiDocument,
  parseOpenApiCollectProfile,
  upgradeOpenApiDocumentTo32,
  writeJson,
  writeOpenApiYaml,
} from '../lib/openapi-collect.js'

export const collect: Command = {
  name: 'collect',
  description: '외부 OpenAPI 산출물 수집 scaffold: raw 보존, normalize, 3.2 upgrade',
  options: {
    spec: { type: 'string', short: 's', required: true, description: '수집할 OpenAPI YAML/JSON 경로' },
    raw: { type: 'string', description: '원본 산출물 복사 경로' },
    normalized: { type: 'string', required: true, description: 'stable governance artifact 출력 경로' },
    upgraded: { type: 'string', required: true, description: 'OpenAPI 3.2 분석 artifact 출력 경로' },
    report: { type: 'string', description: '수집/변환 리포트 JSON 출력 경로' },
    profile: { type: 'string', description: 'generic | nestjs-swagger | fastapi (기본: generic)' },
  },
  async run(args) {
    const spec = str(args, 'spec')
    const raw = optStr(args, 'raw')
    const normalizedPath = str(args, 'normalized')
    const upgradedPath = str(args, 'upgraded')
    const reportPath = optStr(args, 'report')
    const profile = parseOpenApiCollectProfile(optStr(args, 'profile'))
    const { document, path } = loadSpecWithPath(spec)

    if (raw) {
      const resolvedRaw = resolve(process.cwd(), raw)
      mkdirSync(dirname(resolvedRaw), { recursive: true })
      copyFileSync(path, resolvedRaw)
    }

    const normalized = normalizeOpenApiDocument(document, { profile })
    writeOpenApiYaml(normalizedPath, normalized)

    const upgraded = upgradeOpenApiDocumentTo32(normalized)
    writeOpenApiYaml(upgradedPath, upgraded.document)

    if (reportPath) {
      writeJson(reportPath, createOpenApiCollectReport({
        profile,
        raw: raw ?? path,
        normalized: normalizedPath,
        upgraded: upgradedPath,
        upgrade: upgraded.report,
      }))
    }

    console.log(`✅ OpenAPI normalized: ${normalizedPath}`)
    console.log(`✅ OpenAPI upgraded: ${upgradedPath}`)
    if (raw) console.log(`✅ OpenAPI raw copied: ${raw}`)
    if (reportPath) console.log(`✅ OpenAPI collect report: ${reportPath}`)
  },
}
