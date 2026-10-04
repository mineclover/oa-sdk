import type {
  OasComponents,
  OasDocument,
  OasInfo,
  OasTag,
  OasPathItem,
} from './oas32-types.js'
import type { CanonicalDefinitionId, ComponentLikeDefinitionKind } from './definition-id.js'
import type {
  DefinitionOutputAliasMetadata,
  DefinitionOutputNameCollisionReportEntry,
  DefinitionOutputNameDiagnostic,
} from './definition-output-names.js'
import {
  rewriteDefinitionOutputRefs,
  type DefinitionOutputRefRewrite,
} from './definition-output-refs.js'
import type {
  DefinitionRegistry,
  DefinitionRegistryNode,
} from './definition-registry.js'
import type {
  DefinitionTargetDiagnostic,
  DefinitionTargetSelectionResult,
} from './definition-target.js'
import { escapeJsonPointerToken } from './json-pointer.js'
import { validateDocument, type ValidationResult } from './validate.js'

type ComponentSection =
  | 'schemas'
  | 'responses'
  | 'parameters'
  | 'requestBodies'
  | 'headers'
  | 'links'
  | 'callbacks'
  | 'securitySchemes'

const COMPONENT_SECTION_BY_KIND = {
  schema: 'schemas',
  response: 'responses',
  parameter: 'parameters',
  requestBody: 'requestBodies',
  header: 'headers',
  link: 'links',
  callback: 'callbacks',
  securityScheme: 'securitySchemes',
} as const satisfies Record<ComponentLikeDefinitionKind, ComponentSection>

const ALIAS_EXTENSION = 'x-oa-sdk-definition-aliases'

export type DefinitionOpenApiEmitOptions = {
  openapi?: string
  info?: OasInfo
  tags?: readonly OasTag[]
  jsonSchemaDialect?: string
  includeAliasMetadata?: boolean
}

export type DefinitionOpenApiEmitDiagnosticCode =
  | 'definition-openapi-emit/missing-path'
  | 'definition-openapi-emit/path-collision'
  | 'definition-openapi-emit/invalid-content'
  | 'definition-openapi-emit/unrewritten-ref'
  | 'definition-openapi-emit/validation-error'

export type DefinitionOpenApiEmitOwnDiagnostic = {
  code: DefinitionOpenApiEmitDiagnosticCode
  severity: 'error'
  message: string
  targetName: string
  id?: CanonicalDefinitionId
  ids?: CanonicalDefinitionId[]
  path?: string
  pointer?: string
  ref?: string
  sourcePath?: string
  sourcePointer?: string
  rule?: string
}

export type DefinitionOpenApiEmitDiagnostic =
  | DefinitionTargetDiagnostic
  | DefinitionOutputNameDiagnostic
  | DefinitionOpenApiEmitOwnDiagnostic

export type DefinitionOpenApiEmitReport = {
  targetName: string
  aliases: DefinitionOutputAliasMetadata[]
  renamedAliases: DefinitionOutputAliasMetadata[]
  collisionReport: DefinitionOutputNameCollisionReportEntry[]
  rewrites: DefinitionOutputRefRewrite[]
}

export type DefinitionOpenApiEmitResult = {
  valid: boolean
  document: OasDocument
  report: DefinitionOpenApiEmitReport
  validation: ValidationResult
  diagnostics: DefinitionOpenApiEmitDiagnostic[]
}

