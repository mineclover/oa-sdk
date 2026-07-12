import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { writeOutput } from '../lib/output.js'
import { tryImport } from '../lib/try-import.js'
import { choice, str, optStr } from '../lib/args.js'

export const router: Command = {
  name: 'router',
  description: 'OAS spec → 라우터 스텁',
  options: {
    spec:           { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    output:         { type: 'string', short: 'o', description: '출력 파일 경로 (기본: stdout)' },
    target:         { type: 'string', description: 'hono | express (기본: hono)' },
    'types-import': { type: 'string', description: 'typegen 타입 import 경로' },
  },
  async run(args) {
    const { generateRouter } = await tryImport('@oa-sdk/router')
    const { document: doc, path: resolvedSpecPath } = loadSpecWithPath(str(args, 'spec'))
    const target = choice(args, 'target', ['hono', 'express'] as const, 'hono')
    const typesImport = optStr(args, 'types-import')
    const opts: { target: 'express' | 'hono'; typesImport?: string; basePath: string } = { target, basePath: resolvedSpecPath }
    if (typesImport) opts.typesImport = typesImport
    writeOutput(optStr(args, 'output'), generateRouter(doc, opts), 'router 코드 생성')
  },
}
