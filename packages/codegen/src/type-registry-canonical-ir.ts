import { createHash } from 'node:crypto'
import * as ts from 'typescript'

export const TYPE_REGISTRY_CANONICAL_IR_VERSION = 'oa-sdk.type-registry-ir.v1' as const

export type CanonicalIrValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalIrValue[]
  | { readonly [key: string]: CanonicalIrValue }

export type SupportedTypeDeclaration =
  | ts.TypeAliasDeclaration
  | ts.InterfaceDeclaration
  | ts.EnumDeclaration
  | ts.ClassDeclaration
  | ts.FunctionDeclaration
  | ts.ModuleDeclaration

export type CanonicalDeclarationHashes = {
  normalizedSyntax: string
  syntaxHash: string
  shapeIr: CanonicalIrValue
  shapeHash: string
  semanticIr: CanonicalIrValue
  semanticHash: string
  canonicalIr: string
}

export type CanonicalDeclarationOptions = {
  sourceFile: ts.SourceFile
  declaration: SupportedTypeDeclaration
  symbolName: string
  resolveReference?: (referenceName: string) => string | undefined
}

type CanonicalContext = {
  typeParameters: ReadonlyMap<string, string>
  selfName: string
  resolveReference?: (referenceName: string) => string | undefined
}

/**
 * Produces a token stream rather than printer output so comments, indentation,
 * and line endings do not influence the syntax hash.
 */
