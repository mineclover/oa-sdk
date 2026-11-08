/** S5 renderer for operation modules. Layout is the only render-time setting. */
import {
  assertResolvedPyIr,
  type PyDecl,
  type PyModuleIR,
  type PyTypeExpr,
} from './ir.js'
import { appendExactOneOfHelper, renderJson, renderModel, renderType, type DeclNames, declarationNames } from './render.js'

function operationResponses(operation: Extract<PyDecl, { kind: 'operation' }>, success: boolean): string[] {
  return operation.responses.filter(response => success ? /^2\d\d$/.test(response.status) : !/^2\d\d$/.test(response.status))
    .filter(response => response.mediaType !== null)
    .map(response => response.status)
}

function responseType(operation: Extract<PyDecl, { kind: 'operation' }>, status: string): PyTypeExpr {
  return operation.responses.find(response => response.status === status)?.schema ?? { kind: 'builtin', name: 'Any' }
}

function operationRefs(type: PyTypeExpr, refs: Set<string>): void {
  switch (type.kind) {
    case 'ref': refs.add(type.target); return
    case 'decoded': operationRefs(type.pythonType, refs); return
    case 'list': operationRefs(type.item, refs); return
    case 'tuple': type.items.forEach(item => operationRefs(item, refs)); if (type.rest) operationRefs(type.rest, refs); return
    case 'dict': operationRefs(type.value, refs); return
    case 'union': type.members.forEach(member => operationRefs(member, refs)); return
    case 'constrained': operationRefs(type.base, refs); return
    default: return
  }
}

function renderOperationHelpers(types: PyTypeExpr[]): { imports: Map<string, Set<string>>; exact: boolean } {
  const imports = new Map<string, Set<string>>([['__future__', new Set(['annotations'])], ['dataclasses', new Set(['dataclass'])], ['typing', new Set(['TypeAlias'])]])
  const add = (module: string, name: string): void => { const values = imports.get(module) ?? new Set<string>(); values.add(name); imports.set(module, values) }
  let exact = false
  const visit = (type: PyTypeExpr): void => {
    if (type.kind === 'builtin' && type.name === 'Any') add('typing', 'Any')
    if (type.kind === 'literal') add('typing', 'Literal')
    if (type.kind === 'named') add(type.module, type.name)
    if (type.kind === 'decoded') { add('typing', 'Annotated'); add('pydantic', 'BeforeValidator'); add('pydantic', 'PlainSerializer'); visit(type.pythonType) }
    if (type.kind === 'union') {
      type.members.forEach(visit)
      if (type.discriminator !== null || type.exact === true) add('typing', 'Annotated')
      if (type.discriminator !== null) add('pydantic', 'Field')
      if (type.exact === true) exact = true
    }
    if (type.kind === 'constrained') { visit(type.base); add('pydantic', 'Field') }
    if (type.kind === 'list') visit(type.item)
    if (type.kind === 'tuple') { type.items.forEach(visit); if (type.rest) visit(type.rest) }
    if (type.kind === 'dict') visit(type.value)
  }
  types.forEach(visit)
  return { imports, exact }
}

function renderDeclaration(decl: Exclude<PyDecl, { kind: 'operation' }>, names: DeclNames, ir: PyModuleIR, index: number): string[] {
  if (decl.kind === 'enum') {
    if (decl.repr === 'str-enum') return [`class ${decl.pyName}(StrEnum):`, ...(decl.members ?? []).map(member => `    ${member.name} = ${renderJson(member.value)}`)]
    return [`${decl.pyName}: TypeAlias = Literal[${decl.values.map(renderJson).join(', ')}]`]
  }
  if (decl.kind === 'alias') return [`${decl.pyName}: TypeAlias = ${renderType(decl.type, names, ir, index, true)}`]
  return renderModel(decl, names, ir, index)
}

