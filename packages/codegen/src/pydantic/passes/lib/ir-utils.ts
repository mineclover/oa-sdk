import type { PyConstraints, PyDecl, PyModuleIR, PyTypeExpr } from '../../ir.js'

export function cloneIr(ir: PyModuleIR): PyModuleIR {
  return structuredClone(ir)
}

export function mapType(type: PyTypeExpr, map: (value: PyTypeExpr) => PyTypeExpr): PyTypeExpr {
  let mapped: PyTypeExpr
  switch (type.kind) {
    case 'decoded':
      mapped = { ...type, pythonType: mapType(type.pythonType, map) }
      break
    case 'list':
      mapped = { ...type, item: mapType(type.item, map) }
      break
    case 'tuple':
      mapped = {
        ...type,
        items: type.items.map(item => mapType(item, map)),
        rest: type.rest === null ? null : mapType(type.rest, map),
      }
      break
    case 'dict':
      mapped = { ...type, value: mapType(type.value, map) }
      break
    case 'union':
      mapped = { ...type, members: type.members.map(member => mapType(member, map)) }
      break
    case 'constrained':
      mapped = { ...type, base: mapType(type.base, map), constraints: { ...type.constraints } }
      break
    default:
      mapped = { ...type }
      break
  }
  return map(mapped)
}

export function mapDeclTypes(decl: PyDecl, map: (type: PyTypeExpr) => PyTypeExpr): PyDecl {
  if (decl.kind === 'model') {
    return {
      ...decl,
      openness: decl.openness.kind === 'typed-map'
        ? { kind: 'typed-map', value: mapType(decl.openness.value, map) }
        : { ...decl.openness },
      fields: decl.fields.map(field => ({ ...field, type: mapType(field.type, map) })),
    }
  }
  if (decl.kind === 'alias') return { ...decl, type: mapType(decl.type, map) }
  if (decl.kind === 'operation') return {
    ...decl,
    parameters: decl.parameters.map(parameter => ({ ...parameter, schema: mapType(parameter.schema, map) })),
    requestBody: decl.requestBody === null ? null : { ...decl.requestBody, schema: decl.requestBody.schema === null ? null : mapType(decl.requestBody.schema, map), mediaTypes: decl.requestBody.mediaTypes.map(media => ({ ...media, schema: media.schema === null ? null : mapType(media.schema, map), itemType: media.itemType === null ? null : mapType(media.itemType, map) })) },
    responses: decl.responses.map(response => ({
      ...response,
      schema: response.schema === null ? null : mapType(response.schema, map),
      mediaTypes: response.mediaTypes.map(media => ({ ...media, schema: media.schema === null ? null : mapType(media.schema, map), itemType: media.itemType === null ? null : mapType(media.itemType, map) })),
      headers: response.headers.map(header => ({ ...header, schema: mapType(header.schema, map) })),
    })),
  }
  return { ...decl }
}

export function visitType(type: PyTypeExpr, visit: (type: PyTypeExpr) => void): void {
  visit(type)
  switch (type.kind) {
    case 'decoded': visitType(type.pythonType, visit); break
    case 'list': visitType(type.item, visit); break
    case 'tuple':
      type.items.forEach(item => visitType(item, visit))
      if (type.rest !== null) visitType(type.rest, visit)
      break
    case 'dict': visitType(type.value, visit); break
    case 'union': type.members.forEach(member => visitType(member, visit)); break
    case 'constrained': visitType(type.base, visit); break
    default: break
  }
}

export function constraintsWithPattern(constraints: PyConstraints, pattern: string): PyConstraints {
  return { ...constraints, pattern: { source: pattern, python: null } }
}
