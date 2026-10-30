import * as ts from 'typescript'
import {
  canonicalizeTypeDeclaration,
  isSupportedTypeDeclaration,
  normalizeTypeScriptSyntax,
  sha256,
  stableCanonicalStringify,
  type SupportedTypeDeclaration,
} from './type-registry-canonical-ir.js'
import type {
  TypeArtifactOrigin,
  TypeArtifactRecord,
  TypeArtifactRole,
  TypeBoundaryKind,
  TypeBoundaryRecord,
  TypeDeclarationKind,
  TypeDeclarationRecord,
  TypeExposureKind,
  TypeExposureRecord,
  TypeRegistryRuntime,
  TypeRelationKind,
  TypeRelationRecord,
  WorkspaceTypeFileIndexData,
} from './type-registry.js'

export const TYPE_REGISTRY_EXTRACTOR_VERSION = 'oa-sdk.type-registry-extractor.v1' as const

export type ExtractTypeRegistryFileOptions = {
  filePath: string
  sourceText: string
  packageName?: string
  logicalModule?: string
  exportKey?: string
  runtime?: TypeRegistryRuntime
  origin?: TypeArtifactOrigin
  role?: TypeArtifactRole
  artifactId?: string
  tsconfigHash?: string
  generatorId?: string
  generatorVersion?: string
  generatorInputHash?: string
}

type DeclarationCandidate = {
  declaration: SupportedTypeDeclaration
  symbolName: string
  qualifiedName: string
  kind: TypeDeclarationKind
  identityDiscriminator: string
  exportedNames: readonly string[]
}

type ImportBinding = {
  localName: string
  targetSpecifier: string
  targetSymbol?: string
  typeOnly: boolean
}

type RelationTarget = {
  toDeclarationId?: string
  targetSpecifier?: string
  targetSymbol?: string
  typeOnly?: boolean
  resolved: boolean
}

export function extractTypeRegistryFile(options: ExtractTypeRegistryFileOptions): WorkspaceTypeFileIndexData {
  const sourceFile = ts.createSourceFile(
    options.filePath,
    options.sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(options.filePath),
  )
  const runtime = options.runtime ?? 'neutral'
  const exportKey = options.exportKey ?? '.'
  const moduleIdentity = normalizeModuleIdentity(options.logicalModule ?? options.filePath)
  const artifactId = options.artifactId ?? stableId('type-artifact', [
    options.packageName ?? '<workspace>',
    moduleIdentity,
    runtime,
  ])
  const artifact = createArtifactRecord(options, artifactId, runtime, moduleIdentity)
  const imports = collectImports(sourceFile)
  const localExports = collectLocalExports(sourceFile)
  const candidates = collectDeclarationCandidates(sourceFile, localExports)
  const declarationIds = new Map<DeclarationCandidate, string>()
  const localDeclarations = new Map<string, string>()

  for (const candidate of candidates) {
    const declarationId = stableId('type-declaration', [
      artifactId,
      candidate.qualifiedName,
      candidate.kind,
      candidate.identityDiscriminator,
    ])
    declarationIds.set(candidate, declarationId)
    if (!localDeclarations.has(candidate.qualifiedName)) localDeclarations.set(candidate.qualifiedName, declarationId)
    if (!localDeclarations.has(candidate.symbolName)) localDeclarations.set(candidate.symbolName, declarationId)
  }

  const resolveReference = (referenceName: string): string | undefined => {
    const local = localDeclarations.get(referenceName)
    if (local !== undefined) return local
    const imported = resolveImportBinding(referenceName, imports)
    if (imported === undefined) return undefined
    return `${imported.targetSpecifier}#${imported.targetSymbol ?? 'default'}`
  }

  const declarations = candidates.map(candidate => {
    const declarationId = declarationIds.get(candidate)
    if (declarationId === undefined) throw new Error(`Missing declaration id for ${candidate.qualifiedName}`)
    return createDeclarationRecord({
      artifactId,
      candidate,
      declarationId,
      filePath: options.filePath,
      sourceFile,
      resolveReference,
      qualifiedNamePrefix: `${options.packageName ?? '<workspace>'}:${moduleIdentity}`,
    })
  })
  const relations = [
    ...createImportRelations(options.filePath, imports),
    ...candidates.flatMap(candidate => createDeclarationRelations({
      candidate,
      declarationId: requiredDeclarationId(candidate, declarationIds),
      filePath: options.filePath,
      imports,
      localDeclarations,
    })),
    ...createReexportRelations(sourceFile, options.filePath),
  ]
  const exposures = createExposures({
    sourceFile,
    candidates,
    declarationIds,
    filePath: options.filePath,
    packageName: options.packageName,
    exportKey,
    runtime,
  })

  return {
    artifacts: [artifact],
    declarations: stableSort(declarations, declaration => declaration.declarationId),
    relations: dedupeAndSort(relations, relation => relation.relationId),
    boundaries: extractTypeBoundaries(sourceFile, options.filePath),
    exposures: dedupeAndSort(exposures, exposure => exposure.exposureId),
  }
}