export function normalizeTypeScriptSyntax(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source)
  const tokens: string[] = []

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    tokens.push(`${token}:${JSON.stringify(scanner.getTokenText())}`)
  }

  return tokens.join('|')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function stableCanonicalStringify(value: CanonicalIrValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableCanonicalStringify).join(',')}]`

  const record = value as Readonly<Record<string, CanonicalIrValue>>
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableCanonicalStringify(record[key] ?? null)}`)
    .join(',')}}`
}

export function hashCanonicalIr(value: CanonicalIrValue): string {
  return sha256(stableCanonicalStringify(value))
}

export function canonicalizeTypeDeclaration(options: CanonicalDeclarationOptions): CanonicalDeclarationHashes {
  const { declaration, sourceFile, symbolName } = options
  const typeParameters = declarationTypeParameters(declaration)
  const baseContext: CanonicalContext = {
    typeParameters: typeParameterMap(typeParameters),
    selfName: symbolName,
    ...(options.resolveReference === undefined ? {} : { resolveReference: options.resolveReference }),
  }
  const shapeContext: CanonicalContext = {
    typeParameters: baseContext.typeParameters,
    selfName: symbolName,
  }
  const kind = declarationKind(declaration)
  const shapeBody = canonicalDeclarationBody(declaration, shapeContext)
  const semanticBody = canonicalDeclarationBody(declaration, baseContext)
  const shapeIr: CanonicalIrValue = {
    version: TYPE_REGISTRY_CANONICAL_IR_VERSION,
    kind,
    typeParameters: canonicalTypeParameters(typeParameters, shapeContext),
    body: shapeBody,
  }
  const semanticIr: CanonicalIrValue = {
    version: TYPE_REGISTRY_CANONICAL_IR_VERSION,
    kind,
    name: symbolName,
    typeParameters: canonicalTypeParameters(typeParameters, baseContext),
    body: semanticBody,
  }
  const normalizedSyntax = normalizeTypeScriptSyntax(declaration.getText(sourceFile))

  return {
    normalizedSyntax,
    syntaxHash: sha256(normalizedSyntax),
    shapeIr,
    shapeHash: hashCanonicalIr(shapeIr),
    semanticIr,
    semanticHash: hashCanonicalIr(semanticIr),
    canonicalIr: stableCanonicalStringify(semanticIr),
  }
}

function declarationKind(declaration: SupportedTypeDeclaration): string {
  if (ts.isTypeAliasDeclaration(declaration)) return 'type-alias'
  if (ts.isInterfaceDeclaration(declaration)) return 'interface'
  if (ts.isEnumDeclaration(declaration)) return 'enum'
  if (ts.isClassDeclaration(declaration)) return 'class'
  if (ts.isFunctionDeclaration(declaration)) return 'function'
  return 'namespace'
}

function declarationTypeParameters(declaration: SupportedTypeDeclaration): readonly ts.TypeParameterDeclaration[] {
  if (ts.isEnumDeclaration(declaration) || ts.isModuleDeclaration(declaration)) return []
  return declaration.typeParameters ?? []
}

function typeParameterMap(
  parameters: readonly ts.TypeParameterDeclaration[],
  inherited: ReadonlyMap<string, string> = new Map(),
): ReadonlyMap<string, string> {
  const result = new Map(inherited)
  const offset = inherited.size
  parameters.forEach((parameter, index) => result.set(parameter.name.text, `$T${offset + index}`))
  return result
}

function canonicalTypeParameters(
  parameters: readonly ts.TypeParameterDeclaration[],
  context: CanonicalContext,
): CanonicalIrValue[] {
  return parameters.map((parameter, index) => ({
    name: context.typeParameters.get(parameter.name.text) ?? `$T${index}`,
    variance: modifierNames(parameter.modifiers),
    constraint: parameter.constraint === undefined ? null : canonicalTypeNode(parameter.constraint, context),
    default: parameter.default === undefined ? null : canonicalTypeNode(parameter.default, context),
  }))
}

function canonicalDeclarationBody(
  declaration: SupportedTypeDeclaration,
  context: CanonicalContext,
): CanonicalIrValue {
  if (ts.isTypeAliasDeclaration(declaration)) {
    return canonicalTypeNode(declaration.type, context)
  }
  if (ts.isInterfaceDeclaration(declaration)) {
    return {
      heritage: sortedCanonicalValues((declaration.heritageClauses ?? []).flatMap(clause =>
        clause.types.map(type => ({
          token: clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements',
          type: canonicalExpressionWithTypeArguments(type, context),
        })))),
      members: canonicalMembers(declaration.members, context),
    }
  }
  if (ts.isEnumDeclaration(declaration)) {
    return {
      const: hasModifier(declaration.modifiers, ts.SyntaxKind.ConstKeyword),
      members: declaration.members.map(member => ({
        name: canonicalPropertyName(member.name),
        value: member.initializer === undefined ? null : normalizeTypeScriptSyntax(member.initializer.getText()),
      })),
    }
  }
  if (ts.isClassDeclaration(declaration)) {
    return {
      abstract: hasModifier(declaration.modifiers, ts.SyntaxKind.AbstractKeyword),
      heritage: sortedCanonicalValues((declaration.heritageClauses ?? []).flatMap(clause =>
        clause.types.map(type => ({
          token: clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements',
          type: canonicalExpressionWithTypeArguments(type, context),
        })))),
      members: canonicalMembers(declaration.members, context),
    }
  }
  if (ts.isFunctionDeclaration(declaration)) {
    return canonicalSignature(declaration, context)
  }

  return canonicalNamespaceBody(declaration, context)
}

function canonicalNamespaceBody(declaration: ts.ModuleDeclaration, context: CanonicalContext): CanonicalIrValue {
  if (declaration.body === undefined) return { members: [] }
  if (!ts.isModuleBlock(declaration.body)) {
    if (ts.isModuleDeclaration(declaration.body)) return canonicalNamespaceBody(declaration.body, context)
    return { members: [] }
  }

  return {
    members: sortedCanonicalValues(declaration.body.statements.flatMap(statement => {
      if (isSupportedTypeDeclaration(statement)) {
        return [{
          kind: declarationKind(statement),
          name: declarationName(statement),
          exported: hasModifier(statement.modifiers, ts.SyntaxKind.ExportKeyword),
        }]
      }
      return []
    })),
  }
}

function canonicalTypeNode(node: ts.TypeNode, context: CanonicalContext): CanonicalIrValue {
  switch (node.kind) {
    case ts.SyntaxKind.AnyKeyword: return { kind: 'keyword', name: 'any' }
    case ts.SyntaxKind.UnknownKeyword: return { kind: 'keyword', name: 'unknown' }
    case ts.SyntaxKind.NeverKeyword: return { kind: 'keyword', name: 'never' }
    case ts.SyntaxKind.VoidKeyword: return { kind: 'keyword', name: 'void' }
    case ts.SyntaxKind.UndefinedKeyword: return { kind: 'keyword', name: 'undefined' }
    case ts.SyntaxKind.StringKeyword: return { kind: 'keyword', name: 'string' }
    case ts.SyntaxKind.NumberKeyword: return { kind: 'keyword', name: 'number' }
    case ts.SyntaxKind.BooleanKeyword: return { kind: 'keyword', name: 'boolean' }
    case ts.SyntaxKind.BigIntKeyword: return { kind: 'keyword', name: 'bigint' }
    case ts.SyntaxKind.SymbolKeyword: return { kind: 'keyword', name: 'symbol' }
    case ts.SyntaxKind.ObjectKeyword: return { kind: 'keyword', name: 'object' }
    case ts.SyntaxKind.ThisType: return { kind: 'this' }
  }

  if (ts.isTypeReferenceNode(node)) {
    const displayName = node.typeName.getText()
    const typeParameter = context.typeParameters.get(displayName)
    if (typeParameter !== undefined) {
      return {
        kind: 'type-parameter',
        name: typeParameter,
        arguments: (node.typeArguments ?? []).map(argument => canonicalTypeNode(argument, context)),
      }
    }
    const target = displayName === context.selfName
      ? '$self'
      : context.resolveReference?.(displayName) ?? displayName
    return {
      kind: 'reference',
      target,
      arguments: (node.typeArguments ?? []).map(argument => canonicalTypeNode(argument, context)),
    }
  }
  if (ts.isArrayTypeNode(node)) return { kind: 'array', element: canonicalTypeNode(node.elementType, context) }
  if (ts.isTupleTypeNode(node)) {
    return {
      kind: 'tuple',
      elements: node.elements.map(element => canonicalTupleElement(element, context)),
    }
  }
  if (ts.isUnionTypeNode(node)) {
    return { kind: 'union', types: sortedCanonicalValues(node.types.map(type => canonicalTypeNode(type, context))) }
  }
  if (ts.isIntersectionTypeNode(node)) {
    return { kind: 'intersection', types: sortedCanonicalValues(node.types.map(type => canonicalTypeNode(type, context))) }
  }
  if (ts.isParenthesizedTypeNode(node)) return canonicalTypeNode(node.type, context)
  if (ts.isTypeLiteralNode(node)) return { kind: 'object', members: canonicalMembers(node.members, context) }
  if (ts.isFunctionTypeNode(node)) return { kind: 'function', signature: canonicalSignature(node, context) }
  if (ts.isConstructorTypeNode(node)) return { kind: 'constructor', signature: canonicalSignature(node, context) }
  if (ts.isLiteralTypeNode(node)) return canonicalLiteralType(node.literal)
  if (ts.isTypeOperatorNode(node)) {
    return { kind: 'operator', operator: ts.tokenToString(node.operator) ?? String(node.operator), type: canonicalTypeNode(node.type, context) }
  }
  if (ts.isIndexedAccessTypeNode(node)) {
    return { kind: 'indexed-access', object: canonicalTypeNode(node.objectType, context), index: canonicalTypeNode(node.indexType, context) }
  }
  if (ts.isTypeQueryNode(node)) return { kind: 'type-query', expression: node.exprName.getText() }
  if (ts.isTypePredicateNode(node)) {
    return {
      kind: 'predicate',
      asserts: node.assertsModifier !== undefined,
      parameter: node.parameterName.getText(),
      type: node.type === undefined ? null : canonicalTypeNode(node.type, context),
    }
  }
  if (ts.isOptionalTypeNode(node)) return { kind: 'optional', type: canonicalTypeNode(node.type, context) }
  if (ts.isRestTypeNode(node)) return { kind: 'rest', type: canonicalTypeNode(node.type, context) }
  if (ts.isConditionalTypeNode(node)) {
    return {
      kind: 'conditional',
      check: canonicalTypeNode(node.checkType, context),
      extends: canonicalTypeNode(node.extendsType, context),
      true: canonicalTypeNode(node.trueType, context),
      false: canonicalTypeNode(node.falseType, context),
    }
  }
  if (ts.isInferTypeNode(node)) {
    const nestedContext = withTypeParameters(context, [node.typeParameter])
    return { kind: 'infer', parameter: canonicalTypeParameters([node.typeParameter], nestedContext)[0] ?? null }
  }
  if (ts.isMappedTypeNode(node)) {
    const nestedContext = withTypeParameters(context, [node.typeParameter])
    return {
      kind: 'mapped',
      readonly: tokenState(node.readonlyToken),
      optional: tokenState(node.questionToken),
      parameter: canonicalTypeParameters([node.typeParameter], nestedContext)[0] ?? null,
      nameType: node.nameType === undefined ? null : canonicalTypeNode(node.nameType, nestedContext),
      value: node.type === undefined ? null : canonicalTypeNode(node.type, nestedContext),
    }
  }
  if (ts.isImportTypeNode(node)) {
    return {
      kind: 'import',
      argument: normalizeTypeScriptSyntax(node.argument.getText()),
      qualifier: node.qualifier?.getText() ?? null,
      arguments: (node.typeArguments ?? []).map(argument => canonicalTypeNode(argument, context)),
      typeof: node.isTypeOf,
    }
  }
  if (ts.isTemplateLiteralTypeNode(node)) {
    return {
      kind: 'template-literal',
      head: node.head.text,
      spans: node.templateSpans.map(span => ({ type: canonicalTypeNode(span.type, context), literal: span.literal.text })),
    }
  }
  if (ts.isNamedTupleMember(node)) return canonicalTupleElement(node, context)

  return { kind: 'syntax', syntaxKind: ts.SyntaxKind[node.kind] ?? String(node.kind), text: normalizeTypeScriptSyntax(node.getText()) }
}

function canonicalTupleElement(node: ts.TypeNode, context: CanonicalContext): CanonicalIrValue {
  if (ts.isNamedTupleMember(node)) {
    return {
      label: node.name.text,
      optional: node.questionToken !== undefined,
      rest: node.dotDotDotToken !== undefined,
      type: canonicalTypeNode(node.type, context),
    }
  }
  if (ts.isOptionalTypeNode(node)) return { label: null, optional: true, rest: false, type: canonicalTypeNode(node.type, context) }
  if (ts.isRestTypeNode(node)) return { label: null, optional: false, rest: true, type: canonicalTypeNode(node.type, context) }
  return { label: null, optional: false, rest: false, type: canonicalTypeNode(node, context) }
}

function canonicalLiteralType(node: ts.LiteralTypeNode['literal']): CanonicalIrValue {
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', primitive: 'null', value: null }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', primitive: 'boolean', value: true }
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', primitive: 'boolean', value: false }
  if (ts.isPrefixUnaryExpression(node)) {
    return { kind: 'literal', primitive: 'number', value: normalizeTypeScriptSyntax(node.getText()) }
  }
  if (ts.isStringLiteral(node)) return { kind: 'literal', primitive: 'string', value: node.text }
  if (ts.isNumericLiteral(node)) return { kind: 'literal', primitive: 'number', value: node.text }
  if (ts.isBigIntLiteral(node)) return { kind: 'literal', primitive: 'bigint', value: node.text }
  return { kind: 'literal', primitive: 'syntax', value: normalizeTypeScriptSyntax(node.getText()) }
}

function canonicalMembers(
  members: readonly ts.TypeElement[] | readonly ts.ClassElement[],
  context: CanonicalContext,
): CanonicalIrValue[] {
  return sortedCanonicalValues(members.map(member => canonicalMember(member, context)))
}

function canonicalMember(member: ts.TypeElement | ts.ClassElement, context: CanonicalContext): CanonicalIrValue {
  if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
    return {
      kind: 'property',
      name: canonicalPropertyName(member.name),
      optional: member.questionToken !== undefined,
      readonly: hasModifier(member.modifiers, ts.SyntaxKind.ReadonlyKeyword),
      static: hasModifier(member.modifiers, ts.SyntaxKind.StaticKeyword),
      type: member.type === undefined ? { kind: 'implicit' } : canonicalTypeNode(member.type, context),
    }
  }
  if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
    return {
      kind: 'method',
      name: canonicalPropertyName(member.name),
      optional: member.questionToken !== undefined,
      static: hasModifier(member.modifiers, ts.SyntaxKind.StaticKeyword),
      signature: canonicalSignature(member, context),
    }
  }
  if (ts.isCallSignatureDeclaration(member)) return { kind: 'call', signature: canonicalSignature(member, context) }
  if (ts.isConstructSignatureDeclaration(member) || ts.isConstructorDeclaration(member)) {
    return { kind: 'construct', signature: canonicalSignature(member, context) }
  }
  if (ts.isIndexSignatureDeclaration(member)) return { kind: 'index', signature: canonicalSignature(member, context) }
  if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
    return {
      kind: ts.isGetAccessorDeclaration(member) ? 'get' : 'set',
      name: canonicalPropertyName(member.name),
      static: hasModifier(member.modifiers, ts.SyntaxKind.StaticKeyword),
      signature: canonicalSignature(member, context),
    }
  }

  return { kind: 'member-syntax', text: normalizeTypeScriptSyntax(member.getText()) }
}

function canonicalSignature(
  signature: ts.SignatureDeclarationBase,
  context: CanonicalContext,
): CanonicalIrValue {
  const parameters = signature.typeParameters ?? []
  const nestedContext = withTypeParameters(context, parameters)
  return {
    typeParameters: canonicalTypeParameters(parameters, nestedContext),
    parameters: signature.parameters.map((parameter, index) => ({
      name: `$P${index}`,
      optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
      rest: parameter.dotDotDotToken !== undefined,
      type: parameter.type === undefined ? { kind: 'implicit' } : canonicalTypeNode(parameter.type, nestedContext),
    })),
    returns: signature.type === undefined ? { kind: 'implicit' } : canonicalTypeNode(signature.type, nestedContext),
  }
}

function canonicalExpressionWithTypeArguments(
  node: ts.ExpressionWithTypeArguments,
  context: CanonicalContext,
): CanonicalIrValue {
  const name = node.expression.getText()
  const target = name === context.selfName ? '$self' : context.resolveReference?.(name) ?? name
  return {
    target,
    arguments: (node.typeArguments ?? []).map(argument => canonicalTypeNode(argument, context)),
  }
}

function canonicalPropertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isBigIntLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text
  }
  if (ts.isComputedPropertyName(name)) return `[${normalizeTypeScriptSyntax(name.expression.getText())}]`
  return ''
}

function modifierNames(modifiers: readonly ts.Modifier[] | undefined): string[] {
  return (modifiers ?? []).map(modifier => ts.tokenToString(modifier.kind) ?? String(modifier.kind)).sort()
}

function hasModifier(modifiers: readonly ts.ModifierLike[] | undefined, kind: ts.SyntaxKind): boolean {
  return modifiers?.some(modifier => modifier.kind === kind) ?? false
}

function tokenState(token: ts.ReadonlyKeyword | ts.PlusToken | ts.MinusToken | ts.QuestionToken | undefined): string {
  if (token === undefined) return 'absent'
  if (token.kind === ts.SyntaxKind.PlusToken) return 'add'
  if (token.kind === ts.SyntaxKind.MinusToken) return 'remove'
  return 'present'
}

function withTypeParameters(
  context: CanonicalContext,
  parameters: readonly ts.TypeParameterDeclaration[],
): CanonicalContext {
  return {
    ...context,
    typeParameters: typeParameterMap(parameters, context.typeParameters),
  }
}

function sortedCanonicalValues<T extends CanonicalIrValue>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => stableCanonicalStringify(left).localeCompare(stableCanonicalStringify(right)))
}

function declarationName(declaration: SupportedTypeDeclaration): string {
  if (ts.isModuleDeclaration(declaration)) return declaration.name.getText()
  return declaration.name?.text ?? 'default'
}

export function isSupportedTypeDeclaration(node: ts.Node): node is SupportedTypeDeclaration {
  return ts.isTypeAliasDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isFunctionDeclaration(node)
    || ts.isModuleDeclaration(node)
}
