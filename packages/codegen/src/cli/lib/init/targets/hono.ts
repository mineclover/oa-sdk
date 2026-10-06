import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type {
  TargetProfile,
  TargetDetectionResult,
  TargetGenerateOptions,
  RecommendedDependencies,
  TargetRuntime,
} from '../types.js'

export class HonoTargetProfile implements TargetProfile {
  readonly id = 'hono' as const
  readonly displayName = 'Hono'
  readonly description = 'Ultrafast multi-runtime web framework'
  readonly defaultRuntime = 'node' as const

  async detect(cwd: string): Promise<TargetDetectionResult> {
    try {
      const pkgPath = path.join(cwd, 'package.json')
      const raw = await fs.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      const hasBunLock =
        (await fs.access(path.join(cwd, 'bun.lockb')).then(() => true).catch(() => false)) ||
        (await fs.access(path.join(cwd, 'bun.lock')).then(() => true).catch(() => false))

      const detectedRuntime: TargetRuntime = hasBunLock ? 'bun' : 'node'

      if (deps['hono']) {
        return {
          confidence: 0.9,
          matchedMarkers: ['hono dependency'],
          detectedRuntime,
          details: { version: deps['hono'], runtime: detectedRuntime },
        }
      }
    } catch {
      // ignore
    }

    return { confidence: 0.0, matchedMarkers: [], detectedRuntime: 'node' }
  }

  async generateConfig(options: TargetGenerateOptions): Promise<string> {
    const schemaEntry = options.detectedSchema?.filePath ?? 'openapi.yaml'
    return `import { defineConfig } from '@oa-sdk/codegen'

export default defineConfig({
  rootDir: '.',
  specs: [
    {
      id: 'hono-api',
      schemaEntry: '${schemaEntry}',
      outDir: './src/generated',
      target: 'hono',
    },
  ],
})
`
  }

  getRecommendedScripts(options: TargetGenerateOptions): Record<string, string> {
    if (options.runtime === 'bun') {
      return {
        'dev': 'bun --watch src/index.ts',
        'generate': 'bun x oa-gen generate',
        'mock': 'bun x oa-gen mock --watch',
      }
    }
    return {
      'dev': 'tsx watch src/index.ts',
      'generate': 'oa-gen generate',
      'mock': 'oa-gen mock --watch',
    }
  }

  getRecommendedDependencies(options: TargetGenerateOptions): RecommendedDependencies {
    if (options.runtime === 'bun') {
      return {
        dependencies: { 'hono': '^4.0.0' },
        devDependencies: {
          '@types/bun': 'latest',
        },
        oaSdkDevDependencies: ['@oa-sdk/codegen', '@oa-sdk/router'],
      }
    }
    return {
      dependencies: { 'hono': '^4.0.0' },
      devDependencies: {
        'tsx': '^4.7.0',
        '@types/node': '^20.0.0',
      },
      oaSdkDevDependencies: ['@oa-sdk/codegen', '@oa-sdk/router'],
    }
  }
}
