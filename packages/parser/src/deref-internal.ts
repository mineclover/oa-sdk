import type { ParsedDocumentRefDiagnostic } from './types.js'
import { canonicalJsonPointerFragment, escapeJsonPointerToken, isJsonPointerFragment, resolveJsonPointer } from './json-pointer.js'
import { createSafeRecord, getOwnString } from './safe-record.js'
import { RefExpansionMemo } from './ref-expansion-memo.js'
import { stepSchemaPath, type SchemaPathContext } from './recursion-guard.js'

export type InternalDerefCycleStrategy = 'empty-schema' | 'preserve-ref'

export type InternalDerefOptions = {
  cycleStrategy?: InternalDerefCycleStrategy
  diagnostics?: ParsedDocumentRefDiagnostic[]
  onDiagnostic?: (diagnostic: ParsedDocumentRefDiagnostic) => void
  /**
   * 유효한 재귀 스키마의 순환 지점 ref. 진단 없이 cycleStrategy로 끊긴다.
   * 같은 ref가 여러 번 보고될 수 있으며, 서로 다른 ref는 최소 한 번 보고된다.
   */
  onRecursiveRef?: (ref: string) => void
}

export function derefInternalSpec<T>(spec: T, options: InternalDerefOptions = {}): T {
  const context: DerefContext = {
    root: spec,
    options,
    memo: new RefExpansionMemo<ParsedDocumentRefDiagnostic>(),
    pathContext: 'keyword',
    descents: 0,
    descentsAtEntry: new Map<string, number>(),
  }
  return derefNode(spec, context, '#') as T
}

export function derefInternalSpecWithDiagnostics<T>(
  spec: T,
  options: InternalDerefOptions = {},
): { document: T; diagnostics: ParsedDocumentRefDiagnostic[]; recursiveRefs: string[] } {
  const diagnostics: ParsedDocumentRefDiagnostic[] = []
  const recursiveRefs = new Set<string>()
  const document = derefInternalSpec(spec, {
    ...options,
    diagnostics,
    onDiagnostic(diagnostic) {
      options.diagnostics?.push(diagnostic)
      options.onDiagnostic?.(diagnostic)
    },
    onRecursiveRef(ref) {
      recursiveRefs.add(ref)
      options.onRecursiveRef?.(ref)
    },
  })
  return { document, diagnostics, recursiveRefs: [...recursiveRefs] }
}

/**
 * 같은 대상의 전개 결과는 RefExpansionMemo로 공유한다. 대상 내부의 진단 pointer는
 * 사용처가 아니라 ref pointer 기준이므로 재방출해도 위치 정보가 동일하다.
 */
type DerefContext = {
  root: unknown
  options: InternalDerefOptions
  memo: RefExpansionMemo<ParsedDocumentRefDiagnostic>
  /** 현재 노드의 키를 해석할 문맥과 지난 instance 하위 키워드 수 (recursion-guard) */
  pathContext: SchemaPathContext
  descents: number
  descentsAtEntry: Map<string, number>
}

