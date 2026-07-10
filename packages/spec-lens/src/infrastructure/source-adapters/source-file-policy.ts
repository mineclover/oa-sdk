import { extname } from 'node:path'
import type { SpecProjectSourceKind } from '../../domain/project.js'

const DEFINITION_BUILDER_EXTENSIONS = new Set(['.json', '.yaml', '.yml'])
const TYPESPEC_BUNDLE_EXTENSIONS = new Set(['.json', '.tsp', '.yaml', '.yml'])

export function isSpecProjectFile(
  filePath: string,
  sourceKind: SpecProjectSourceKind = 'definition-builder',
): boolean {
  const extensions = sourceKind === 'typespec-bundle'
    ? TYPESPEC_BUNDLE_EXTENSIONS
    : DEFINITION_BUILDER_EXTENSIONS
  return extensions.has(extname(filePath).toLowerCase())
}

export function resolveSpecSourceRoot(options: {
  sourceRoot?: string
  fragmentsDir?: string
}): string {
  const root = options.sourceRoot ?? options.fragmentsDir
  if (root === undefined || root.trim() === '') {
    throw new Error('sourceRoot is required')
  }
  return root
}
