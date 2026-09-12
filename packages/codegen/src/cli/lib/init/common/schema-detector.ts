import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DetectedSchemaItem } from '../types.js'

export interface SchemaDetectorOptions {
  maxDepth?: number
  ignoredDirs?: string[]
}

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.turbo',
  '.next',
  '.cache',
  '.oa-cache',
  '.gemini',
  'coverage',
  '.idea',
  '.vscode',
])

/**
 * Recursively inspects a directory tree starting at cwd to identify OpenAPI/TypeSpec
 * schemas and TypeScript sources with @oaOperation JSDoc annotations.
 */
export async function detectSchemas(
  cwd: string,
  options: SchemaDetectorOptions = {},
): Promise<DetectedSchemaItem[]> {
  const maxDepth = options.maxDepth ?? 5
  const ignored = options.ignoredDirs ? new Set(options.ignoredDirs) : DEFAULT_IGNORED_DIRS
  const items: DetectedSchemaItem[] = []

  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > maxDepth) return
    let entries: string[] = []
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      if (ignored.has(entry)) continue
      const fullPath = path.join(dir, entry)
      const relPath = path.relative(cwd, fullPath)

      try {
        const stat = await fs.stat(fullPath)
        if (stat.isDirectory()) {
          await walk(fullPath, depth + 1)
        } else if (stat.isFile()) {
          const lower = entry.toLowerCase()

          if (lower.endsWith('.tsp')) {
            const isMain = lower === 'main.tsp'
            const confidence = isMain ? 1.0 : 0.8
            items.push({
              type: 'typespec',
              kind: 'typespec',
              filePath: relPath,
              path: fullPath,
              relativePath: relPath,
              confidence,
              score: Math.round(confidence * 100),
              description: `TypeSpec specification: ${relPath}`,
            })
          } else if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
            if (
              lower.includes('openapi') ||
              lower.includes('spec') ||
              lower.includes('swagger')
            ) {
              const isRootSpec = lower === 'openapi.yaml' || lower === 'openapi.yml' || lower === 'spec.yaml'
              const confidence = isRootSpec ? 0.95 : 0.85
              items.push({
                type: 'openapi-yaml',
                kind: 'openapi-yaml',
                filePath: relPath,
                path: fullPath,
                relativePath: relPath,
                confidence,
                score: Math.round(confidence * 100),
                description: `OpenAPI YAML specification: ${relPath}`,
              })
            }
          } else if (lower.endsWith('.json')) {
            // Exclude common non-spec JSON files
            if (
              !lower.includes('package.json') &&
              !lower.includes('tsconfig') &&
              !lower.includes('turbo') &&
              !lower.includes('nest-cli') &&
              (lower.includes('openapi') || lower.includes('swagger') || lower.includes('spec'))
            ) {
              const isRootSpec = lower === 'openapi.json' || lower === 'swagger.json'
              const confidence = isRootSpec ? 0.9 : 0.8
              items.push({
                type: 'openapi-json',
                kind: 'openapi-json',
                filePath: relPath,
                path: fullPath,
                relativePath: relPath,
                confidence,
                score: Math.round(confidence * 100),
                description: `OpenAPI JSON specification: ${relPath}`,
              })
            }
          } else if ((lower.endsWith('.ts') || lower.endsWith('.tsx')) && !lower.endsWith('.d.ts')) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8')
              if (content.includes('@oaOperation')) {
                const opMatches = content.match(/@oaOperation/g)
                const operationsCount = opMatches ? opMatches.length : 1
                items.push({
                  type: 'jsdoc-operations',
                  kind: 'oa-operation',
                  filePath: relPath,
                  path: fullPath,
                  relativePath: relPath,
                  confidence: 0.75,
                  score: 75,
                  operationsCount,
                  description: `TypeScript source with @oaOperation: ${relPath} (${operationsCount} operation(s))`,
                })
              }
            } catch {
              // file unreadable, ignore
            }
          }
        }
      } catch {
        // ignore stat errors
      }
    }
  }

  await walk(cwd)
  items.sort((a, b) => b.confidence - a.confidence)
  return items
}
