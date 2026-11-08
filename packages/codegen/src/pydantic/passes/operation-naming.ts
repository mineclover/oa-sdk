/** S4 operation naming. Runs after the regular naming pass so component names are final. */
import type { PyOperationRole } from '../ir.js'
import type { PyPass } from './index.js'
import { pascalCase, pythonIdentifier } from '../../python-identifier.js'
import { cloneIr } from './lib/ir-utils.js'

function operationStem(operation: { operationId: string | null; method: string; path: string }, naming: 'snake-alias' | 'preserve'): string {
  if (operation.operationId !== null && operation.operationId.length > 0) return naming === 'preserve' ? operation.operationId : pascalCase(operation.operationId)
  return pascalCase(`${operation.method}_${operation.path}`)
}

function statusNumber(status: string): number { return status === 'default' ? 999 : Number(status) }

function roleSuffix(role: PyOperationRole): string {
  if (role.kind === 'body') return 'Body'
  if (role.kind === 'parameter') return `${pascalCase(role.location)}Param${pascalCase(role.name)}`
  if (role.kind === 'responseHeader') return `Response${pascalCase(role.status ?? 'Default')}Header${pascalCase(role.name ?? 'Header')}`
  if (role.kind === 'parameter-group') return `ParameterGroup${pascalCase(role.location)}`
  return /^\d+$/.test(role.status ?? '') ? `Response${role.status}` : `Response${pascalCase(role.status ?? 'default')}`
}

export const operationNamingPass: PyPass<'naming'> = {
  name: 'operationNaming',
  reads: ['naming'],
  run(ir, options, analysis) {
    void analysis
    const result = cloneIr(ir)
    const operations = result.decls.filter(decl => decl.kind === 'operation')
    const usedOperationNames = new Set<string>()
    const usedModelNames = new Set(result.decls.filter(decl => decl.kind !== 'operation' && decl.pyName !== null).map(decl => decl.pyName as string))
    const reservedModelNames = new Set<string>()
    const allocate = (candidate: string, pointer: string): string => {
      let value = candidate
      let suffix = 2
      while (usedModelNames.has(value)) value = `${candidate}${suffix++}`
      if (value !== candidate) result.diagnostics.push({ code: 'pydantic/operation-name-collision', severity: 'warning', pointer, message: `Operation model name '${candidate}' was renamed to '${value}' after a collision` })
      usedModelNames.add(value)
      reservedModelNames.add(value)
      return value
    }
    const claimInline = (candidate: string, pointer: string): string => {
      if (reservedModelNames.delete(candidate)) return candidate
      return allocate(candidate, pointer)
    }
    for (const operation of operations) {
      const candidate = pythonIdentifier(operationStem(operation, options.naming)) || 'Operation'
      let stem = candidate
      let suffix = 2
      if (operation.operationId === null) result.diagnostics.push({ code: 'pydantic/operation-id-missing', severity: 'warning', pointer: operation.pointer, message: `Operation ${operation.method.toUpperCase()} ${operation.path} has no operationId; generated name '${candidate}'` })
      while (usedOperationNames.has(stem)) stem = `${candidate}${suffix++}`
      if (stem !== candidate) result.diagnostics.push({ code: 'pydantic/operation-name-collision', severity: 'warning', pointer: operation.pointer, message: `Operation name '${candidate}' was renamed to '${stem}' after a collision` })
      usedOperationNames.add(stem)
      operation.pyName = stem
      const has = (location: string): boolean => operation.parameters.some(parameter => parameter.location === location)
      operation.modelNames.pathParams = has('path') ? allocate(`${stem}PathParams`, operation.pointer) : ''
      operation.modelNames.queryParams = has('query') ? allocate(`${stem}QueryParams`, operation.pointer) : ''
      operation.modelNames.headerParams = has('header') ? allocate(`${stem}HeaderParams`, operation.pointer) : ''
      operation.modelNames.cookieParams = has('cookie') ? allocate(`${stem}CookieParams`, operation.pointer) : ''
      operation.modelNames.body = operation.requestBody === null || operation.requestBody.mediaType === null ? '' : allocate(`${stem}Body`, operation.pointer)
      const selected = operation.responses.filter(response => /^2\d\d$/.test(response.status) || response.status === 'default').sort((left, right) => statusNumber(left.status) - statusNumber(right.status)).find(response => response.mediaType !== null)
      const hasError = operation.responses.some(response => !/^2\d\d$/.test(response.status) && response.mediaType !== null)
      operation.modelNames.response = selected === undefined ? '' : allocate(`${stem}Response`, operation.pointer)
      operation.modelNames.error = hasError ? allocate(`${stem}Error`, operation.pointer) : ''
    }
    const byOwner = new Map(operations.map(operation => [operation.name, operation]))
    const operationModels = result.decls.filter((decl): decl is Extract<typeof decl, { kind: 'model' }> => decl.kind === 'model' && decl.operationOwner !== undefined).sort((left, right) => (left.operationRole?.path?.split('/').length ?? 0) - (right.operationRole?.path?.split('/').length ?? 0) || left.name.localeCompare(right.name))
    for (const decl of operationModels) {
      const role = decl.operationRole
      const operation = byOwner.get(decl.operationOwner!)
      if (role === undefined || operation === undefined || operation.pyName === null) continue
      const selectedStatus = operation.responses.filter(response => /^2\d\d$/.test(response.status)).sort((left, right) => statusNumber(left.status) - statusNumber(right.status)).find(response => response.mediaType !== null)?.status
      let className = `${operation.pyName}${roleSuffix(role)}`
      if (role.kind === 'parameter-group') {
        className = role.location === 'path' ? operation.modelNames.pathParams!
          : role.location === 'query' ? operation.modelNames.queryParams!
            : role.location === 'header' ? operation.modelNames.headerParams!
              : operation.modelNames.cookieParams!
      }
      const isSelectedResponse = role.kind === 'response' && role.status === selectedStatus
      if (isSelectedResponse && operation.modelNames.response !== '') className = operation.modelNames.response!
      if (!isSelectedResponse && role.kind === 'response' && (role.status === 'default' || /^[45]\d\d$/.test(role.status ?? ''))) className = `${operation.pyName}Error${role.status === 'default' ? 'Default' : role.status}`
      if (role.path !== undefined) {
        const parent = operationModels.find(item => item.operationOwner === decl.operationOwner && item.operationRole?.path === role.path?.split('/').slice(0, -1).join('/'))
        className = `${parent?.pyName ?? `${operation.pyName}${roleSuffix(role)}`}${pascalCase(role.path.split('/').pop() ?? 'Property')}`
      }
      decl.pyName = claimInline(className, decl.pointer)
    }
    return result
  },
}