export function emitDefinitionOpenApiDocument(
  selection: DefinitionTargetSelectionResult,
  options: DefinitionOpenApiEmitOptions = {},
): DefinitionOpenApiEmitResult {
  const diagnostics: DefinitionOpenApiEmitDiagnostic[] = [
    ...selection.diagnostics,
    ...selection.outputNameAllocation.diagnostics,
  ]

  const rewritten = rewriteDefinitionOutputRefs(toSelectedRegistry(selection), {
    outputNames: selection.outputNameAllocation.outputNames,
  })
  const paths: Record<string, OasPathItem> = {}
  const webhooks: Record<string, OasPathItem> = {}
  const pathIdsByOutputPath = new Map<string, CanonicalDefinitionId>()
  const components = createEmptyComponents()

  for (const node of rewritten.nodes) {
    if (node.kind === 'path') {
      emitPathNode(selection.target.name, node, paths, webhooks, pathIdsByOutputPath, diagnostics)
      continue
    }

    const section = componentSectionForKind(node.kind)
    if (!section) continue

    if (!isRecord(node.content)) {
      diagnostics.push(createInvalidContentDiagnostic(selection.target.name, node))
      continue
    }

    components[section][outputNameForNode(selection, node)] = node.content
  }

  const renamedAliases = selection.outputNameAllocation.aliases.filter(alias => alias.outputName !== alias.localName)
  const document: OasDocument = {
    openapi: options.openapi ?? '3.2.0',
    info: options.info ?? selection.target.info ?? {
      title: selection.target.name,
      version: '0.0.0',
    },
    servers: [...selection.target.servers],
    paths,
    webhooks,
    components,
  }

  if (options.jsonSchemaDialect !== undefined) {
    document.jsonSchemaDialect = options.jsonSchemaDialect
  }

  const tags = options.tags ?? selection.target.tags
  if (tags !== undefined) {
    document.tags = [...tags]
  }

  if (options.includeAliasMetadata !== false) {
    document[ALIAS_EXTENSION] = renamedAliases
  }

  diagnostics.push(...collectUnrewrittenRefDiagnostics(selection.target.name, document))
  const validation = validateDocument(document as Record<string, unknown>)
  diagnostics.push(...validation.errors.map(error => ({
    code: 'definition-openapi-emit/validation-error' as const,
    severity: 'error' as const,
    targetName: selection.target.name,
    path: error.path,
    rule: error.rule,
    message: error.message,
  })))

  const report: DefinitionOpenApiEmitReport = {
    targetName: selection.target.name,
    aliases: [...selection.outputNameAllocation.aliases],
    renamedAliases,
    collisionReport: [...selection.outputNameAllocation.collisionReport],
    rewrites: [...rewritten.rewrites],
  }

  return {
    valid: selection.valid && validation.valid && diagnostics.every(diagnostic => diagnostic.severity !== 'error'),
    document,
    report,
    validation,
    diagnostics,
  }
}

function toSelectedRegistry(selection: DefinitionTargetSelectionResult): DefinitionRegistry {
  return {
    valid: selection.valid,
    nodes: selection.nodes,
    nodeById: selection.nodeById,
    refEdges: selection.refEdges,
    semanticAliases: [],
    diagnostics: [],
  }
}

function emitPathNode(
  targetName: string,
  node: DefinitionRegistryNode,
  paths: Record<string, OasPathItem>,
  webhooks: Record<string, OasPathItem>,
  pathIdsByOutputPath: Map<string, CanonicalDefinitionId>,
  diagnostics: DefinitionOpenApiEmitDiagnostic[],
): void {
  if (!isRecord(node.content)) {
    diagnostics.push(createInvalidContentDiagnostic(targetName, node))
    return
  }

  const webhookName = readWebhookMetadata(node)
  if (webhookName) {
    webhooks[webhookName] = stripPathMetadata(node.content) as OasPathItem
    return
  }

  const outputPath = readPathMetadata(node)
  if (!outputPath) {
    diagnostics.push({
      code: 'definition-openapi-emit/missing-path',
      severity: 'error',
      targetName,
      id: node.id,
      sourcePath: node.sourcePath,
      sourcePointer: node.sourcePointer,
      message: `Path definition "${node.id}" must declare metadata.path or metadata.openApiPath before OpenAPI emit.`,
    })
    return
  }

  const previousId = pathIdsByOutputPath.get(outputPath)
  if (previousId !== undefined) {
    diagnostics.push({
      code: 'definition-openapi-emit/path-collision',
      severity: 'error',
      targetName,
      ids: [previousId, node.id],
      path: outputPath,
      sourcePath: node.sourcePath,
      sourcePointer: node.sourcePointer,
      message: `Target "${targetName}" emits multiple path definitions for "${outputPath}": ${previousId}, ${node.id}.`,
    })
    return
  }

  pathIdsByOutputPath.set(outputPath, node.id)
  paths[outputPath] = stripPathMetadata(node.content) as OasPathItem
}

