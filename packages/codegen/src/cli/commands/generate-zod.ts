import * as path from 'node:path'
import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { writeOutput } from '../lib/output.js'
import { str, optStr, bool } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { formatLintLocation } from '../lib/diagnostics.js'
import { createCliSourceLocationResolver } from '../lib/source-locations.js'
import { parseLintCategories } from './lint.js'
import { generateZodFromSpec, ZodGenerationPreflightError } from '../../zodgen/index.js'

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
    validate: {
      type: 'boolean',
      description: 'Run preflight schema validation (default: true)',
    },
    'no-validate': {
      type: 'boolean',
      description: 'Skip preflight schema validation',
    },
    lint: {
      type: 'boolean',
      description: 'Run preflight lint validation',
    },
    force: {
      type: 'boolean',
      description: 'Proceed with code generation despite validation errors',
    },
    normalize: {
      type: 'boolean',
      description: 'Normalize OpenAPI specification before generation (default: true)',
    },
    'no-normalize': {
      type: 'boolean',
      description: 'Skip schema normalization before generation',
    },
    categories: {
      type: 'string',
      description: 'Categories to lint (comma-separated: structure, refs, components, etc.)',
    },
  },
  async run(args, context) {
    const specPath = str(args, 'spec')
    const rootDir = (context as any)?.rootDir ?? context?.projectRoot ?? process.cwd()
    const { document: doc, path: resolvedSpecPath, raw } = loadSpecWithPath(specPath, rootDir)

    const rawStyle = optStr(args, 'style')
    const style = (rawStyle === 'schema' ? 'schema' : 'both') as 'schema' | 'both'

    const force = bool(args, 'force')
    const noValidate = bool(args, 'no-validate')
    const noNormalize = bool(args, 'no-normalize')
    const isLint = bool(args, 'lint')
    const validateArg = args['validate']

    const shouldValidate = noValidate && !isLint ? false : (isLint ? true : (validateArg !== false))
    const shouldNormalize = noNormalize ? false : (args['normalize'] !== false)

    const categoriesArg = optStr(args, 'categories')
    const lintCategories = categoriesArg ? parseLintCategories(categoriesArg) : undefined

    const sourceLocations = createCliSourceLocationResolver({ filePath: resolvedSpecPath, raw })

    let code: string
    try {
      code = generateZodFromSpec(doc, {
        style,
        validate: shouldValidate,
        normalize: shouldNormalize,
        force,
        lintCategories,
        basePath: resolvedSpecPath,
        lookupSourceLocation: sourceLocations.lookup,
      })
    } catch (err) {
      if (err instanceof ZodGenerationPreflightError) {
        console.error(`\n❌ Preflight validation failed with ${err.diagnostics.length} diagnostic(s):\n`)
        for (const r of err.diagnostics) {
          const icon = r.severity === 'error' ? '❌' : r.severity === 'warning' ? '⚠️' : 'ℹ️'
          console.error(`  ${icon} [${r.rule}] ${r.message}`)
          console.error(`    at ${formatLintLocation(r, {
            defaultFilePath: resolvedSpecPath,
            lookupSourceLocation: sourceLocations.lookup,
          })}`)
        }
        console.error('')
        throw new CliExitError(1)
      }
      throw err
    }

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
