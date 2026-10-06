import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type {
  TargetProfile,
  TargetDetectionResult,
  TargetGenerateOptions,
  RecommendedDependencies,
} from '../types.js'

export class FastifyTargetProfile implements TargetProfile {
  readonly id = 'fastify' as const
  readonly displayName = 'Fastify'
  readonly description = 'High-performance Node.js framework with JIT schema acceleration'
  readonly defaultRuntime = 'node' as const

  async detect(cwd: string): Promise<TargetDetectionResult> {
    try {
      const pkgPath = path.join(cwd, 'package.json')
      const raw = await fs.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps['fastify']) {
        return {
          confidence: 0.95,
          matchedMarkers: ['fastify dependency'],
          detectedRuntime: 'node',
          details: { version: deps['fastify'] },
        }
      }
    } catch {
      // package.json does not exist or unparseable
    }

    try {
      const hasFastifyConfig =
        (await fs.access(path.join(cwd, 'fastify.config.ts')).then(() => true).catch(() => false)) ||
        (await fs.access(path.join(cwd, 'fastify.config.js')).then(() => true).catch(() => false))
      if (hasFastifyConfig) {
        return {
          confidence: 0.9,
          matchedMarkers: ['fastify.config file'],
          detectedRuntime: 'node',
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
      id: 'fastify-api',
      schemaEntry: '${schemaEntry}',
      outDir: './src/generated',
      target: 'fastify',
    },
  ],
})
`
  }

  getRecommendedScripts(_options: TargetGenerateOptions): Record<string, string> {
    return {
      'dev': 'tsx watch src/server.ts',
      'build': 'tsc',
      'generate': 'oa-gen generate',
      'mock': 'oa-gen mock --watch',
    }
  }

  getRecommendedDependencies(_options: TargetGenerateOptions): RecommendedDependencies {
    return {
      dependencies: {
        'fastify': '^4.26.0',
      },
      devDependencies: {
        'tsx': '^4.7.0',
        'typescript': '^5.4.0',
        '@types/node': '^20.0.0',
      },
      oaSdkDevDependencies: ['@oa-sdk/codegen', '@oa-sdk/router'],
    }
  }
}
