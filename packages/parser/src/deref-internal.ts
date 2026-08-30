import type { ParsedDocumentRefDiagnostic } from './types.js'
import { canonicalJsonPointerFragment, isJsonPointerFragment, resolveJsonPointer } from './json-pointer.js'
import { createSafeRecord, getOwnString } from './safe-record.js'

export type InternalDerefCycleStrategy = 'empty-schema' | 'preserve-ref'

export type InternalDerefOptions = {
  cycleStrategy?: InternalDerefCycleStrategy
  diagnostics?: ParsedDocumentRefDiagnostic[]
  onDiagnostic?: (diagnostic: ParsedDocumentRefDiagnostic) => void
}

export function derefInternalSpec<T>(spec: T, options: InternalDerefOptions = {}): T {
  return derefNode(spec, spec, [], options, '#') as T
}

export function derefInternalSpecWithDiagnostics<T>(
  spec: T,
  options: InternalDerefOptions = {},
): { document: T; diagnostics: ParsedDocumentRefDiagnostic[] } {
  const diagnostics: ParsedDocumentRefDiagnostic[] = []
  const document = derefInternalSpec(spec, {
    ...options,
    diagnostics,
    onDiagnostic(diagnostic) {
      options.diagnostics?.push(diagnostic)
      options.onDiagnostic?.(diagnostic)
    },
  })
  return { document, diagnostics }
}

function derefNode(
  node: unknown,
  root: unknown,
  stack: string[],
  options: InternalDerefOptions,
  pointer: string,
): unknown {
  if (Array.isArray(node)) {
    return node.map((item, index) => derefNode(item, root, stack, options, `${pointer}/${index}`))
  }
  if (!node || typeof node !== 'object') return node

  const obj = node as Record<string, unknown>
  const ref = getOwnString(obj, '$ref')
  if (ref && isJsonPointerFragment(ref)) {
    const refIdentity = canonicalJsonPointerFragment(ref) ?? ref
    if (stack.includes(refIdentity)) {
      emitDiagnostic(options, {
        code: 'ref-cycle',
        ref,
        message: `Cyclic $ref detected: ${ref}`,
        sourcePointer: `${pointer}/$ref`,
        pointer: ref,
      })
      return mergeRefSiblings(
        options.cycleStrategy === 'preserve-ref' ? { $ref: ref } : {},
        derefSiblingFields(obj, root, stack, options, pointer),
      )
    }
    const target = resolveJsonPointer(root, ref)
    if (target === undefined) {
      emitDiagnostic(options, {
        code: 'ref-not-found',
        ref,
        message: `Reference target was not found: ${ref}`,
        sourcePointer: `${pointer}/$ref`,
        pointer: ref,
      })
      return derefObject(obj, root, stack, options, pointer)
    }
    const resolved = derefNode(target, root, [...stack, refIdentity], options, ref)
    return mergeRefSiblings(resolved, derefSiblingFields(obj, root, stack, options, pointer))
  }

  if (ref && !ref.startsWith('#')) {
    emitDiagnostic(options, {
      code: 'external-ref-unresolved',
      ref,
      message: `External $ref requires a loader and remains unresolved: ${ref}`,
      sourcePointer: `${pointer}/$ref`,
    })
  } else if (ref) {
    emitDiagnostic(options, {
      code: 'unsupported-ref',
      ref,
      message: `Unsupported internal $ref format: ${ref}`,
      sourcePointer: `${pointer}/$ref`,
    })
  }

  return derefObject(obj, root, stack, options, pointer)
}

function derefObject(
  obj: Record<string, unknown>,
  root: unknown,
  stack: string[],
  options: InternalDerefOptions,
  pointer: string,
): Record<string, unknown> {
  const result = createSafeRecord<unknown>()
  for (const [key, value] of Object.entries(obj)) {
    result[key] = derefNode(value, root, stack, options, `${pointer}/${escapeJsonPointer(key)}`)
  }
  return result
}

function derefSiblingFields(
  obj: Record<string, unknown>,
  root: unknown,
  stack: string[],
  options: InternalDerefOptions,
  pointer: string,
): Record<string, unknown> {
  const siblings = createSafeRecord<unknown>()
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$ref') continue
    siblings[key] = derefNode(value, root, stack, options, `${pointer}/${escapeJsonPointer(key)}`)
  }
  return siblings
}

function emitDiagnostic(
  options: InternalDerefOptions,
  diagnostic: ParsedDocumentRefDiagnostic,
): void {
  options.diagnostics?.push(diagnostic)
  options.onDiagnostic?.(diagnostic)
}

function escapeJsonPointer(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
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
