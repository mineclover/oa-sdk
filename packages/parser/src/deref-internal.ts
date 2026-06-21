export type InternalDerefCycleStrategy = 'empty-schema' | 'preserve-ref'

export type InternalDerefOptions = {
  cycleStrategy?: InternalDerefCycleStrategy
}

export function derefInternalSpec<T>(spec: T, options: InternalDerefOptions = {}): T {
  return derefNode(spec, spec, [], options) as T
}

function derefNode(
  node: unknown,
  root: unknown,
  stack: string[],
  options: InternalDerefOptions,
): unknown {
  if (Array.isArray(node)) return node.map(item => derefNode(item, root, stack, options))
  if (!node || typeof node !== 'object') return node

  const obj = node as Record<string, unknown>
  const ref = typeof obj['$ref'] === 'string' ? obj['$ref'] : undefined
  if (ref?.startsWith('#/')) {
    if (stack.includes(ref)) {
      return mergeRefSiblings(
        options.cycleStrategy === 'preserve-ref' ? { $ref: ref } : {},
        derefSiblingFields(obj, root, stack, options),
      )
    }
    const target = resolveInternalPointer(root, ref)
    if (target === undefined) return derefObject(obj, root, stack, options)
    const resolved = derefNode(target, root, [...stack, ref], options)
    return mergeRefSiblings(resolved, derefSiblingFields(obj, root, stack, options))
  }

  return derefObject(obj, root, stack, options)
}

function derefObject(
  obj: Record<string, unknown>,
  root: unknown,
  stack: string[],
  options: InternalDerefOptions,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key] = derefNode(value, root, stack, options)
  }
  return result
}

function derefSiblingFields(
  obj: Record<string, unknown>,
  root: unknown,
  stack: string[],
  options: InternalDerefOptions,
): Record<string, unknown> {
  const siblings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$ref') continue
    siblings[key] = derefNode(value, root, stack, options)
  }
  return siblings
}

function resolveInternalPointer(root: unknown, ref: string): unknown {
  const segments = ref
    .slice(2)
    .split('/')
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))

  let current = root
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
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
