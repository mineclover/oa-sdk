import {
  LineCounter,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  parseDocument as parseYamlDocument,
  type Node,
  type Range,
} from 'yaml'

export type SourceLocationSyntax = 'auto' | 'yaml' | 'json'

export type SourceLocation = {
  filePath?: string
  pointer: string
  line: number
  column: number
}

export type SourceLocationIndexOptions = {
  filePath?: string
  syntax?: SourceLocationSyntax
}

export interface SourceLocationIndex {
  readonly filePath?: string
  lookup(pointer: string): SourceLocation | undefined
  entries(): SourceLocation[]
}

export function createSourceLocationIndex(
  raw: string,
  options: SourceLocationIndexOptions = {},
): SourceLocationIndex {
  const syntax = resolveSyntax(options)
  if (syntax === 'json') return createEmptySourceLocationIndex(options.filePath)
  return createYamlSourceLocationIndex(raw, options)
}

export function createYamlSourceLocationIndex(
  raw: string,
  options: Omit<SourceLocationIndexOptions, 'syntax'> = {},
): SourceLocationIndex {
  const lineCounter = new LineCounter()
  const document = parseYamlDocument(raw, { lineCounter })
  const locations = new Map<string, SourceLocation>()

  const addLocation = (pointer: string, range: Range | null | undefined): void => {
    if (!range) return
    const normalizedPointer = normalizePointer(pointer)
    if (locations.has(normalizedPointer)) return
    const pos = lineCounter.linePos(range[0])
    if (pos.line <= 0) return
    locations.set(normalizedPointer, {
      ...(options.filePath ? { filePath: options.filePath } : {}),
      pointer: normalizedPointer,
      line: pos.line,
      column: pos.col,
    })
  }

  if (document.contents) visitNode(document.contents, '#', addLocation)
  else addLocation('#', document.range)

  return {
    ...(options.filePath ? { filePath: options.filePath } : {}),
    lookup(pointer: string): SourceLocation | undefined {
      return locations.get(normalizePointer(pointer))
    },
    entries(): SourceLocation[] {
      return [...locations.values()].sort((a, b) => a.pointer.localeCompare(b.pointer))
    },
  }
}

function createEmptySourceLocationIndex(filePath: string | undefined): SourceLocationIndex {
  return {
    ...(filePath ? { filePath } : {}),
    lookup(): SourceLocation | undefined {
      return undefined
    },
    entries(): SourceLocation[] {
      return []
    },
  }
}

function visitNode(
  node: Node,
  pointer: string,
  addLocation: (pointer: string, range: Range | null | undefined) => void,
): void {
  addLocation(pointer, node.range)

  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isPair(pair)) continue
      const key = scalarKey(pair.key)
      if (key === undefined) continue
      const childPointer = appendPointer(pointer, key)
      if (isNode(pair.key)) addLocation(childPointer, pair.key.range)
      if (isNode(pair.value)) visitNode(pair.value, childPointer, addLocation)
    }
    return
  }

  if (isSeq(node)) {
    node.items.forEach((item, index) => {
      if (!isNode(item)) return
      const childPointer = appendPointer(pointer, String(index))
      addLocation(childPointer, item.range)
      visitNode(item, childPointer, addLocation)
    })
  }
}

function scalarKey(node: unknown): string | undefined {
  if (!isScalar(node)) return undefined
  const value = node.value
  if (value === undefined || value === null) return undefined
  return String(value)
}

function appendPointer(pointer: string, segment: string): string {
  const escaped = segment.replace(/~/g, '~0').replace(/\//g, '~1')
  return pointer === '#' ? `#/${escaped}` : `${pointer}/${escaped}`
}

function normalizePointer(pointer: string): string {
  if (pointer === '' || pointer === '#' || pointer === '/') return '#'
  if (pointer.startsWith('#/')) return pointer
  if (pointer.startsWith('/')) return `#${pointer}`
  return pointer
}

function resolveSyntax(options: SourceLocationIndexOptions): Exclude<SourceLocationSyntax, 'auto'> {
  if (options.syntax && options.syntax !== 'auto') return options.syntax
  return options.filePath?.endsWith('.json') ? 'json' : 'yaml'
}