function createArtifactRecord(
  options: ExtractTypeRegistryFileOptions,
  artifactId: string,
  runtime: TypeRegistryRuntime,
  moduleIdentity: string,
): TypeArtifactRecord {
  return {
    artifactId,
    filePath: options.filePath,
    runtime,
    origin: options.origin ?? 'handwritten',
    role: options.role ?? 'observation',
    contentHash: sha256(options.sourceText),
    compilerVersion: ts.version,
    ...(options.packageName === undefined ? {} : { packageName: options.packageName }),
    logicalModule: options.logicalModule ?? moduleIdentity,
    ...(options.tsconfigHash === undefined ? {} : { tsconfigHash: options.tsconfigHash }),
    ...(options.generatorId === undefined ? {} : { generatorId: options.generatorId }),
    ...(options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion }),
    ...(options.generatorInputHash === undefined ? {} : { generatorInputHash: options.generatorInputHash }),
  }
}

function collectDeclarationCandidates(
  sourceFile: ts.SourceFile,
  localExports: ReadonlyMap<string, readonly string[]>,
): DeclarationCandidate[] {
  const unnumbered: Omit<DeclarationCandidate, 'identityDiscriminator'>[] = []

  const visitStatements = (
    statements: readonly ts.Statement[],
    namespace: readonly string[],
    namespaceExported: boolean,
  ): void => {
    for (const statement of statements) {
      if (!isSupportedTypeDeclaration(statement)) continue
      const symbolName = declarationSymbolName(statement)
      const qualifiedName = [...namespace, symbolName].join('.')
      const directlyExported = hasModifier(statement.modifiers, ts.SyntaxKind.ExportKeyword)
      const exportedNames = namespace.length === 0
        ? declarationExportNames(statement, localExports.get(symbolName) ?? [])
        : directlyExported && namespaceExported ? [qualifiedName] : []
      unnumbered.push({
        declaration: statement,
        symbolName,
        qualifiedName,
        kind: declarationKind(statement),
        exportedNames,
      })

      if (ts.isModuleDeclaration(statement)) {
        const block = deepestModuleBlock(statement)
        if (block !== undefined) {
          visitStatements(block.statements, [...namespace, symbolName], exportedNames.length > 0)
        }
      }
    }
  }

  visitStatements(sourceFile.statements, [], true)
  const groupCounts = new Map<string, number>()
  for (const candidate of unnumbered) {
    const key = `${candidate.qualifiedName}\0${candidate.kind}`
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1)
  }
  const seenDiscriminators = new Map<string, number>()
  return unnumbered.map(candidate => {
    const groupKey = `${candidate.qualifiedName}\0${candidate.kind}`
    if ((groupCounts.get(groupKey) ?? 0) === 1) return { ...candidate, identityDiscriminator: '' }
    const syntaxDiscriminator = sha256(normalizeTypeScriptSyntax(candidate.declaration.getText(sourceFile))).slice(0, 16)
    const discriminatorKey = `${groupKey}\0${syntaxDiscriminator}`
    const duplicateOrdinal = seenDiscriminators.get(discriminatorKey) ?? 0
    seenDiscriminators.set(discriminatorKey, duplicateOrdinal + 1)
    return { ...candidate, identityDiscriminator: `${syntaxDiscriminator}:${duplicateOrdinal}` }
  })
}

