import ts from 'typescript'
import { readFileSync } from 'node:fs'
import type { HttpMethod, OperationEntry, OasParameter } from './types.js'
import { escapeJsonPointerToken } from './json-pointer.js'

export const SUPPORTED_HTTP_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
])

export const OA_OPERATION_REGEX =
  /^(GET|PUT|POST|DELETE|OPTIONS|HEAD|PATCH|TRACE|QUERY)\s+(\/\S*)$/i

export interface ExtractedOperation {
  readonly method: HttpMethod
  readonly path: string
  readonly declarationName: string
  readonly declarationKind: 'function' | 'type-alias'
  readonly file: string
  readonly line: number
  readonly column: number
  readonly outputPointer: string
  readonly description?: string
  readonly summary?: string
  readonly deprecated?: boolean
  readonly operationEntry: OperationEntry
}

/**
 * Encodes an OpenAPI 3.2 JSON pointer for a path and method.
 * E.g., path `/users/{id}` and method `get` -> `#/paths/~1users~1{id}/get`
 */
export function buildPathPointer(openApiPath: string, method: string): string {
  return `#/paths/${escapeJsonPointerToken(openApiPath)}/${method.toLowerCase()}`
}

export interface OperationDiagnostic {
  readonly code: 'invalid-oa-operation'
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly endLine?: number
  readonly endColumn?: number
  readonly severity?: 'error' | 'warning'
}

export interface OperationExtractResult {
  readonly operations: readonly ExtractedOperation[]
  readonly operationEntries: readonly OperationEntry[]
  readonly diagnostics: readonly OperationDiagnostic[]
}

export function toOperationEntry(operation: ExtractedOperation): OperationEntry {
  return operation.operationEntry
}

/**
 * Validates OpenAPI 3.2 path template parameter brace syntax.
 * Returns an error message if invalid, or null if valid.
 */
function validatePathTemplate(path: string): string | null {
  if (!path.startsWith('/')) {
    return `path must begin with leading '/': '${path}'`
  }
  let inBrace = false
  let paramName = ''
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]
    if (ch === '{') {
      if (inBrace) {
        return `nested parameter braces in '${path}'`
      }
      inBrace = true
      paramName = ''
    } else if (ch === '}') {
      if (!inBrace) {
        return `unmatched closing brace in '${path}'`
      }
      if (paramName.trim().length === 0) {
        return `empty parameter name in '${path}'`
      }
      inBrace = false
    } else if (inBrace) {
      paramName += ch
    }
  }
  if (inBrace) {
    return `unclosed parameter brace in '${path}'`
  }
  return null
}

function extractCommentText(tag: ts.JSDocTag): string {
  const rawComment = tag.comment
  if (typeof rawComment === 'string') {
    return rawComment.trim()
  }
  if (Array.isArray(rawComment) || rawComment) {
    return ts.getTextOfJSDocComment(rawComment)?.trim() ?? ''
  }
  return ''
}

function extractDescription(node: ts.Node): string | undefined {
  const jsDocs = (node as { jsDoc?: readonly ts.JSDoc[] }).jsDoc
  if (!jsDocs || jsDocs.length === 0) return undefined
  for (const doc of jsDocs) {
    const text = ts.getTextOfJSDocComment(doc.comment)
    if (text && text.trim().length > 0) {
      return text.trim()
    }
  }
  return undefined
}

function extractSummary(node: ts.Node): string | undefined {
  const tags = ts.getJSDocTags(node)
  const summaryTag = tags.find(t => t.tagName.text === 'summary')
  if (!summaryTag) return undefined
  const text = ts.getTextOfJSDocComment(summaryTag.comment)
  return text && text.trim().length > 0 ? text.trim() : undefined
}

function isDeprecated(node: ts.Node): boolean {
  const tags = ts.getJSDocTags(node)
  return tags.some(t => t.tagName.text === 'deprecated')
}

function extractOperationId(node: ts.Node): string | undefined {
  const tags = ts.getJSDocTags(node)
  const opIdTag = tags.find(t => t.tagName.text === 'operationId')
  if (!opIdTag) return undefined
  const text = ts.getTextOfJSDocComment(opIdTag.comment)
  return text && text.trim().length > 0 ? text.trim() : undefined
}

function extractTags(node: ts.Node): string[] {
  const tags = ts.getJSDocTags(node)
  const tagTags = tags.filter(t => t.tagName.text === 'tag' || t.tagName.text === 'tags')
  const result: string[] = []
  for (const t of tagTags) {
    const text = ts.getTextOfJSDocComment(t.comment)
    if (text) {
      for (const item of text.split(',')) {
        const trimmed = item.trim()
        if (trimmed.length > 0) {
          result.push(trimmed)
        }
      }
    }
  }
  return result
}

function collectExportedNames(sourceFile: ts.SourceFile): Set<string> {
  const exported = new Set<string>()
  for (const stmt of sourceFile.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const specifier of stmt.exportClause.elements) {
        const localName = specifier.propertyName ? specifier.propertyName.text : specifier.name.text
        exported.add(localName)
      }
    }
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && ts.isIdentifier(stmt.expression)) {
      exported.add(stmt.expression.text)
    }
  }
  return exported
}

function isDeclarationExported(
  statement: ts.FunctionDeclaration | ts.TypeAliasDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean {
  if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
    return true
  }
  const name = statement.name && ts.isIdentifier(statement.name) ? statement.name.text : undefined
  if (name && exportedNames.has(name)) {
    return true
  }
  return false
}

/**
 * Extracts OpenAPI 3.2 operations and diagnostics from TypeScript source text
 * via explicit `/** @oaOperation <METHOD> <PATH> *\/` JSDoc annotations on
 * exported FunctionDeclaration and TypeAliasDeclaration nodes.
 */
