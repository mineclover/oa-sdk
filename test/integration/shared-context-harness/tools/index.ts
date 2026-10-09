import type { SharedContextHarnessPort } from '../contracts/ports.js'
import { createBootstrapTool } from './collab-bootstrap.js'
import { createResolveReferenceTool } from './collab-resolve-reference.js'
import { createQueryManagementTool } from './collab-query-management.js'

export * from './collab-bootstrap.js'
export * from './collab-resolve-reference.js'
export * from './collab-query-management.js'

export function createCollaborationTools(port: SharedContextHarnessPort) {
  return [
    createBootstrapTool(port),
    createResolveReferenceTool(port),
    createQueryManagementTool(port),
  ]
}