function createDeclarationRecord(options: {
  artifactId: string
  candidate: DeclarationCandidate
  declarationId: string
  filePath: string
  sourceFile: ts.SourceFile
  resolveReference: (referenceName: string) => string | undefined
  qualifiedNamePrefix: string
}): TypeDeclarationRecord {
  const { artifactId, candidate, declarationId, filePath, sourceFile, resolveReference, qualifiedNamePrefix } = options
  const hashes = canonicalizeTypeDeclaration({
    declaration: candidate.declaration,
    sourceFile,
    symbolName: candidate.symbolName,
    resolveReference,
  })
  const start = sourcePosition(sourceFile, candidate.declaration.getStart(sourceFile))
  const end = sourcePosition(sourceFile, candidate.declaration.getEnd())

  return {
    declarationId,
    artifactId,
    filePath,
    symbolName: candidate.symbolName,
    qualifiedName: `${qualifiedNamePrefix}#${candidate.qualifiedName}`,
    kind: candidate.kind,
    exported: candidate.exportedNames.length > 0,
    genericArity: declarationTypeParameterCount(candidate.declaration),
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    syntaxHash: hashes.syntaxHash,
    shapeHash: hashes.shapeHash,
    semanticHash: hashes.semanticHash,
    canonicalIr: hashes.canonicalIr,
  }
}

function collectImports(sourceFile: ts.SourceFile): Map<string, ImportBinding> {
  const imports = new Map<string, ImportBinding>()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const targetSpecifier = statement.moduleSpecifier.text
    const clause = statement.importClause
    if (clause === undefined) continue

    if (clause.name !== undefined) {
      imports.set(clause.name.text, {
        localName: clause.name.text,
        targetSpecifier,
        targetSymbol: 'default',
        typeOnly: clause.isTypeOnly,
      })
    }
    if (clause.namedBindings === undefined) continue
    if (ts.isNamespaceImport(clause.namedBindings)) {
      imports.set(clause.namedBindings.name.text, {
        localName: clause.namedBindings.name.text,
        targetSpecifier,
        targetSymbol: '*',
        typeOnly: clause.isTypeOnly,
      })
      continue
    }
    for (const element of clause.namedBindings.elements) {
      imports.set(element.name.text, {
        localName: element.name.text,
        targetSpecifier,
        targetSymbol: element.propertyName?.text ?? element.name.text,
        typeOnly: clause.isTypeOnly || element.isTypeOnly,
      })
    }
  }

  return imports
}

function createImportRelations(filePath: string, imports: ReadonlyMap<string, ImportBinding>): TypeRelationRecord[] {
  return [...imports.values()].map(binding => createRelationRecord({
    filePath,
    kind: 'import',
    targetSpecifier: binding.targetSpecifier,
    ...(binding.targetSymbol === undefined ? {} : { targetSymbol: binding.targetSymbol }),
    typeOnly: binding.typeOnly,
    resolved: false,
    identityParts: [binding.localName],
  }))
}

