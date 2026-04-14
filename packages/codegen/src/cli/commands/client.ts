import type { Command } from '../lib/types.js'
import { loadSpec } from '../lib/load-spec.js'
import { writeOutput } from '../lib/output.js'
import { tryImport } from '../lib/try-import.js'
import { str, optStr } from '../lib/args.js'

export const client: Command = {
  name: 'client',
  description: 'OAS spec → 클라이언트 SDK',
  options: {
    spec:           { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    output:         { type: 'string', short: 'o', description: '출력 파일 경로 (기본: stdout)' },
    'types-import': { type: 'string', description: 'typegen 타입 import 경로' },
  },
  async run(args) {
    const { generateClient } = await tryImport('@oa-sdk/client')
    const doc = loadSpec(str(args, 'spec'))
    const typesImport = optStr(args, 'types-import')
    const opts: { typesImport?: string } = {}
    if (typesImport) opts.typesImport = typesImport
    writeOutput(optStr(args, 'output'), generateClient(doc, opts), 'client 코드 생성')
  },
}
