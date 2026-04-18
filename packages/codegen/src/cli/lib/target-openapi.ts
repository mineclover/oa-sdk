import { buildSpec } from './build-spec.js'
import { loadSpecWithPath } from './load-spec.js'

export type LoadedOpenApiDocument = {
  document: Record<string, unknown>
  path: string
}

export function loadOpenApiOrTarget(options: {
  specPath: string
  targetPath?: string
  fragmentsDir?: string
}): LoadedOpenApiDocument {
  if (!options.targetPath) {
    const loaded = loadSpecWithPath(options.specPath)
    return { document: loaded.document, path: loaded.path }
  }

  const result = buildSpec({
    targetPath: options.targetPath,
    ...(options.fragmentsDir ? { fragmentsDir: options.fragmentsDir } : {}),
    writeOutput: false,
  })
  if (!result.valid) {
    const errors = result.diagnostics
      .filter(diagnostic => diagnostic.severity === 'error')
      .map(diagnostic => diagnostic.code)
      .join(', ')
    throw new Error(`target OpenAPI build failed: ${errors || 'unknown error'}`)
  }
  return { document: result.document, path: result.summary.targetPath }
}
