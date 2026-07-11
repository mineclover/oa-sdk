/**
 * check-feature-test-matrix.ts
 *
 * Validates docs/internal/feature-test-matrix.json so feature ownership does
 * not drift away from automated tests.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

type FeatureTestMatrix = {
  version: number
  updatedAt: string
  description: string
  features: FeatureEntry[]
}

type FeatureEntry = {
  id: string
  name: string
  category: string
  package: string
  description: string
  capabilities: string[]
  testPaths: string[]
  commands: string[]
}

const root = resolve(process.cwd())
const matrixPath = join(root, 'docs/internal/feature-test-matrix.json')
const skippedDirectories = new Set([
  '.git',
  '.turbo',
  '.next',
  '.oa-cache',
  '.pnpm-store',
  'coverage',
  'dist',
  'node_modules',
  'references',
])

function main(): void {
  const matrix = readMatrix()
  const issues: string[] = []
  const ids = new Set<string>()
  const allFiles = listRepositoryFiles(root)

  if (matrix.version !== 1) {
    issues.push('matrix.version must be 1')
  }
  if (!nonEmptyString(matrix.updatedAt)) {
    issues.push('matrix.updatedAt is required')
  }
  if (!Array.isArray(matrix.features) || matrix.features.length === 0) {
    issues.push('matrix.features must be a non-empty array')
  }

  for (const feature of matrix.features ?? []) {
    validateFeature(feature, ids, allFiles, issues)
  }

  if (issues.length > 0) {
    console.error('Feature test matrix check failed:\n')
    for (const issue of issues) {
      console.error(`- ${issue}`)
    }
    process.exit(1)
  }

  const referencedPatterns = matrix.features.reduce(
    (count, feature) => count + feature.testPaths.length,
    0,
  )
  console.log(
    `Feature test matrix OK: ${matrix.features.length} features, ${referencedPatterns} test path patterns.`,
  )
}

function readMatrix(): FeatureTestMatrix {
  if (!existsSync(matrixPath)) {
    throw new Error(`Missing feature test matrix: ${relative(root, matrixPath)}`)
  }

  return JSON.parse(readFileSync(matrixPath, 'utf8')) as FeatureTestMatrix
}

function validateFeature(
  feature: FeatureEntry,
  ids: Set<string>,
  allFiles: string[],
  issues: string[],
): void {
  const label = feature.id || '<missing-id>'

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.id)) {
    issues.push(`${label}: id must be kebab-case`)
  }
  if (ids.has(feature.id)) {
    issues.push(`${label}: duplicate id`)
  }
  ids.add(feature.id)

  for (const field of ['name', 'category', 'package', 'description'] as const) {
    if (!nonEmptyString(feature[field])) {
      issues.push(`${label}: ${field} is required`)
    }
  }

  if (!Array.isArray(feature.capabilities) || feature.capabilities.length === 0) {
    issues.push(`${label}: capabilities must be non-empty`)
  } else {
    for (const [index, capability] of feature.capabilities.entries()) {
      if (!nonEmptyString(capability)) {
        issues.push(`${label}: capabilities[${index}] must be non-empty`)
      }
    }
  }

  if (!Array.isArray(feature.commands) || feature.commands.length === 0) {
    issues.push(`${label}: commands must be non-empty`)
  } else {
    for (const [index, command] of feature.commands.entries()) {
      if (!nonEmptyString(command)) {
        issues.push(`${label}: commands[${index}] must be non-empty`)
      }
    }
  }

  if (!Array.isArray(feature.testPaths) || feature.testPaths.length === 0) {
    issues.push(`${label}: testPaths must be non-empty`)
    return
  }

  for (const testPath of feature.testPaths) {
    validateTestPath(label, testPath, allFiles, issues)
  }
}

function validateTestPath(
  featureId: string,
  testPath: string,
  allFiles: string[],
  issues: string[],
): void {
  if (!nonEmptyString(testPath)) {
    issues.push(`${featureId}: testPaths contains an empty path`)
    return
  }

  if (!hasGlob(testPath)) {
    if (!existsSync(join(root, testPath))) {
      issues.push(`${featureId}: path does not exist: ${testPath}`)
    }
    return
  }

  const regex = globToRegExp(testPath)
  const matches = allFiles.filter((filePath) => regex.test(filePath))
  if (matches.length === 0) {
    issues.push(`${featureId}: glob matched no files: ${testPath}`)
  }
}

function listRepositoryFiles(directory: string): string[] {
  const files: string[] = []
  visit(directory, files)
  return files
}

function visit(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory)) {
    if (skippedDirectories.has(entry)) continue

    const absolutePath = join(directory, entry)
    const stat = statSync(absolutePath)
    if (stat.isDirectory()) {
      visit(absolutePath, files)
      continue
    }
    if (stat.isFile()) {
      files.push(toPosix(relative(root, absolutePath)))
    }
  }
}

function globToRegExp(pattern: string): RegExp {
  const placeholder = '\0GLOBSTAR\0'
  const escaped = toPosix(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, placeholder)
    .replace(/\*/g, '[^/]*')
    .replaceAll(placeholder, '.*')

  return new RegExp(`^${escaped}$`)
}

function hasGlob(value: string): boolean {
  return value.includes('*')
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function toPosix(value: string): string {
  return value.split('\\').join('/')
}

main()
