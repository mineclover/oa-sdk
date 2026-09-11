import * as path from 'node:path'
import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { writeOutput } from '../lib/output.js'
import { str, optStr } from '../lib/args.js'
import { generateZodFromSpec } from '../../zodgen/index.js'

export const generateZod: Command = {
  name: 'generate:zod',
  description: 'Generate Zod 4 schemas and TypeScript types from OpenAPI 3.2 specification',
  options: {
    spec: {
      type: 'string',
      short: 's',
      required: true,
      description: 'Path to OpenAPI 3.2 spec file',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output directory or file path',
    },
    style: {
      type: 'string',
      description: 'Generation style: "schema" | "both" (default: "both")',
    },
  },
  async run(args, context) {
    const specPath = str(args, 'spec')
    const rootDir = (context as any)?.rootDir ?? context?.projectRoot ?? process.cwd()
    const { document: doc } = loadSpecWithPath(specPath, rootDir)

    const rawStyle = optStr(args, 'style')
    const style = (rawStyle === 'schema' ? 'schema' : 'both') as 'schema' | 'both'

    const code = generateZodFromSpec(doc, { style })

    const outputArg = optStr(args, 'output')
    if (outputArg) {
      const targetPath = outputArg.endsWith('.ts') ? outputArg : path.join(outputArg, 'schemas.ts')
      writeOutput(targetPath, code, 'Zod 4 스키마 생성')
    } else {
      writeOutput(undefined, code)
    }
  },
}

export default generateZod