export function extractOperationsFromSource(
  sourceText: string,
  filePath?: string,
): OperationExtractResult {
  const file = filePath ?? 'source.ts'
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true)

  const operations: ExtractedOperation[] = []
  const diagnostics: OperationDiagnostic[] = []
  const exportedNames = collectExportedNames(sourceFile)

  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) {
      continue
    }

    if (!isDeclarationExported(statement, exportedNames)) {
      continue
    }

    const allTags = ts.getJSDocTags(statement)
    const opTags = allTags.filter(tag => tag.tagName.text === 'oaOperation')

    if (opTags.length === 0) {
      // Declarations without @oaOperation are strictly ignored
      continue
    }

    const declarationName = statement.name && ts.isIdentifier(statement.name)
      ? statement.name.text
      : 'default'
    const declarationKind: 'function' | 'type-alias' = ts.isFunctionDeclaration(statement)
      ? 'function'
      : 'type-alias'

    const declStart = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
    const declLine = declStart.line + 1
    const declColumn = declStart.character + 1

    const description = extractDescription(statement)
    const summary = extractSummary(statement)
    const deprecated = isDeprecated(statement)
    const operationId = extractOperationId(statement) ?? declarationName
    const tags = extractTags(statement)

    for (const tag of opTags) {
      const tagStart = sourceFile.getLineAndCharacterOfPosition(tag.getStart(sourceFile))
      const tagEnd = sourceFile.getLineAndCharacterOfPosition(tag.getEnd())
      const tagLine = tagStart.line + 1
      const tagColumn = tagStart.character + 1
      const tagEndLine = tagEnd.line + 1
      const tagEndColumn = tagEnd.character + 1

      const commentText = extractCommentText(tag)

      const match = OA_OPERATION_REGEX.exec(commentText)
      if (match === null) {
        let message = "@oaOperation must have the form '<METHOD> /path'."
        if (commentText.length > 0) {
          const parts = commentText.split(/\s+/)
          if (parts.length === 1) {
            message = `@oaOperation must have the form '<METHOD> /path'. Missing path component.`
          } else {
            const rawMethod = parts[0]
            const rawPath = parts[1]
            if (rawMethod !== undefined && rawPath !== undefined) {
              if (!rawPath.startsWith('/')) {
                message = `@oaOperation must have the form '<METHOD> /path'. Path must begin with leading '/': '${rawPath}'.`
              } else if (!SUPPORTED_HTTP_METHODS.has(rawMethod.toLowerCase() as HttpMethod)) {
                message = `Unsupported HTTP method: ${rawMethod}. @oaOperation must have the form '<METHOD> /path'.`
              }
            }
          }
        }

        diagnostics.push({
          code: 'invalid-oa-operation',
          message,
          file,
          line: tagLine,
          column: tagColumn,
          endLine: tagEndLine,
          endColumn: tagEndColumn,
          severity: 'error',
        })
        continue
      }

      const rawMethod = match[1]!
      const method = rawMethod.toLowerCase() as HttpMethod
      const path = match[2]!

      if (!SUPPORTED_HTTP_METHODS.has(method)) {
        diagnostics.push({
          code: 'invalid-oa-operation',
          message: `Unsupported HTTP method: ${rawMethod}. @oaOperation must have the form '<METHOD> /path'.`,
          file,
          line: tagLine,
          column: tagColumn,
          endLine: tagEndLine,
          endColumn: tagEndColumn,
          severity: 'error',
        })
        continue
      }

      if (!path.startsWith('/')) {
        diagnostics.push({
          code: 'invalid-oa-operation',
          message: `@oaOperation must have the form '<METHOD> /path'. Path must begin with leading '/': '${path}'.`,
          file,
          line: tagLine,
          column: tagColumn,
          endLine: tagEndLine,
          endColumn: tagEndColumn,
          severity: 'error',
        })
        continue
      }

      const pathTemplateError = validatePathTemplate(path)
      if (pathTemplateError !== null) {
        diagnostics.push({
          code: 'invalid-oa-operation',
          message: `@oaOperation invalid path template: ${pathTemplateError}.`,
          file,
          line: tagLine,
          column: tagColumn,
          endLine: tagEndLine,
          endColumn: tagEndColumn,
          severity: 'error',
        })
        continue
      }

      const pathParamMatches = [...path.matchAll(/\{([^}]+)\}/g)]
      const parameters: OasParameter[] = pathParamMatches.map(m => ({
        name: m[1]!,
        in: 'path',
        required: true,
      }))

      const operationEntry: OperationEntry = {
        operationId,
        openApiPath: path,
        method,
        tags,
        deprecated,
        parameters,
        responses: {},
        security: [],
        servers: [],
        callbacks: {},
      }
      if (summary !== undefined) operationEntry.summary = summary
      if (description !== undefined) operationEntry.description = description

      const extractedOp: ExtractedOperation = {
        method,
        path,
        declarationName,
        declarationKind,
        file,
        line: declLine,
        column: declColumn,
        outputPointer: buildPathPointer(path, method),
        ...(description !== undefined ? { description } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(deprecated ? { deprecated: true } : {}),
        operationEntry,
      }

      operations.push(extractedOp)
    }
  }

  return {
    operations,
    operationEntries: operations.map(op => op.operationEntry),
    diagnostics,
  }
}

/**
 * Reads a TypeScript source file from disk and extracts OpenAPI 3.2 operations and diagnostics.
 */
export function extractOperationsFromFile(filePath: string): OperationExtractResult {
  const sourceText = readFileSync(filePath, 'utf-8')
  return extractOperationsFromSource(sourceText, filePath)
}
