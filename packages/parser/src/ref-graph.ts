import type { OasDocument } from './oas32-types.js'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

export type RefKind = 'internal' | 'external' | 'unsupported'

export type RefGraphDiagnosticCode =
  | 'ref-cycle'
  | 'ref-not-found'
  | 'external-ref-read-failed'
  | 'external-ref-pointer-not-found'
  | 'unsupported-ref'

export type RefGraphDiagnostic = {
  code: RefGraphDiagnosticCode
  ref: string
  message: string
  filePath?: string
  pointer?: string
}

export type RefGraphNode = {
  ref: string
  kind: RefKind
  sourcePointer: string
  resolved: boolean
  filePath?: string
  pointer?: string
  target?: unknown
}

export type RefGraph = {
  nodes: RefGraphNode[]
  diagnostics: RefGraphDiagnostic[]
}

export type RefGraphOptions = {
  basePath?: string
}

type ExternalDocument = {
  path: string
  document: unknown
}

export function resolveRefGraph(spec: OasDocument | Record<string, unknown>, options: RefGraphOptions = {}): RefGraph {
  const nodes: RefGraphNode[] = []
  const diagnostics: RefGraphDiagnostic[] = []
  const fileCache = new Map<string, ExternalDocument>()
  const entryPath = options.basePath

  visitDocument(spec, '#', options.basePath, [], spec)
  return { nodes, diagnostics }

  function visitDocument(
    document: unknown,
    sourcePointer: string,
    basePath: string | undefined,
    stack: string[],
    refRoot: unknown,
  ): void {
    collectRefs(document, sourcePointer, (ref, refPointer) => {
      resolveRef(ref, refPointer, refRoot, basePath, stack)
    })
  }

  function resolveRef(ref: string, sourcePointer: string, root: unknown, basePath: string | undefined, stack: string[]): void {
    if (ref === '#' || ref.startsWith('#/')) {
      const currentFilePath = basePath && basePath !== entryPath ? basePath : undefined
      const nodeKey = `<root>${ref}`
      if (stack.includes(nodeKey)) {
        diagnostics.push({ code: 'ref-cycle', ref, ...(currentFilePath ? { filePath: currentFilePath } : {}), pointer: ref, message: `순환 $ref 감지: ${ref}` })
        nodes.push({ ref, kind: 'internal', sourcePointer, ...(currentFilePath ? { filePath: currentFilePath } : {}), pointer: ref, resolved: false })
        return
      }

      const target = resolvePointer(ref, root)
      const resolved = target !== undefined
      nodes.push({ ref, kind: 'internal', sourcePointer, ...(currentFilePath ? { filePath: currentFilePath } : {}), pointer: ref, resolved, ...(resolved ? { target } : {}) })
      if (!resolved) {
        diagnostics.push({ code: 'ref-not-found', ref, ...(currentFilePath ? { filePath: currentFilePath } : {}), pointer: ref, message: `참조 대상을 찾을 수 없습니다: ${ref}` })
        return
      }
      visitDocument(target, ref, basePath, [...stack, nodeKey], root)
      return
    }

    if (isRelativeRef(ref) && basePath) {
      const [filePart, rawPointer] = ref.split('#')
      if (!filePart || !rawPointer) {
        diagnostics.push({ code: 'unsupported-ref', ref, message: `지원하지 않는 외부 $ref 형식: ${ref}` })
        nodes.push({ ref, kind: 'external', sourcePointer, resolved: false })
        return
      }

      const filePath = resolve(dirname(basePath), filePart)
      const pointer = `#${rawPointer}`
      const nodeKey = `${filePath}${pointer}`
      if (stack.includes(nodeKey)) {
        diagnostics.push({ code: 'ref-cycle', ref, filePath, pointer, message: `순환 외부 $ref 감지: ${ref}` })
        nodes.push({ ref, kind: 'external', sourcePointer, filePath, pointer, resolved: false })
        return
      }

      let external = fileCache.get(filePath)
      if (!external) {
        try {
          external = { path: filePath, document: parseExternalRefFile(filePath) }
          fileCache.set(filePath, external)
        } catch (err) {
          diagnostics.push({
            code: 'external-ref-read-failed',
            ref,
            filePath,
            pointer,
            message: err instanceof Error ? err.message : String(err),
          })
          nodes.push({ ref, kind: 'external', sourcePointer, filePath, pointer, resolved: false })
          return
        }
      }

      const target = resolvePointer(pointer, external.document)
      const resolved = target !== undefined
      nodes.push({ ref, kind: 'external', sourcePointer, filePath, pointer, resolved, ...(resolved ? { target } : {}) })
      if (!resolved) {
        diagnostics.push({ code: 'external-ref-pointer-not-found', ref, filePath, pointer, message: `외부 파일에서 참조 대상을 찾을 수 없습니다: ${ref}` })
        return
      }
      visitDocument(target, pointer, filePath, [...stack, nodeKey], external.document)
      return
    }

    diagnostics.push({ code: 'unsupported-ref', ref, message: `지원하지 않는 $ref 형식: ${ref}` })
    nodes.push({ ref, kind: 'unsupported', sourcePointer, resolved: false })
  }
}

export function collectRefs(node: unknown, sourcePointer: string, onRef: (ref: string, sourcePointer: string) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectRefs(item, `${sourcePointer}/${index}`, onRef))
    return
  }

  const obj = node as Record<string, unknown>
  if (typeof obj['$ref'] === 'string') {
    onRef(obj['$ref'], `${sourcePointer}/$ref`)
  }

  for (const [key, value] of Object.entries(obj)) {
    collectRefs(value, `${sourcePointer}/${escapePointer(key)}`, onRef)
  }
}

export function isRelativeRef(ref: string): boolean {
  return ref.startsWith('./') || ref.startsWith('../')
}

export function resolvePointer(ref: string, root: unknown): unknown | undefined {
  if (ref === '#') return root
  const parts = ref
    .slice(2)
    .split('/')
    .map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))

  let current: unknown = root
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined
    const obj = current as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(obj, part)) return undefined
    current = obj[part]
  }
  return current
}

function parseExternalRefFile(path: string): unknown {
  const raw = readFileSync(path, 'utf-8')
  if (path.endsWith('.json')) return JSON.parse(raw)
  return parseYaml(raw)
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}
