import { writeFileSync, existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs'
import { resolve, join } from 'node:path'
import type { Command } from '../lib/types.js'
import { tryImport } from '../lib/try-import.js'
import { str, optStr } from '../lib/args.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import {
  closeCliIncrementalRun,
  createCliIncrementalRun,
  recordCliIncrementalIndex,
} from '../lib/incremental.js'

export const dev: Command = {
  name: 'dev',
  description: 'Watch mode — spec 변경 시 자동 재생성',
  options: {
    spec:           { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    output:         { type: 'string', short: 'o', description: '출력 디렉토리 (기본: ./generated)' },
    style:          { type: 'string', description: 'type | interface (기본: type)' },
    target:         { type: 'string', description: 'hono | express (기본: hono)' },
    'types-import': { type: 'string', description: 'typegen 타입 import 경로 (기본: ./types)' },
    'cache-dir':    { type: 'string', description: '증분 workspace index 디렉토리 (기본: ./.oa-cache)' },
  },
  async run(args) {
    const specPath = str(args, 'spec')
    const resolvedSpec = resolve(process.cwd(), specPath)
    const resolvedOutput = resolve(process.cwd(), optStr(args, 'output') ?? './generated')
    const typesImport = optStr(args, 'types-import') ?? './types'
    const style: 'interface' | 'type' = optStr(args, 'style') === 'interface' ? 'interface' : 'type'
    const target: 'express' | 'hono' = optStr(args, 'target') === 'express' ? 'express' : 'hono'
    const cacheDir = optStr(args, 'cache-dir')

    if (!existsSync(resolvedSpec)) {
      console.error(`오류: 스펙 파일을 찾을 수 없습니다: ${resolvedSpec}`)
      process.exit(1)
    }

    const watchers = new Map<string, FSWatcher>()
    let debounce: NodeJS.Timeout | undefined

    const syncWatchers = (filePaths: readonly string[]) => {
      const next = new Set(filePaths)
      for (const [filePath, watcher] of watchers) {
        if (next.has(filePath)) continue
        watcher.close()
        watchers.delete(filePath)
      }
      for (const filePath of next) {
        if (watchers.has(filePath)) continue
        try {
          watchers.set(filePath, watch(filePath, { persistent: true }, (eventType) => {
            if (eventType === 'change' || eventType === 'rename') scheduleGenerate()
          }))
        } catch (error) {
          console.warn(`[oa-gen] watch skipped: ${filePath} (${error instanceof Error ? error.message : String(error)})`)
        }
      }
    }

    const scheduleGenerate = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(async () => {
        console.log('[oa-gen] spec changed, regenerating...')
        await generate()
      }, 50)
    }

    const generate = async () => {
      const incremental = createCliIncrementalRun({
        enabled: true,
        specPath,
        ...(cacheDir ? { cacheDir } : {}),
      })
      try {
        const { document: doc } = loadSpecWithPath(specPath)
        mkdirSync(resolvedOutput, { recursive: true })

        const { generateTypesFromSpec } = await import('../../typegen/generate-types.js')
        const warnings: string[] = []
        writeFileSync(join(resolvedOutput, 'types.ts'), generateTypesFromSpec(doc, { style, basePath: resolvedSpec, warnings }), 'utf8')
        for (const warning of warnings) console.warn(`⚠️  ${warning}`)

        const { generateRouter } = await tryImport('@oa-sdk/router')
        writeFileSync(join(resolvedOutput, 'router.ts'), generateRouter(doc, { target, typesImport, basePath: resolvedSpec }), 'utf8')

        const { generateClient } = await tryImport('@oa-sdk/client')
        writeFileSync(join(resolvedOutput, 'client.ts'), generateClient(doc, { typesImport, basePath: resolvedSpec }), 'utf8')

        console.log(`[oa-gen] generated → ${resolvedOutput}/`)
        const indexedFiles = await recordCliIncrementalIndex(incremental, doc, {
          diagnostics: warnings.map(warning => ({
            producer: 'typegen',
            severity: 'warning',
            code: 'typegen/warning',
            message: warning,
            filePath: resolvedSpec,
            pointer: '#',
          })),
        })
        syncWatchers(indexedFiles.map(file => file.filePath))
      } catch (e) {
        console.error('[oa-gen] error:', e)
      } finally {
        closeCliIncrementalRun(incremental)
      }
    }

    await generate()

    console.log(`[oa-gen] watching ${resolvedSpec}...`)
    process.on('SIGINT', () => {
      if (debounce) clearTimeout(debounce)
      for (const watcher of watchers.values()) watcher.close()
      process.exit(0)
    })
  },
}