function derefNode(node: unknown, context: DerefContext, pointer: string): unknown {
  if (Array.isArray(node)) {
    return node.map((item, index) => derefNode(item, context, `${pointer}/${index}`))
  }
  if (!node || typeof node !== 'object') return node

  const obj = node as Record<string, unknown>
  const ref = getOwnString(obj, '$ref')
  if (ref && isJsonPointerFragment(ref)) {
    const refIdentity = canonicalJsonPointerFragment(ref) ?? ref
    if (context.memo.stackView.has(refIdentity)) {
      context.memo.noteCycle(refIdentity)
      const entry = context.descentsAtEntry.get(refIdentity)
      if (entry !== undefined && context.descents > entry) {
        context.options.onRecursiveRef?.(ref)
      } else {
        emitDiagnostic(context, {
          code: 'ref-cycle',
          ref,
          message: `Cyclic $ref detected: ${ref}`,
          sourcePointer: `${pointer}/$ref`,
          pointer: ref,
        })
      }
      return mergeRefSiblings(
        context.options.cycleStrategy === 'preserve-ref' ? { $ref: ref } : {},
        derefSiblingFields(obj, context, pointer),
      )
    }
    const target = resolveJsonPointer(context.root, ref)
    if (target === undefined) {
      emitDiagnostic(context, {
        code: 'ref-not-found',
        ref,
        message: `Reference target was not found: ${ref}`,
        sourcePointer: `${pointer}/$ref`,
        pointer: ref,
      })
      return derefObject(obj, context, pointer)
    }
    const resolved = context.memo.expand(
      refIdentity,
      () => derefRefTarget(target, refIdentity, context, ref),
      diagnostic => emitDiagnostic(context, diagnostic),
    )
    return mergeRefSiblings(resolved, derefSiblingFields(obj, context, pointer))
  }

  if (ref && !ref.startsWith('#')) {
    emitDiagnostic(context, {
      code: 'external-ref-unresolved',
      ref,
      message: `External $ref requires a loader and remains unresolved: ${ref}`,
      sourcePointer: `${pointer}/$ref`,
    })
  } else if (ref) {
    emitDiagnostic(context, {
      code: 'unsupported-ref',
      ref,
      message: `Unsupported internal $ref format: ${ref}`,
      sourcePointer: `${pointer}/$ref`,
    })
  }

  return derefObject(obj, context, pointer)
}

/** ref 대상은 독립된 스키마 루트이므로 키워드 문맥에서 전개하고 진입 깊이를 기록한다. */
function derefRefTarget(
  target: unknown,
  refIdentity: string,
  context: DerefContext,
  pointer: string,
): unknown {
  const parentContext = context.pathContext
  context.pathContext = 'keyword'
  context.descentsAtEntry.set(refIdentity, context.descents)
  try {
    return derefNode(target, context, pointer)
  } finally {
    context.pathContext = parentContext
    context.descentsAtEntry.delete(refIdentity)
  }
}

/** `key`의 값을 전개한다. 키 문맥과 instance 하위 이동 수를 경로에 맞춰 유지한다. */
function derefUnderKey(key: string, value: unknown, context: DerefContext, pointer: string): unknown {
  const parentContext = context.pathContext
  const step = stepSchemaPath(parentContext, key)
  context.pathContext = step.context
  if (step.descends) context.descents += 1
  try {
    return derefNode(value, context, `${pointer}/${escapeJsonPointerToken(key)}`)
  } finally {
    context.pathContext = parentContext
    if (step.descends) context.descents -= 1
  }
}

function derefObject(
  obj: Record<string, unknown>,
  context: DerefContext,
  pointer: string,
): Record<string, unknown> {
  const result = createSafeRecord<unknown>()
  for (const [key, value] of Object.entries(obj)) {
    result[key] = derefUnderKey(key, value, context, pointer)
  }
  return result
}

function derefSiblingFields(
  obj: Record<string, unknown>,
  context: DerefContext,
  pointer: string,
): Record<string, unknown> {
  const siblings = createSafeRecord<unknown>()
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$ref') continue
    siblings[key] = derefUnderKey(key, value, context, pointer)
  }
  return siblings
}

function emitDiagnostic(
  context: DerefContext,
  diagnostic: ParsedDocumentRefDiagnostic,
): void {
  context.memo.recordDiagnostic(diagnostic)
  context.options.diagnostics?.push(diagnostic)
  context.options.onDiagnostic?.(diagnostic)
}

function mergeRefSiblings(resolved: unknown, siblings: Record<string, unknown>): unknown {
  if (Object.keys(siblings).length === 0) return resolved
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) return siblings

  const base = resolved as Record<string, unknown>
  const result: Record<string, unknown> = { ...base, ...siblings }

  for (const key of ['properties', 'patternProperties', 'dependentSchemas', 'dependentRequired', '$defs']) {
    const baseMap = asRecord(base[key])
    const siblingMap = asRecord(siblings[key])
    if (baseMap && siblingMap) result[key] = { ...baseMap, ...siblingMap }
  }

  if (Array.isArray(base['required']) && Array.isArray(siblings['required'])) {
    result['required'] = [...new Set([...base['required'], ...siblings['required']])]
  }

  return result
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
