import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Command } from '../lib/types.js'
import { bool, optStr, str, choice } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { loadSpecDocumentAsync } from '../lib/load-spec.js'
import {
  buildPydanticModels,
  PydanticGenerationPreflightError,
  PYDANTIC_GENERATED_BANNER,
  type PydanticBuildOptions,
} from '../../pydantic/index.js'
import { parseLintCategories } from './lint.js'

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

export const generatePydantic: Command = {
  name: 'generate:pydantic',
  description: 'Generate Pydantic v2 models from an OpenAPI 3.2 specification',
  options: {
    spec: { type: 'string', short: 's', required: true, description: 'Path to OpenAPI 3.2 spec file' },
    out: { type: 'string', short: 'o', description: 'Output directory or Python file path' },
    preset: { type: 'string', description: 'Preset: default | strict | passthrough' },
    extra: { type: 'string', description: 'Extra policy: ignore | allow | forbid' },
    'optional-style': { type: 'string', description: 'Optional policy: reject-null | plain' },
    naming: { type: 'string', description: 'Naming: snake-alias | preserve' },
    regex: { type: 'string', description: 'Regex mode: ecma | raw | python-re' },
    'enum-style': { type: 'string', description: 'Enum style: str-enum | literal' },
    datetime: { type: 'string', description: 'Date-time mode: aware | naive' },
    uri: { type: 'string', description: 'URI mode: str | normalized URL' },
    'int-bounds': { type: 'string', description: 'Integer bounds: format | none' },
    'encoding-policy': { type: 'string', description: 'Encoded scalars: wire | decode' },
    extensions: { type: 'string', description: 'OpenAPI x-* extensions: preserve | drop' },
    'no-docstrings': { type: 'boolean', description: 'Do not emit model docstrings' },
    frozen: { type: 'boolean', description: 'Make generated models immutable' },
    'emit-ir': { type: 'boolean', description: 'Emit the resolved IR beside the module' },
    layout: { type: 'string', description: 'Output layout: split | single' },
    'no-operations': { type: 'boolean', description: 'Do not include operation declarations' },
    report: { type: 'string', description: 'Write the build report JSON to this file' },
    force: { type: 'boolean', description: 'Proceed despite preflight errors or error diagnostics' },
    'no-validate': { type: 'boolean', description: 'Skip preflight validation' },
    'no-normalize': { type: 'boolean', description: 'Skip OpenAPI normalization' },
    categories: { type: 'string', description: 'Preflight lint categories, comma-separated' },
  },
  async run(args, context) {
    const root = context?.projectRoot ?? process.cwd()
    const spec = str(args, 'spec')
    const loaded = await loadSpecDocumentAsync(spec, root)
    const outArg = optStr(args, 'out')
    const output = outArg === undefined
      ? 'models.py'
      : outArg.endsWith('.py') ? outArg : join(outArg, 'models.py')
    const input: PydanticBuildOptions = {
      output,
      preset: choice(args, 'preset', ['default', 'strict', 'passthrough'] as const, 'default'),
      emitIr: bool(args, 'emit-ir'),
      emitOperations: !bool(args, 'no-operations'),
      docstrings: !bool(args, 'no-docstrings'),
      frozen: bool(args, 'frozen'),
      preflight: {
        force: bool(args, 'force'),
        validate: !bool(args, 'no-validate'),
        normalize: !bool(args, 'no-normalize'),
        basePath: loaded.path,
      },
    }
    const options = [
      ['extra', 'extra'], ['optional-style', 'optionalStyle'], ['naming', 'naming'], ['regex', 'regex'],
      ['enum-style', 'enumStyle'], ['datetime', 'datetime'], ['uri', 'uri'], ['int-bounds', 'intBounds'],
      ['encoding-policy', 'encodingPolicy'], ['extensions', 'extensions'],
    ] as const
    const layout = optStr(args, 'layout')
    if (layout !== undefined) (input as Record<string, unknown>).layout = layout
    for (const [argument, property] of options) {
      const value = optStr(args, argument)
      if (value !== undefined) {
        (input as Record<string, unknown>)[property] = value
      }
    }
    if (args.categories !== undefined) {
      input.preflight = {
        ...input.preflight,
        lintCategories: parseLintCategories(String(args.categories)),
      }
    }
    let result
    try {
      result = buildPydanticModels(loaded.document, input)
    } catch (error) {
      if (error instanceof PydanticGenerationPreflightError) {
        for (const diagnostic of error.diagnostics) {
          console.error(`[${diagnostic.severity}] ${diagnostic.message} (${diagnostic.path})`)
        }
        throw new CliExitError(1)
      }
      throw error
    }
    for (const diagnostic of result.diagnostics) {
      console.error(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message} (${diagnostic.pointer})`)
    }
    const hasErrors = result.diagnostics.some(diagnostic => diagnostic.severity === 'error')
    if (hasErrors && !bool(args, 'force')) throw new CliExitError(1)
    const target = resolve(root, output)
    writeFile(target, `${PYDANTIC_GENERATED_BANNER}\n${result.source}`)
    for (const file of result.files.slice(1)) writeFile(resolve(root, file.path), file.content)
    const report = optStr(args, 'report')
    if (report !== undefined) writeFile(resolve(root, report), `${JSON.stringify(result.report, null, 2)}\n`)
  },
}

export default generatePydantic
