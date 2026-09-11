import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { compile, NodeHost, type Program } from '@typespec/compiler'
import { getOpenAPI3 } from '@typespec/openapi3'

export interface CompileResult {
  program: Program
  entrypoint: string
  tmpDir: string
  cleanup: () => Promise<void>
}

/**
 * Compiles a TypeSpec snippet in-memory from a temporary directory inside the repo
 * ensuring node_modules and TypeSpec libraries (@typespec/http, @typespec/openapi, etc.) resolve.
 */
export async function compileTypeSpecSnippet(
  source: string,
  options: {
    files?: Record<string, string>
    mainFileName?: string
  } = {},
): Promise<CompileResult> {
  const repoRoot = process.cwd()
  const randomSuffix = Math.random().toString(36).substring(2, 10)
  const tmpDir = path.resolve(repoRoot, `.tmp-e2e-tsp-${Date.now()}-${randomSuffix}`)
  await fs.mkdir(tmpDir, { recursive: true })

  // Write additional files if provided
  if (options.files) {
    for (const [relPath, content] of Object.entries(options.files)) {
      const fullPath = path.join(tmpDir, relPath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content, 'utf8')
    }
  }

  const mainFileName = options.mainFileName ?? 'main.tsp'
  const entrypoint = path.join(tmpDir, mainFileName)
  await fs.writeFile(entrypoint, source, 'utf8')

  // Ensure @oa-sdk/typespec-decorators is resolvable via node_modules
  const localNm = path.join(tmpDir, 'node_modules', '@oa-sdk')
  await fs.mkdir(localNm, { recursive: true })
  await fs.symlink(
    path.resolve(repoRoot, 'packages/typespec-decorators'),
    path.join(localNm, 'typespec-decorators'),
    'dir',
  )

  const program = await compile(NodeHost, entrypoint, {
    noEmit: true,
  })

  const cleanup = async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }

  return {
    program,
    entrypoint,
    tmpDir,
    cleanup,
  }
}

/**
 * Compiles TypeSpec source and emits an in-memory OpenAPI 3.2 document.
 */
export async function emitOpenApi3Snippet(
  source: string,
  options: {
    files?: Record<string, string>
    mainFileName?: string
  } = {},
): Promise<{
  document: any
  program: Program
  cleanup: () => Promise<void>
}> {
  const result = await compileTypeSpecSnippet(source, options)
  const records = await getOpenAPI3(result.program, {
    'openapi-versions': ['3.2.0'],
  })

  if (!records || records.length === 0) {
    await result.cleanup()
    throw new Error('No OpenAPI 3.2 services emitted from TypeSpec program')
  }

  const document = records[0].document

  return {
    document,
    program: result.program,
    cleanup: result.cleanup,
  }
}
