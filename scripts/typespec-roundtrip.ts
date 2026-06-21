/**
 * TypeSpec roundtrip probe for the current OA SDK OpenAPI declaration.
 *
 * The script intentionally reports current semantic differences instead of
 * hiding them. It fails on export/compile/validation errors. Breaking OpenAPI
 * diff is reported and only fails when --fail-on-breaking is passed.
 */

import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { execa } from 'execa'
import { stringify } from 'yaml'
import { loadSpecWithPath } from '../packages/codegen/src/cli/lib/load-spec.js'
import { exportOpenApiToTypeSpec } from '../packages/codegen/src/cli/lib/tsp-export.js'
import {
  diffEndpoints,
  formatMarkdown,
  hasBreakingChanges,
} from '../packages/codegen/src/cli/lib/openapi-breaking-diff.js'
import { validateDocument } from '../packages/parser/src/validate.js'

type Args = {
  spec: string
  namespace: string
  keep: boolean
  failOnBreaking: boolean
}

const root = resolve(process.cwd())

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const specPath = resolve(root, args.spec)
  const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-roundtrip-'))
  const outputDir = join(workspace, 'tsp-output')
  const tspPath = join(workspace, 'main.tsp')
  const tspConfigPath = join(workspace, 'tspconfig.yaml')
  const reportPath = join(workspace, 'tsp-export-report.json')

  try {
    linkWorkspaceNodeModules(workspace)
    const { document } = loadSpecWithPath(specPath)
    const exported = exportOpenApiToTypeSpec(document, { namespace: args.namespace })
    writeFileSync(tspPath, exported.source)
    writeFileSync(reportPath, `${JSON.stringify(exported.report, null, 2)}\n`)
    writeFileSync(tspConfigPath, createTspConfig())

    await execa('pnpm', ['exec', 'tsp', 'compile', workspace, '--output-dir', outputDir], {
      cwd: root,
      stdio: 'inherit',
    })

    const emittedPath = join(outputDir, '@typespec', 'openapi3', 'openapi.yaml')
    if (!existsSync(emittedPath)) {
      throw new Error(`TypeSpec compile did not emit ${emittedPath}`)
    }

    const { document: emittedDocument } = loadSpecWithPath(emittedPath)
    const validation = validateDocument(emittedDocument, {
      basePath: emittedPath,
      requireOpenApi32: true,
    })
    if (!validation.valid) {
      console.error(validation.summary)
      process.exit(1)
    }

    const diff = diffEndpoints(document, emittedDocument)
    const breaking = hasBreakingChanges(diff)
    const originalSchemas = Object.keys(document.components?.schemas ?? {}).length
    const emittedSchemas = Object.keys(emittedDocument.components?.schemas ?? {}).length
    const originalOperations = Object.values(document.paths ?? {}).reduce(
      (count, pathItem) => count + countOperations(pathItem),
      0,
    )
    const emittedOperations = Object.values(emittedDocument.paths ?? {}).reduce(
      (count, pathItem) => count + countOperations(pathItem),
      0,
    )

    console.log('')
    console.log('TypeSpec roundtrip probe')
    console.log(`  spec: ${relative(root, specPath)}`)
    console.log(`  namespace: ${exported.report.namespace}`)
    console.log(`  workspace: ${workspace}`)
    console.log(`  tsp: ${relative(workspace, tspPath)}`)
    console.log(`  emitted: ${relative(workspace, emittedPath)}`)
    console.log(`  export diagnostics: ${exported.report.counts.diagnostics}`)
    console.log(`  operations: ${originalOperations} -> ${emittedOperations}`)
    console.log(`  component schemas: ${originalSchemas} -> ${emittedSchemas}`)
    console.log(`  validation: ${validation.summary}`)
    console.log(`  breaking diff: ${breaking ? 'yes' : 'no'}`)
    console.log('')
    console.log(formatMarkdown(diff))

    if (breaking && args.failOnBreaking) {
      process.exit(1)
    }
  } finally {
    if (!args.keep) rmSync(workspace, { recursive: true, force: true })
  }
}

function linkWorkspaceNodeModules(workspace: string): void {
  const rootNodeModules = join(root, 'node_modules')
  const target = join(workspace, 'node_modules')
  if (!existsSync(rootNodeModules) || existsSync(target)) return
  symlinkSync(rootNodeModules, target, 'dir')
}

function createTspConfig(): string {
  return stringify({
    kind: 'project',
    entrypoint: 'main.tsp',
    emit: ['@typespec/openapi3'],
    options: {
      '@typespec/openapi3': {
        'openapi-versions': ['3.2.0'],
      },
    },
  })
}

function parseArgs(rawArgs: string[]): Args {
  return {
    spec: readOption(rawArgs, '--spec') ?? 'packages/schemas/src/.merged.yaml',
    namespace: readOption(rawArgs, '--namespace') ?? 'OaSdkApi',
    keep: rawArgs.includes('--keep'),
    failOnBreaking: rawArgs.includes('--fail-on-breaking'),
  }
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function countOperations(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const pathItem = value as Record<string, unknown>
  let count = 0
  for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query']) {
    if (pathItem[method]) count += 1
  }
  return count
}

await main()
