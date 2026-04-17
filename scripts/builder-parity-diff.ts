/**
 * builder-parity-diff.ts — compare current .merged.yaml with builder parity output.
 *
 * 실행:
 *   node --import tsx scripts/builder-parity-diff.ts
 *   node --import tsx scripts/builder-parity-diff.ts <base.yaml> <head.yaml>
 *   node --import tsx scripts/builder-parity-diff.ts --base <base.yaml> --head <head.yaml>
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import {
  diffOpenApiDocuments,
  formatOpenApiDiff,
} from '../packages/codegen/src/cli/lib/openapi-normalized-diff.js'

const DEFAULT_BASE = 'packages/schemas/src/.merged.yaml'
const DEFAULT_HEAD = 'packages/schemas/src/.builder/local-parity-api.yaml'

type DiffArgs = {
  basePath: string
  headPath: string
}

function main(): void {
  const args = readArgs(process.argv.slice(2))
  const basePath = resolve(process.cwd(), args.basePath)
  const headPath = resolve(process.cwd(), args.headPath)

  assertFile(basePath, 'base')
  assertFile(headPath, 'head')

  const baseSpec = parseOpenApiFile(basePath)
  const headSpec = parseOpenApiFile(headPath)
  const diff = diffOpenApiDocuments(baseSpec, headSpec)

  console.log(formatOpenApiDiff(diff))
  process.exit(diff.length === 0 ? 0 : 1)
}

function readArgs(args: string[]): DiffArgs {
  if (args.length === 0) {
    return {
      basePath: DEFAULT_BASE,
      headPath: DEFAULT_HEAD,
    }
  }

  if (args.length === 2 && !args[0]?.startsWith('--')) {
    return {
      basePath: args[0],
      headPath: args[1],
    }
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log([
      'Usage: node --import tsx scripts/builder-parity-diff.ts [base.yaml head.yaml]',
      '       node --import tsx scripts/builder-parity-diff.ts --base <base.yaml> --head <head.yaml>',
      '',
      `Default base: ${DEFAULT_BASE}`,
      `Default head: ${DEFAULT_HEAD}`,
    ].join('\n'))
    process.exit(0)
  }

  let basePath: string | undefined
  let headPath: string | undefined
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--base') {
      basePath = args[index + 1]
      index++
      continue
    }
    if (arg === '--head') {
      headPath = args[index + 1]
      index++
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!basePath || !headPath) {
    throw new Error('Both --base and --head are required when using named arguments.')
  }
  return { basePath, headPath }
}

function parseOpenApiFile(filePath: string): Record<string, unknown> {
  const parsed = parse(readFileSync(filePath, 'utf8'))
  if (!isRecord(parsed)) {
    throw new Error(`OpenAPI document must be an object: ${filePath}`)
  }
  return parsed
}

function assertFile(filePath: string, label: string): void {
  if (existsSync(filePath)) return
  throw new Error(`Missing ${label} OpenAPI document: ${filePath}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
