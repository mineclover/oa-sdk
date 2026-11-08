/** S5 — render. Turns a fully resolved IR into deterministic Python source. */
import {
  assertResolvedPyIr,
  type PyBound,
  type PyConstraints,
  type PyDecl,
  type PyField,
  type PyModuleIR,
  type PyTypeExpr,
} from './ir.js'
import { encodingHelperKeys, encodingHelperSource } from './render-encoding.js'

export type DeclName = { pyName: string; index: number }
export type DeclNames = Map<string, DeclName>
const THIRD_PARTY_MODULES = new Set(['pydantic'])

function escapeString(value: string): string {
  let output = '"'
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (character === '\\') output += '\\\\'
    else if (character === '"') output += '\\"'
    else if (character === '\n') output += '\\n'
    else if (character === '\r') output += '\\r'
    else if (character === '\t') output += '\\t'
    else if (code < 0x20 || code === 0x7f) output += `\\x${code.toString(16).padStart(2, '0')}`
    else output += character
  }
  return `${output}"`
}

export function renderJson(value: unknown): string {
  if (value === null) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'None'
  if (typeof value === 'string') return escapeString(value)
  if (Array.isArray(value)) return `[${value.map(renderJson).join(', ')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${escapeString(key)}: ${renderJson(item)}`)
    return `{${entries.join(', ')}}`
  }
  return 'None'
}