function createDeclarationRelations(options: {
  candidate: DeclarationCandidate
  declarationId: string
  filePath: string
  imports: ReadonlyMap<string, ImportBinding>
  localDeclarations: ReadonlyMap<string, string>
}): TypeRelationRecord[] {
  const { candidate, declarationId, filePath, imports, localDeclarations } = options
  const relations: TypeRelationRecord[] = []
  const seen = new Set<string>()

  const addReference = (referenceName: string, kind: TypeRelationKind): void => {
    const target = resolveRelationTarget(referenceName, imports, localDeclarations)
    const key = stableCanonicalStringify({
      kind,
      referenceName,
      toDeclarationId: target.toDeclarationId ?? null,
      targetSpecifier: target.targetSpecifier ?? null,
      targetSymbol: target.targetSymbol ?? null,
    })
    if (seen.has(key)) return
    seen.add(key)
    relations.push(createRelationRecord({
      filePath,
      fromDeclarationId: declarationId,
      kind,
      ...target,
      identityParts: [referenceName],
    }))
  }

  const rootAliasType = ts.isTypeAliasDeclaration(candidate.declaration) ? candidate.declaration.type : undefined
  const visit = (node: ts.Node): void => {
    if (node !== candidate.declaration && isSupportedTypeDeclaration(node)) return
    if (ts.isTypeReferenceNode(node)) {
      const referenceName = node.typeName.getText()
      addReference(referenceName, node === rootAliasType ? 'alias' : 'type-ref')
    } else if (ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent)) {
      addReference(
        node.expression.getText(),
        node.parent.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends',
      )
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      const targetSpecifier = node.argument.literal.text
      const targetSymbol = node.qualifier?.getText()
      const relation = createRelationRecord({
        filePath,
        fromDeclarationId: declarationId,
        kind: 'type-ref',
        targetSpecifier,
        ...(targetSymbol === undefined ? {} : { targetSymbol }),
        typeOnly: true,
        resolved: false,
        identityParts: ['import-type'],
      })
      if (!seen.has(relation.relationId)) {
        seen.add(relation.relationId)
        relations.push(relation)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(candidate.declaration)
  return relations
}

function createReexportRelations(sourceFile: ts.SourceFile, filePath: string): TypeRelationRecord[] {
  const relations: TypeRelationRecord[] = []

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    const targetSpecifier = statement.moduleSpecifier.text
    if (statement.exportClause === undefined) {
      relations.push(createRelationRecord({
        filePath,
        kind: 'reexport',
        targetSpecifier,
        targetSymbol: '*',
        typeOnly: statement.isTypeOnly,
        resolved: false,
        identityParts: ['*'],
      }))
      continue
    }
    if (ts.isNamespaceExport(statement.exportClause)) {
      relations.push(createRelationRecord({
        filePath,
        kind: 'reexport',
        targetSpecifier,
        targetSymbol: '*',
        typeOnly: statement.isTypeOnly,
        resolved: false,
        identityParts: [statement.exportClause.name.text],
      }))
      continue
    }
    for (const element of statement.exportClause.elements) {
      relations.push(createRelationRecord({
        filePath,
        kind: 'reexport',
        targetSpecifier,
        targetSymbol: element.propertyName?.text ?? element.name.text,
        typeOnly: statement.isTypeOnly || element.isTypeOnly,
        resolved: false,
        identityParts: [element.name.text],
      }))
    }
  }

  return relations
}

function createRelationRecord(options: {
  filePath: string
  fromDeclarationId?: string
  kind: TypeRelationKind
  toDeclarationId?: string
  targetSpecifier?: string
  targetSymbol?: string
  typeOnly?: boolean
  resolved: boolean
  identityParts?: readonly string[]
}): TypeRelationRecord {
  const identity = [
    options.filePath,
    options.fromDeclarationId ?? '',
    options.kind,
    options.toDeclarationId ?? '',
    options.targetSpecifier ?? '',
    options.targetSymbol ?? '',
    String(options.typeOnly ?? false),
    ...(options.identityParts ?? []),
  ]
  return {
    relationId: stableId('type-relation', identity),
    filePath: options.filePath,
    kind: options.kind,
    resolved: options.resolved,
    ...(options.fromDeclarationId === undefined ? {} : { fromDeclarationId: options.fromDeclarationId }),
    ...(options.toDeclarationId === undefined ? {} : { toDeclarationId: options.toDeclarationId }),
    ...(options.targetSpecifier === undefined ? {} : { targetSpecifier: options.targetSpecifier }),
    ...(options.targetSymbol === undefined ? {} : { targetSymbol: options.targetSymbol }),
    ...(options.typeOnly === undefined ? {} : { typeOnly: options.typeOnly }),
  }
}

function resolveRelationTarget(
  referenceName: string,
  imports: ReadonlyMap<string, ImportBinding>,
  localDeclarations: ReadonlyMap<string, string>,
): RelationTarget {
  const local = localDeclarations.get(referenceName)
  if (local !== undefined) return { toDeclarationId: local, resolved: true }
  const imported = resolveImportBinding(referenceName, imports)
  if (imported !== undefined) {
    return {
      targetSpecifier: imported.targetSpecifier,
      ...(imported.targetSymbol === undefined ? {} : { targetSymbol: imported.targetSymbol }),
      typeOnly: imported.typeOnly,
      resolved: false,
    }
  }
  return { targetSymbol: referenceName, resolved: false }
}

function resolveImportBinding(
  referenceName: string,
  imports: ReadonlyMap<string, ImportBinding>,
): ImportBinding | undefined {
  const [root, ...rest] = referenceName.split('.')
  if (root === undefined) return undefined
  const binding = imports.get(root)
  if (binding === undefined) return undefined
  if (binding.targetSymbol !== '*') return binding
  return {
    ...binding,
    targetSymbol: rest.length === 0 ? '*' : rest.join('.'),
  }
}

function createExposures(options: {
  sourceFile: ts.SourceFile
  candidates: readonly DeclarationCandidate[]
  declarationIds: ReadonlyMap<DeclarationCandidate, string>
  filePath: string
  packageName: string | undefined
  exportKey: string
  runtime: TypeRegistryRuntime
}): TypeExposureRecord[] {
  const { sourceFile, candidates, declarationIds, filePath, packageName, exportKey, runtime } = options
  const exposures: TypeExposureRecord[] = []
  const candidatesByName = new Map(candidates.map(candidate => [candidate.symbolName, candidate]))

  for (const candidate of candidates) {
    for (const exportName of candidate.exportedNames) {
      exposures.push(createExposureRecord({
        declarationId: requiredDeclarationId(candidate, declarationIds),
        filePath,
        packageName,
        exportKey,
        exportName,
        localName: candidate.symbolName,
        runtime,
        kind: declarationExposureKind(candidate.kind),
        reexport: false,
      }))
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
      const targetSpecifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : statement.moduleSpecifier.getText()
      if (statement.exportClause === undefined) {
        exposures.push(createExposureRecord({
          filePath,
          packageName,
          exportKey,
          exportName: '*',
          targetSpecifier,
          runtime,
          kind: statement.isTypeOnly ? 'type' : 'mixed',
          reexport: true,
        }))
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        exposures.push(createExposureRecord({
          filePath,
          packageName,
          exportKey,
          exportName: statement.exportClause.name.text,
          targetSpecifier,
          runtime,
          kind: statement.isTypeOnly ? 'type' : 'mixed',
          reexport: true,
        }))
      } else {
        for (const element of statement.exportClause.elements) {
          exposures.push(createExposureRecord({
            filePath,
            packageName,
            exportKey,
            exportName: element.name.text,
            localName: element.propertyName?.text ?? element.name.text,
            targetSpecifier,
            runtime,
            kind: statement.isTypeOnly || element.isTypeOnly ? 'type' : 'mixed',
            reexport: true,
          }))
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      const localName = ts.isIdentifier(statement.expression) ? statement.expression.text : undefined
      const candidate = localName === undefined ? undefined : candidatesByName.get(localName)
      exposures.push(createExposureRecord({
        ...(candidate === undefined ? {} : { declarationId: requiredDeclarationId(candidate, declarationIds) }),
        filePath,
        packageName,
        exportKey,
        exportName: statement.isExportEquals ? 'export=' : 'default',
        ...(localName === undefined ? {} : { localName }),
        runtime,
        kind: candidate === undefined ? 'value' : declarationExposureKind(candidate.kind),
        reexport: false,
      }))
    }
  }

  return exposures
}

function createExposureRecord(options: {
  declarationId?: string
  filePath: string
  packageName: string | undefined
  exportKey: string
  exportName: string
  localName?: string
  targetSpecifier?: string
  runtime: TypeRegistryRuntime
  kind: TypeExposureKind
  reexport: boolean
}): TypeExposureRecord {
  return {
    exposureId: stableId('type-exposure', [
      options.filePath,
      options.packageName ?? '',
      options.exportKey,
      options.exportName,
      options.localName ?? '',
      options.targetSpecifier ?? '',
      options.runtime,
    ]),
    filePath: options.filePath,
    exportKey: options.exportKey,
    exportName: options.exportName,
    runtime: options.runtime,
    kind: options.kind,
    reexport: options.reexport,
    ...(options.declarationId === undefined ? {} : { declarationId: options.declarationId }),
    ...(options.packageName === undefined ? {} : { packageName: options.packageName }),
    ...(options.localName === undefined ? {} : { localName: options.localName }),
    ...(options.targetSpecifier === undefined ? {} : { targetSpecifier: options.targetSpecifier }),
  }
}

function extractTypeBoundaries(sourceFile: ts.SourceFile, filePath: string): TypeBoundaryRecord[] {
  const boundaries: TypeBoundaryRecord[] = []
  const occurrences = new Map<string, number>()

  const addBoundary = (
    node: ts.Node,
    kind: TypeBoundaryKind,
    details: Pick<TypeBoundaryRecord, 'sourceType' | 'targetType' | 'validatorSymbol'> = {},
  ): void => {
    const snippet = normalizeTypeScriptSyntax(node.getText(sourceFile))
    const occurrenceKey = `${kind}\0${snippet}`
    const ordinal = occurrences.get(occurrenceKey) ?? 0
    occurrences.set(occurrenceKey, ordinal + 1)
    const position = sourcePosition(sourceFile, node.getStart(sourceFile))
    boundaries.push({
      boundaryId: stableId('type-boundary', [filePath, kind, snippet, String(ordinal)]),
      filePath,
      line: position.line,
      column: position.column,
      kind,
      ...details,
    })
  }

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) addBoundary(node, 'any')
    if (node.kind === ts.SyntaxKind.UnknownKeyword) addBoundary(node, 'unknown')

    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      addBoundary(node, 'assertion', {
        sourceType: expressionDescription(node.expression),
        targetType: normalizeTypeScriptSyntax(node.type.getText(sourceFile)),
      })
      const inner = unwrapParentheses(node.expression)
      if (ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) {
        addBoundary(node, 'double-assertion', {
          sourceType: normalizeTypeScriptSyntax(inner.type.getText(sourceFile)),
          targetType: normalizeTypeScriptSyntax(node.type.getText(sourceFile)),
        })
      }
    }

    if (ts.isNonNullExpression(node)) {
      addBoundary(node, 'non-null', { sourceType: expressionDescription(node.expression) })
    }

    if (ts.isCallExpression(node) && isDeserializeCall(node)) {
      const validatorSymbol = enclosingValidatorSymbol(node)
      addBoundary(node, 'deserialize', {
        sourceType: node.expression.getText(sourceFile),
        ...(validatorSymbol === undefined ? {} : { validatorSymbol }),
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return stableSort(boundaries, boundary => boundary.boundaryId)
}

function isDeserializeCall(call: ts.CallExpression): boolean {
  const callee = call.expression
  if (ts.isIdentifier(callee)) {
    return /^(?:deserialize|decode|parseJson|parseJSON)$/.test(callee.text)
  }
  if (!ts.isPropertyAccessExpression(callee)) return false
  // `response.json()` / `request.json()` read a body. `c.json(value)` and `Response.json(value)`
  // take an argument and build a response: they serialize, so they are not a deserialize boundary.
  if (callee.name.text === 'json') return call.arguments.length === 0
  if (callee.name.text === 'decode' || callee.name.text === 'deserialize') return true
  if (callee.name.text !== 'parse') return false
  const owner = callee.expression.getText()
  return /^(?:JSON|JSON5|YAML|yaml)$/.test(owner)
}

function enclosingValidatorSymbol(node: ts.CallExpression): string | undefined {
  let parent: ts.Node = node.parent
  while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) {
    parent = parent.parent
  }
  if (!ts.isCallExpression(parent) || !parent.arguments.includes(node)) return undefined
  if (!ts.isPropertyAccessExpression(parent.expression)) return undefined
  if (parent.expression.name.text !== 'parse' && parent.expression.name.text !== 'safeParse') return undefined
  const owner = parent.expression.expression.getText()
  return `${owner}.${parent.expression.name.text}`
}

function collectLocalExports(sourceFile: ts.SourceFile): Map<string, readonly string[]> {
  const result = new Map<string, string[]>()
  const add = (localName: string, exportName: string): void => {
    const names = result.get(localName) ?? []
    if (!names.includes(exportName)) names.push(exportName)
    result.set(localName, names)
  }

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier === undefined && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        add(element.propertyName?.text ?? element.name.text, element.name.text)
      }
    } else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      add(statement.expression.text, statement.isExportEquals ? 'export=' : 'default')
    }
  }

  return result
}