function outputNameForNode(
  selection: DefinitionTargetSelectionResult,
  node: DefinitionRegistryNode,
): string {
  return selection.outputNameAllocation.outputNames.get(node.id) ?? node.localName
}

function componentSectionForKind(kind: string): ComponentSection | undefined {
  return (COMPONENT_SECTION_BY_KIND as Readonly<Record<string, ComponentSection | undefined>>)[kind]
}

function createEmptyComponents(): Record<ComponentSection, Record<string, unknown>> & OasComponents {
  return {
    schemas: {},
    responses: {},
    parameters: {},
    requestBodies: {},
    headers: {},
    links: {},
    callbacks: {},
    securitySchemes: {},
  }
}

function createInvalidContentDiagnostic(
  targetName: string,
  node: DefinitionRegistryNode,
): DefinitionOpenApiEmitOwnDiagnostic {
  return {
    code: 'definition-openapi-emit/invalid-content',
    severity: 'error',
    targetName,
    id: node.id,
    sourcePath: node.sourcePath,
    sourcePointer: node.sourcePointer,
    message: `Definition "${node.id}" content must be an object before OpenAPI emit.`,
  }
}

function readPathMetadata(node: DefinitionRegistryNode): string | undefined {
  return readStringProperty(node.metadata, 'path')
    ?? readStringProperty(node.metadata, 'openApiPath')
    ?? readStringProperty(node.metadata, 'openapiPath')
    ?? readStringProperty(node.content, 'path')
    ?? readStringProperty(node.content, 'openApiPath')
    ?? readStringProperty(node.content, 'openapiPath')
}

function readWebhookMetadata(node: DefinitionRegistryNode): string | undefined {
  return readStringProperty(node.metadata, 'webhook')
    ?? readStringProperty(node.metadata, 'webhookName')
    ?? readStringProperty(node.content, 'webhook')
    ?? readStringProperty(node.content, 'webhookName')
}

function stripPathMetadata(content: Record<string, unknown>): Record<string, unknown> {
  const output = { ...content }
  delete output.path
  delete output.openApiPath
  delete output.openapiPath
  delete output.webhook
  delete output.webhookName
  return output
}

function collectUnrewrittenRefDiagnostics(
  targetName: string,
  value: unknown,
  pointer = '#',
): DefinitionOpenApiEmitOwnDiagnostic[] {
  if (!value || typeof value !== 'object') return []

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectUnrewrittenRefDiagnostics(targetName, item, `${pointer}/${index}`))
  }

  const diagnostics: DefinitionOpenApiEmitOwnDiagnostic[] = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPointer = `${pointer}/${escapeJsonPointerToken(key)}`
    if (key === '$ref' && typeof child === 'string') {
      if (!child.startsWith('#/')) {
        diagnostics.push({
          code: 'definition-openapi-emit/unrewritten-ref',
          severity: 'error',
          targetName,
          pointer: childPointer,
          ref: child,
          message: `Target "${targetName}" emitted non-local or source $ref "${child}" at ${childPointer}.`,
        })
      }
    } else {
      diagnostics.push(...collectUnrewrittenRefDiagnostics(targetName, child, childPointer))
    }
  }

  return diagnostics
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const property = value[key]
  return typeof property === 'string' ? property : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
