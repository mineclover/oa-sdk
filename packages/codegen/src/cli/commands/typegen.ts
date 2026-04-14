import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { writeOutput } from '../lib/output.js'
import { str, optStr } from '../lib/args.js'

export const typegen: Command = {
  name: 'typegen',
  description: 'OAS spec → TypeScript 타입',
  options: {
    spec:   { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    output: { type: 'string', short: 'o', description: '출력 파일 경로 (기본: stdout)' },
    style:  { type: 'string', description: 'type | interface (기본: type)' },
  },
  async run(args) {
    const { generateTypesFromSpec } = await import('../../typegen/generate-types.js')
    const { document: doc, path: resolvedSpecPath } = loadSpecWithPath(str(args, 'spec'))
    const style: 'interface' | 'type' = optStr(args, 'style') === 'interface' ? 'interface' : 'type'
    const warnings: string[] = []
    const ts = generateTypesFromSpec(doc, { style, basePath: resolvedSpecPath, warnings })
    for (const warning of warnings) console.warn(`⚠️  ${warning}`)
    writeOutput(optStr(args, 'output'), ts, 'TypeScript 타입 생성')
  },
}