function declarationExportNames(
  declaration: SupportedTypeDeclaration,
  namedExports: readonly string[],
): readonly string[] {
  const names = [...namedExports]
  if (hasModifier(declaration.modifiers, ts.SyntaxKind.DefaultKeyword)) names.push('default')
  else if (hasModifier(declaration.modifiers, ts.SyntaxKind.ExportKeyword)) names.push(declarationSymbolName(declaration))
  return [...new Set(names)].sort()
}

function declarationExposureKind(kind: TypeDeclarationKind): TypeExposureKind {
  if (kind === 'type-alias' || kind === 'interface') return 'type'
  if (kind === 'function') return 'value'
  return 'mixed'
}

function declarationKind(declaration: SupportedTypeDeclaration): TypeDeclarationKind {
  if (ts.isTypeAliasDeclaration(declaration)) return 'type-alias'
  if (ts.isInterfaceDeclaration(declaration)) return 'interface'
  if (ts.isEnumDeclaration(declaration)) return 'enum'
  if (ts.isClassDeclaration(declaration)) return 'class'
  if (ts.isFunctionDeclaration(declaration)) return 'function'
  return 'namespace'
}

function declarationSymbolName(declaration: SupportedTypeDeclaration): string {
  if (ts.isModuleDeclaration(declaration)) return declaration.name.getText().replace(/^['"]|['"]$/g, '')
  return declaration.name?.text ?? 'default'
}

function declarationTypeParameterCount(declaration: SupportedTypeDeclaration): number {
  if (ts.isEnumDeclaration(declaration) || ts.isModuleDeclaration(declaration)) return 0
  return declaration.typeParameters?.length ?? 0
}

function deepestModuleBlock(declaration: ts.ModuleDeclaration): ts.ModuleBlock | undefined {
  let current: ts.ModuleDeclaration = declaration
  while (current.body !== undefined) {
    if (ts.isModuleBlock(current.body)) return current.body
    if (!ts.isModuleDeclaration(current.body)) return undefined
    current = current.body
  }
  return undefined
}

function hasModifier(modifiers: readonly ts.ModifierLike[] | undefined, kind: ts.SyntaxKind): boolean {
  return modifiers?.some(modifier => modifier.kind === kind) ?? false
}

function sourcePosition(sourceFile: ts.SourceFile, position: number): { line: number; column: number } {
  const result = sourceFile.getLineAndCharacterOfPosition(position)
  return { line: result.line + 1, column: result.character + 1 }
}

function expressionDescription(expression: ts.Expression): string {
  return ts.SyntaxKind[expression.kind] ?? String(expression.kind)
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return current
}

function normalizeModuleIdentity(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

function stableId(prefix: string, parts: readonly string[]): string {
  return `${prefix}:${sha256(stableCanonicalStringify(parts)).slice(0, 32)}`
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
  if (/\.tsx$/i.test(filePath)) return ts.ScriptKind.TSX
  if (/\.jsx$/i.test(filePath)) return ts.ScriptKind.JSX
  if (/\.(?:js|mjs|cjs)$/i.test(filePath)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function requiredDeclarationId(
  candidate: DeclarationCandidate,
  ids: ReadonlyMap<DeclarationCandidate, string>,
): string {
  const declarationId = ids.get(candidate)
  if (declarationId === undefined) throw new Error(`Missing declaration id for ${candidate.qualifiedName}`)
  return declarationId
}

function stableSort<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)))
}

function dedupeAndSort<T>(values: readonly T[], key: (value: T) => string): T[] {
  const deduped = new Map<string, T>()
  for (const value of values) deduped.set(key(value), value)
  return stableSort([...deduped.values()], key)
}