/** Render operations and operation-owned models. `split` only controls module imports/declarations. */
export function renderPyOperationsModule(ir: PyModuleIR, split = true): string {
  assertResolvedPyIr(ir)
  const names = declarationNames(ir)
  const operations = ir.decls.filter((decl): decl is Extract<PyDecl, { kind: 'operation' }> => decl.kind === 'operation')
  const owned = ir.decls.filter((decl): decl is Extract<PyDecl, { kind: 'model' }> => decl.kind === 'model' && decl.operationOwner !== undefined)
  const types: PyTypeExpr[] = []
  owned.forEach(decl => decl.fields.forEach(field => types.push(field.type)))
  if (!split) {
    ir.decls.forEach(decl => {
      if (decl.kind === 'alias') types.push(decl.type)
      if (decl.kind === 'model') {
        decl.fields.forEach(field => types.push(field.type))
        if (decl.openness.kind === 'typed-map') types.push(decl.openness.value)
      }
    })
  }
  for (const operation of operations) {
    operation.parameters.forEach(parameter => types.push(parameter.schema))
    if (operation.requestBody?.schema) types.push(operation.requestBody.schema)
    else if (operation.requestBody?.mediaType !== null && operation.requestBody !== null) types.push({ kind: 'builtin', name: 'Any' })
    operation.responses.forEach(response => {
      if (response.schema) types.push(response.schema)
      else if (response.mediaType !== null) types.push({ kind: 'builtin', name: 'Any' })
      response.headers.forEach(header => types.push(header.schema))
      response.mediaTypes.forEach(media => {
        if (media.schema) types.push(media.schema)
        if (media.itemType) types.push(media.itemType)
      })
    })
    operation.requestBody?.mediaTypes.forEach(media => {
      if (media.schema) types.push(media.schema)
      if (media.itemType) types.push(media.itemType)
    })
  }
  const helper = renderOperationHelpers(types)
  if (owned.some(decl => decl.fields.some(field => field.rejectExplicitNull))) {
    const pydantic = helper.imports.get('pydantic') ?? new Set<string>()
    pydantic.add('field_validator')
    helper.imports.set('pydantic', pydantic)
  }
  const refs = new Set<string>()
  types.forEach(type => operationRefs(type, refs))
  const componentNames = new Set(ir.decls.filter(decl => decl.kind === 'model' ? decl.operationOwner === undefined : decl.kind !== 'operation').map(decl => decl.name))
  const imported = [...refs].filter(name => componentNames.has(name)).map(name => names.get(name)?.pyName).filter((name): name is string => name !== undefined).sort()
  if (split && imported.length > 0) helper.imports.set('.models', new Set(imported))
  if (!split) {
    for (const [module, values] of Object.entries(ir.imports?.from ?? {})) {
      if (module === '__future__') continue
      const current = helper.imports.get(module) ?? new Set<string>()
      values.forEach(value => current.add(value))
      helper.imports.set(module, current)
    }
  }
  helper.imports.set('pydantic', new Set([...(helper.imports.get('pydantic') ?? []), 'BaseModel', 'ConfigDict', 'Field']))
  if (helper.exact) {
    helper.imports.set('typing', new Set([...(helper.imports.get('typing') ?? []), 'Annotated', 'Any']))
    helper.imports.set('pydantic', new Set([...(helper.imports.get('pydantic') ?? []), 'TypeAdapter', 'ValidationError']))
  }
  const lines = ['# ruff: noqa: E501']
  const group = (module: string): number => module === '__future__' ? 0 : module === 'pydantic' ? 2 : module.startsWith('.') ? 3 : 1
  const modules = [...helper.imports.keys()].sort((left, right) => group(left) - group(right) || left.localeCompare(right))
  let previous = -1
  for (const module of modules) {
    const current = group(module)
    if (previous !== -1 && current !== previous) lines.push('')
    const values = [...(helper.imports.get(module) ?? [])].sort()
    const prefix = module === '__future__' ? 'from __future__ import ' : `from ${module} import `
    lines.push(`${prefix}${values.join(', ')}`)
    previous = current
  }
  lines.push('')
  if (helper.exact) appendExactOneOfHelper(lines)
  const ownedIndices = new Map(owned.map(decl => [decl.name, ir.decls.indexOf(decl)]))
  if (!split) {
    for (const decl of ir.decls.filter((item): item is Exclude<PyDecl, { kind: 'operation' }> => item.kind === 'model' ? item.operationOwner === undefined : item.kind !== 'operation')) {
      lines.push('', ...renderDeclaration(decl, names, ir, ir.decls.indexOf(decl)))
    }
  }
  for (const decl of owned) lines.push('', ...renderModel(decl, names, ir, ownedIndices.get(decl.name) ?? 0))
  const ownedPyNames = new Set(owned.map(decl => decl.pyName))
  const alias = (name: string, type: string): void => { lines.push('', `${name}: TypeAlias = ${type}`) }
  for (const operation of operations) {
    const opIndex = ir.decls.indexOf(operation)
    const modelNames = operation.modelNames
    if (modelNames.body !== null && modelNames.body !== '') {
      const bodyType = operation.requestBody?.schema ? renderType(operation.requestBody.schema, names, ir, opIndex, true) : 'Any'
      if (!ownedPyNames.has(modelNames.body)) alias(modelNames.body, bodyType)
    }
    for (const media of operation.requestBody?.mediaTypes ?? []) {
      if (media.pyName === null || media.pyName === modelNames.body || media.pyName === '') continue
      alias(media.pyName, renderType(media.itemType ?? media.schema ?? { kind: 'builtin', name: 'Any' }, names, ir, opIndex, true))
    }
    const responseTypes = [...new Set(operationResponses(operation, true).map(status => renderType(responseType(operation, status), names, ir, opIndex, true)))]
    if (modelNames.response !== null && modelNames.response !== '' && !ownedPyNames.has(modelNames.response)) alias(modelNames.response, responseTypes.length > 0 ? responseTypes.join(' | ') : 'Any')
    const errorTypes = [...new Set(operationResponses(operation, false).map(status => renderType(responseType(operation, status), names, ir, opIndex, true)))]
    if (modelNames.error !== null && modelNames.error !== '' && !ownedPyNames.has(modelNames.error)) alias(modelNames.error, errorTypes.length > 0 ? errorTypes.join(' | ') : 'Any')
    for (const response of operation.responses) {
      for (const media of response.mediaTypes) {
        if (media.pyName === null || media.pyName === modelNames.response || media.pyName === modelNames.error || media.pyName === '') continue
        alias(media.pyName, renderType(media.itemType ?? media.schema ?? { kind: 'builtin', name: 'Any' }, names, ir, opIndex, true))
      }
    }
  }
  lines.push('', '@dataclass(frozen=True)', 'class OperationSpec:', '    method: str', '    path: str', '    responses: dict[str, object]', '    request_media: dict[str, object]', '    response_media: dict[str, object]', '    streams: dict[str, bool]', '', 'OPERATIONS: dict[str, OperationSpec] = {')
  for (const operation of operations) {
    const statuses = operation.responses.filter(response => response.mediaType !== null).map(response => {
      const primary = response.mediaTypes.find(media => media.mediaType === response.mediaType)
      const type = primary?.stream && primary.pyName !== null
        ? primary.pyName
        : renderType(response.schema ?? { kind: 'builtin', name: 'Any' }, names, ir, ir.decls.indexOf(operation), true)
      return `${renderJson(response.status)}: ${type}`
    }).join(', ')
    const requestMedia = (operation.requestBody?.mediaTypes ?? []).map(media => `${renderJson(media.mediaType)}: ${media.pyName === null ? 'Any' : media.pyName}`).join(', ')
    const responseMedia = operation.responses.flatMap(response => response.mediaTypes.map(media => `${renderJson(`${response.status}:${media.mediaType}`)}: ${media.pyName === null ? 'Any' : media.pyName}`)).join(', ')
    const streams = [
      ...(operation.requestBody?.mediaTypes.filter(media => media.stream).map(media => `${renderJson(`body:${media.mediaType}`)}: True`) ?? []),
      ...operation.responses.flatMap(response => response.mediaTypes.filter(media => media.stream).map(media => `${renderJson(`${response.status}:${media.mediaType}`)}: True`)),
    ].join(', ')
    lines.push(`    ${renderJson(operation.pyName!)}: OperationSpec(method=${renderJson(operation.method.toUpperCase())}, path=${renderJson(operation.path)}, responses={${statuses}}, request_media={${requestMedia}}, response_media={${responseMedia}}, streams={${streams}}),`)
  }
  lines.push('}')
  return `${lines.join('\n').trimEnd()}\n`
}

export function renderPyPackageInit(): string {
  return '"""Generated package marker for Pydantic models and operations."""\n'
}
