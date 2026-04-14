import { readFileSync, writeFileSync, existsSync, mkdirSync, watch } from 'node:fs'
import { resolve, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Command } from '../lib/types.js'
import type { OasDocument } from '@oa-sdk/parser'
import { tryImport } from '../lib/try-import.js'
import { str, optStr } from '../lib/args.js'

export const dev: Command = {
  name: 'dev',
  description: 'Watch mode — spec 변경 시 자동 재생성',
  options: {
    spec:           { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    output:         { type: 'string', short: 'o', description: '출력 디렉토리 (기본: ./generated)' },
    style:          { type: 'string', description: 'type | interface (기본: type)' },
    target:         { type: 'string', description: 'hono | express (기본: hono)' },
    'types-import': { type: 'string', description: 'typegen 타입 import 경로 (기본: ./types)' },
  },
  async run(args) {
    const specPath = str(args, 'spec')
    const resolvedSpec = resolve(process.cwd(), specPath)
    const resolvedOutput = resolve(process.cwd(), optStr(args, 'output') ?? './generated')
    const typesImport = optStr(args, 'types-import') ?? './types'
    const style: 'interface' | 'type' = optStr(args, 'style') === 'interface' ? 'interface' : 'type'
    const target: 'express' | 'hono' = optStr(args, 'target') === 'express' ? 'express' : 'hono'

    if (!existsSync(resolvedSpec)) {
      console.error(`오류: 스펙 파일을 찾을 수 없습니다: ${resolvedSpec}`)
      process.exit(1)
    }

    const generate = async () => {
      try {
        const raw = readFileSync(resolvedSpec, 'utf8')
        const doc = (specPath.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)) as OasDocument
        mkdirSync(resolvedOutput, { recursive: true })

        const { generateTypesFromSpec } = await import('../../typegen/generate-types.js')
        writeFileSync(join(resolvedOutput, 'types.ts'), generateTypesFromSpec(doc, { style }), 'utf8')

        const { generateRouter } = await tryImport('@oa-sdk/router')
        writeFileSync(join(resolvedOutput, 'router.ts'), generateRouter(doc, { target, typesImport, basePath: resolvedSpec }), 'utf8')

        const { generateClient } = await tryImport('@oa-sdk/client')
        writeFileSync(join(resolvedOutput, 'client.ts'), generateClient(doc, { typesImport, basePath: resolvedSpec }), 'utf8')

        console.log(`[oa-gen] generated → ${resolvedOutput}/`)
      } catch (e) {
        console.error('[oa-gen] error:', e)
      }
    }

    await generate()

    console.log(`[oa-gen] watching ${resolvedSpec}...`)
    const watcher = watch(resolvedSpec, { persistent: true }, async (eventType) => {
      if (eventType === 'change') {
        console.log('[oa-gen] spec changed, regenerating...')
        await generate()
      }
    })
    process.on('SIGINT', () => { watcher.close(); process.exit(0) })
  },
}
