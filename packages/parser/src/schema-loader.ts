import type {
  OasDocument,
  OasPathItem,
  OasOperation,
  OasParameter,
  OasRequestBody,
  OasResponse,
} from './oas32-types.js'
import { runPipeline, DEFAULT_PASSES, type SpecPass } from './pipeline.js'
import type { HttpMethod, OperationEntry, RouteIndex } from './types.js'
import { HTTP_METHODS } from './route-match.js'
export { HTTP_METHODS, matchRoute } from './route-match.js'

export function loadSchema(spec: unknown, passes: SpecPass[] = DEFAULT_PASSES): RouteIndex {
  const resolved = runPipeline(spec, passes) as OasDocument
  const globalSecurity = resolved.security ?? []
  const globalServers = resolved.servers ?? []
  const index: RouteIndex = new Map()

  for (const [path, pathItem] of Object.entries(resolved.paths ?? {})) {
    const item = pathItem as OasPathItem
    const methodMap = new Map<HttpMethod, OperationEntry>()

    for (const method of HTTP_METHODS) {
      const op = item[method] as OasOperation | undefined
      if (!op) continue

      const pathParams = (item.parameters ?? []) as OasParameter[]
      const opParams = (op.parameters ?? []) as OasParameter[]
      const merged = mergeParameters(pathParams, opParams)

      const rb = op.requestBody as OasRequestBody | undefined
      const entry: OperationEntry = {
        openApiPath: path,
        method,
        tags: op.tags ?? [],
        deprecated: op.deprecated ?? false,
        parameters: merged,
        responses: (op.responses ?? {}) as Record<string, OasResponse>,
        security: op.security ?? globalSecurity,
        servers: op.servers ?? item.servers ?? globalServers,
        callbacks: (op.callbacks ?? {}) as OperationEntry['callbacks'],
      }
      if (op.operationId !== undefined) entry.operationId = op.operationId
      if (op.summary !== undefined) entry.summary = op.summary
      if (op.description !== undefined) entry.description = op.description
      if (rb !== undefined) entry.requestBody = rb
      if (op.externalDocs !== undefined) entry.externalDocs = op.externalDocs
      methodMap.set(method, entry)
    }

    if (methodMap.size > 0) {
      index.set(path, methodMap)
    }
  }

  return index
}

function mergeParameters(path: OasParameter[], op: OasParameter[]): OasParameter[] {
  const map = new Map<string, OasParameter>()
  for (const p of path) map.set(`${p.in}:${p.name}`, p)
  for (const p of op) map.set(`${p.in}:${p.name}`, p)
  return [...map.values()]
}