function renderDocstring(value: string): string {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"""', '\\"\\"\\"')
  return `"""${escaped.replaceAll('\n', '\n    ')}"""`
}

function renderBound(value: PyBound): string {
  return typeof value === 'number' ? renderJson(value) : value.integer
}

function renderConstraints(constraints: PyConstraints): string[] {
  const entries: string[] = []
  const keys = ['minLength', 'maxLength', 'ge', 'le', 'gt', 'lt', 'multipleOf'] as const
  for (const key of keys) {
    const value = constraints[key]
    if (value === undefined) continue
    const renderedKey = key === 'minLength' ? 'min_length'
      : key === 'maxLength' ? 'max_length' : key === 'multipleOf' ? 'multiple_of' : key
    const rendered = key === 'ge' || key === 'le' || key === 'gt' || key === 'lt'
      ? renderBound(value) : renderJson(value)
    entries.push(`${renderedKey}=${rendered}`)
  }
  if (constraints.pattern?.python !== undefined && constraints.pattern.python !== null) {
    entries.push(`pattern=${renderJson(constraints.pattern.python)}`)
  }
  return entries
}

export function declarationNames(ir: PyModuleIR): DeclNames {
  return new Map(ir.decls.map((decl, index) => [decl.name, { pyName: decl.pyName!, index }]))
}

function inheritedAttribute(
  name: string,
  wireName: string,
  ir: PyModuleIR,
  visiting = new Set<string>(),
): string | undefined {
  if (visiting.has(name)) return undefined
  visiting.add(name)
  const decl = ir.decls.find(item => item.name === name)
  if (decl?.kind !== 'model') return undefined
  const field = decl.fields.find(item => item.wireName === wireName)
  if (field?.attribute !== null && field?.attribute !== undefined) return field.attribute
  for (const base of decl.bases) {
    const attribute = inheritedAttribute(base, wireName, ir, new Set(visiting))
    if (attribute !== undefined) return attribute
  }
  return undefined
}

function discriminatorAttribute(type: Extract<PyTypeExpr, { kind: 'union' }>, ir: PyModuleIR): string {
  for (const member of type.members) {
    if (member.kind !== 'ref') continue
    const attribute = inheritedAttribute(member.target, type.discriminator!, ir)
    if (attribute !== undefined) return attribute
  }
  return type.discriminator!
}

export function renderType(type: PyTypeExpr, names: DeclNames, ir: PyModuleIR, currentIndex: number, runtimeEvaluated = false): string {
  switch (type.kind) {
    case 'scalar': return type.base === 'string' ? 'str' : type.base === 'integer' ? 'int' : 'float'
    case 'decoded': {
      const semantic = renderType(type.pythonType, names, ir, currentIndex, false)
      const suffix = type.datetimeMode === 'naive' ? '_naive' : ''
      const decode = type.encoding === 'unixtime' ? `_decode_unixtime${suffix}` : `_decode_http_date${suffix}`
      const encode = type.encoding === 'unixtime' ? `_encode_unixtime${suffix}` : `_encode_http_date${suffix}`
      return `Annotated[${semantic}, BeforeValidator(${decode}), PlainSerializer(${encode}, return_type=${type.wireType})]`
    }
    case 'builtin': return type.name
    case 'named': return type.name
    case 'ref': {
      const target = names.get(type.target)
      if (target === undefined) return 'Any'
      return runtimeEvaluated && target.index > currentIndex ? escapeString(target.pyName) : target.pyName
    }
    case 'list': return `list[${renderType(type.item, names, ir, currentIndex, runtimeEvaluated)}]`
    case 'tuple': {
      const items = type.items.map(item => renderType(item, names, ir, currentIndex, runtimeEvaluated))
      if (type.rest !== null) items.push(`*tuple[${renderType(type.rest, names, ir, currentIndex, runtimeEvaluated)}, ...]`)
      return `tuple[${items.join(', ')}]`
    }
    case 'dict': return `dict[str, ${renderType(type.value, names, ir, currentIndex, runtimeEvaluated)}]`
    case 'literal': return `Literal[${type.values.map(renderJson).join(', ')}]`
    case 'union': {
      const exactRuntime = type.exact === true ? false : runtimeEvaluated
      const renderedMembers = type.members.map(member => renderType(member, names, ir, currentIndex, exactRuntime))
      const union = renderedMembers.join(' | ')
      if (type.discriminator === null) {
        if (type.exact === true) {
          return `Annotated[${union}, BeforeValidator(_exact_oneof((${renderedMembers.join(', ')},)))]`
        }
        return union
      }
      const attribute = discriminatorAttribute(type, ir)
      return `Annotated[${union}, Field(discriminator=${renderJson(attribute)})]`
    }
    case 'constrained': {
      const base = renderType(type.base, names, ir, currentIndex, runtimeEvaluated)
      const metadata: string[] = []
      const constraints = renderConstraints(type.constraints)
      if (constraints.length > 0) metadata.push(`Field(${constraints.join(', ')})`)
      if (type.constraints.uniqueItems === true) metadata.push('AfterValidator(_unique_items)')
      return metadata.length === 0 ? base : `Annotated[${base}, ${metadata.join(', ')}]`
    }
  }
}

function fieldMetadata(field: PyField): string[] {
  const values: string[] = []
  if (field.alias !== '') values.push(`alias=${renderJson(field.alias)}`)
  if (field.description !== undefined) values.push(`description=${renderJson(field.description)}`)
  if (field.examples !== undefined) values.push(`examples=${renderJson(field.examples)}`)
  if (field.deprecated !== undefined) values.push(`deprecated=${renderJson(field.deprecated)}`)
  if (field.extensions !== undefined) values.push(`json_schema_extra=${renderJson(field.extensions)}`)
  if (field.type.kind === 'constrained') {
    values.push(...renderConstraints(field.type.constraints).filter(value => !value.startsWith('pattern=')))
    if (field.type.constraints.pattern?.python !== undefined && field.type.constraints.pattern.python !== null) {
      values.push(`pattern=${renderJson(field.type.constraints.pattern.python)}`)
    }
  }
  return values
}

export function renderField(field: PyField, names: DeclNames, ir: PyModuleIR, index: number): string {
  const nullable = field.nullable || field.default?.kind === 'none'
  const constrained = field.type.kind === 'constrained' ? field.type : undefined
  let annotation = renderType(constrained?.base ?? field.type, names, ir, index, false)
  if (constrained?.constraints.uniqueItems === true) {
    annotation = `Annotated[${annotation}, AfterValidator(_unique_items)]`
  }
  const type = nullable ? `${annotation} | None` : annotation
  const metadata = fieldMetadata(field)
  const defaultKind = field.default?.kind
  if (metadata.length > 0) {
    const defaultValue = field.default?.kind === 'required' ? '...'
      : field.default?.kind === 'value' ? renderJson(field.default.json) : 'None'
    return `${field.attribute}: ${type} = Field(${defaultValue}, ${metadata.join(', ')})`
  }
  if (defaultKind === 'none') return `${field.attribute}: ${type} = None`
  if (defaultKind === 'value') return `${field.attribute}: ${type} = ${renderJson(field.default?.json)}`
  return `${field.attribute}: ${type}`
}

export function renderModel(decl: Extract<PyDecl, { kind: 'model' }>, names: DeclNames, ir: PyModuleIR, index: number): string[] {
  const bases = decl.bases.map(base => renderType({ kind: 'ref', target: base }, names, ir, index)).join(', ')
  const lines = [`class ${decl.pyName}(${bases || 'BaseModel'}):`]
  if (decl.description !== undefined) lines.push(`    ${renderDocstring(decl.description)}`)
  const config = [`extra=${renderJson(decl.extra)}`]
  if (decl.frozen === true) config.push('frozen=True')
  if (decl.extensions !== undefined) config.push(`json_schema_extra=${renderJson(decl.extensions)}`)
  if (decl.regexEngine === 'python-re') config.push('regex_engine="python-re"')
  if (decl.fields.some(field => field.alias !== '')) {
    config.push('validate_by_name=True', 'validate_by_alias=True', 'serialize_by_alias=True')
  }
  lines.push(`    model_config = ConfigDict(${config.join(', ')})`)
  for (const field of decl.fields) {
    const line = renderField(field, names, ir, index)
    const narrowedTag = decl.discriminator?.role === 'variant' && decl.envelopeVariant !== true && field.wireName === decl.discriminator.propertyName
    lines.push(`    ${line}${narrowedTag ? '  # pyright: ignore[reportIncompatibleVariableOverride]' : ''}`)
  }
  if (decl.openness.kind === 'typed-map') {
    const value = renderType(decl.openness.value, names, ir, index, false)
    lines.push(`    __pydantic_extra__: dict[str, ${value}] = Field(init=False)  # pyright: ignore[reportIncompatibleVariableOverride]`)
  }
  const rejecting = decl.fields.filter(field => field.rejectExplicitNull)
  if (rejecting.length > 0) {
    const fields = rejecting.map(field => renderJson(field.attribute)).join(', ')
    lines.push('', `    @field_validator(${fields}, mode="before")`)
    lines.push('    @classmethod', '    def _reject_explicit_null(cls, value: object) -> object:')
    lines.push(
      '        if value is None:',
      '            raise ValueError("explicit null is not allowed")',
      '        return value',
    )
  }
  return lines
}

function usesUniqueItems(ir: PyModuleIR): boolean {
  return ir.decls.some(decl => {
    if (decl.kind === 'model' && decl.operationOwner !== undefined) return false
    const types = decl.kind === 'model'
      ? [...decl.fields.map(field => field.type), ...(decl.openness.kind === 'typed-map' ? [decl.openness.value] : [])]
      : decl.kind === 'alias' ? [decl.type] : []
    return types.some(type => JSON.stringify(type).includes('"uniqueItems":true'))
  })
}

function typeHasExact(type: PyTypeExpr): boolean {
  if (type.kind === 'union') return type.exact === true || type.members.some(typeHasExact)
  if (type.kind === 'decoded') return typeHasExact(type.pythonType)
  if (type.kind === 'list') return typeHasExact(type.item)
  if (type.kind === 'tuple') return type.items.some(typeHasExact) || (type.rest !== null && typeHasExact(type.rest))
  if (type.kind === 'dict') return typeHasExact(type.value)
  if (type.kind === 'constrained') return typeHasExact(type.base)
  return false
}

export function appendExactOneOfHelper(lines: string[]): void {
  lines.push('def _exact_oneof(branches: tuple[Any, ...]):', '    adapters = tuple(TypeAdapter(branch) for branch in branches)', '    def validate(value: object) -> object:', '        matches = 0', '        for adapter in adapters:', '            try:', '                adapter.validate_python(value)', '                matches += 1', '            except (ValidationError, ValueError, TypeError):', '                pass', '        if matches != 1:', '            raise ValueError("oneOf requires exactly one matching branch")', '        return value', '    return validate', '', '')
}

export function renderPyModule(ir: PyModuleIR): string {
  assertResolvedPyIr(ir)
  const names = declarationNames(ir)
  const lines: string[] = ['# ruff: noqa: E501']
  const hasExact = ir.decls.some(decl => decl.kind === 'model' && decl.operationOwner === undefined
    ? decl.fields.some(field => typeHasExact(field.type))
    : decl.kind === 'alias' && typeHasExact(decl.type))
  const imports: Record<string, string[]> = Object.fromEntries(Object.entries(ir.imports!.from).map(([module, values]) => [module, [...values]]))
  if (hasExact) {
    imports.typing = [...new Set([...(imports.typing ?? []), 'Any'])].sort()
    imports.typing = [...new Set([...(imports.typing ?? []), 'Annotated'])].sort()
    imports.pydantic = [...new Set([...(imports.pydantic ?? []), 'BeforeValidator', 'TypeAdapter', 'ValidationError'])].sort()
  }
  const group = (module: string): number => module === '__future__' ? 0
    : (THIRD_PARTY_MODULES.has(module) ? 2 : 1)
  const importModules = Object.keys(imports).sort((left, right) => {
    const byGroup = group(left) - group(right)
    return byGroup !== 0 ? byGroup : left < right ? -1 : left > right ? 1 : 0
  })
  let previousGroup = -1
  for (const module of importModules) {
    const currentGroup = group(module)
    if (previousGroup !== -1 && currentGroup !== previousGroup) lines.push('')
    const imported = imports[module] ?? []
    const prefix = module === '__future__' ? 'from __future__ import ' : `from ${module} import `
    const statement = `${prefix}${imported.join(', ')}`
    if (statement.length <= 88) lines.push(statement)
    else {
      lines.push(`${prefix}(`)
      for (const name of imported) lines.push(`    ${name},`)
      lines.push(')')
    }
    previousGroup = currentGroup
  }
  const encodingKeys = encodingHelperKeys(ir)
  const hasHelpers = usesUniqueItems(ir) || encodingKeys.size > 0 || hasExact
  lines.push('')
  if (hasHelpers || ir.decls[0]?.kind !== 'alias') lines.push('')
  if (usesUniqueItems(ir)) {
    lines.push('def _unique_items(value: list[object]) -> list[object]:')
    lines.push('    if len(value) != len({repr(item) for item in value}):')
    lines.push('        raise ValueError("list items must be unique")', '    return value', '', '')
  }
  if (hasExact) {
    appendExactOneOfHelper(lines)
  }
  if (encodingKeys.size > 0) lines.push(...encodingHelperSource(encodingKeys))
  const renderedDecls = ir.decls.filter(decl => decl.kind !== 'operation'
    && !(decl.kind === 'model' && decl.operationOwner !== undefined))
  renderedDecls.forEach((decl, index) => {
    if (index > 0) lines.push('', '')
      if (decl.kind === 'enum') {
      if (decl.repr === 'str-enum') {
        lines.push(`class ${decl.pyName}(StrEnum):`)
        for (const member of decl.members ?? []) lines.push(`    ${member.name} = ${renderJson(member.value)}`)
      } else {
        lines.push(`${decl.pyName}: TypeAlias = Literal[${decl.values.map(renderJson).join(', ')}]`)
      }
    } else if (decl.kind === 'alias') {
      lines.push(`${decl.pyName}: TypeAlias = ${renderType(decl.type, names, ir, index, true)}`)
      } else if (decl.kind === 'model') {
      if (decl.operationOwner === undefined) lines.push(...renderModel(decl, names, ir, index))
    }
  })
  if (ir.rebuild.length > 0) {
    lines.push('', '')
    for (const name of ir.rebuild) lines.push(`${names.get(name)?.pyName ?? name}.model_rebuild()`)
  }
  const source = lines.join('\n').trimEnd()
  return `${source}\n`
}
