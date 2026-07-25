import { extname } from 'node:path'
import {
  assertTypeSpecObservationInputLimits,
  type SpecProjectSourceKind,
  type TypeSpecObservationInput,
} from '../../domain/project.js'

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

export function resolveSpecObservationPaths(options: {
  sourceRoot?: string
  fragmentsDir?: string
  watchPaths?: string[]
  observationInputs?: readonly TypeSpecObservationInput[]
}): string[] {
  if (options.watchPaths !== undefined && options.observationInputs !== undefined) {
    throw new Error('watchPaths and observationInputs cannot be used together')
  }
  const explicitInputs = options.observationInputs ?? (options.watchPaths?.map(path => ({
    path,
    class: 'candidate-only' as const,
  })) ?? [])
  assertTypeSpecObservationInputLimits(explicitInputs)
  const paths = [
    resolveSpecSourceRoot(options),
    ...explicitInputs.map(input => input.path),
  ]
  const normalized = paths.map((path, index) => normalizeObservationPath(path, index))
  return [...new Set(normalized)]
}

function normalizeObservationPath(path: string, index: number): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (normalized === '' || normalized.includes('\0') || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`invalid spec observation path at index ${index}`)
  }
  return normalized
}
