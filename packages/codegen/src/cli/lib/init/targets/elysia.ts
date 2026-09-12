import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type {
  TargetProfile,
  TargetDetectionResult,
  TargetGenerateOptions,
  RecommendedDependencies,
} from '../types.js'

export class ElysiaTargetProfile implements TargetProfile {
  readonly id = 'elysia' as const
  readonly displayName = 'Elysia (Bun)'
  readonly description = 'Ergonomic, fast Bun-native framework with zero-copy context'
  readonly defaultRuntime = 'bun' as const

  async detect(cwd: string): Promise<TargetDetectionResult> {
    try {
      const pkgPath = path.join(cwd, 'package.json')
      const raw = await fs.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      const hasBunLock =
        (await fs.access(path.join(cwd, 'bun.lockb')).then(() => true).catch(() => false)) ||
        (await fs.access(path.join(cwd, 'bun.lock')).then(() => true).catch(() => false))

      if (deps['elysia'] || hasBunLock) {
        return {
          confidence: 0.95,
          matchedMarkers: ['elysia dependency or bun.lockb'],
          detectedRuntime: 'bun',
          details: { hasElysiaDep: !!deps['elysia'], hasBunLock },
        }
      }
    } catch {
      // ignore
    }

    return { confidence: 0.0, matchedMarkers: [], detectedRuntime: 'bun' }
  }

  async generateConfig(options: TargetGenerateOptions): Promise<string> {
    const schemaEntry = options.detectedSchema?.filePath ?? 'openapi.yaml'
    return `import { defineConfig } from '@oa-sdk/codegen'

export default defineConfig({
  rootDir: '.',
  specs: [
    {
      id: 'elysia-api',
      schemaEntry: '${schemaEntry}',
      outDir: './src/generated',
      target: 'elysia',
    },
  ],
})
`
  }

  getRecommendedScripts(_options: TargetGenerateOptions): Record<string, string> {
    // Bun native scripts: strictly ZERO tsx, ZERO nodemon
    return {
      'dev': 'bun --watch src/index.ts',
      'generate:router': 'bun x oa-gen generate --target elysia',
      'mock': 'bun x oa-gen mock --watch',
    }
  }

  getRecommendedDependencies(_options: TargetGenerateOptions): RecommendedDependencies {
    // Bun native devDependencies: strictly @types/bun, NO @types/node or tsx!
    return {
      dependencies: {
        'elysia': '^1.0.0',
      },
      devDependencies: {
        '@oa-sdk/codegen': 'workspace:*',
        '@oa-sdk/router': 'workspace:*',
        '@types/bun': 'latest',
      },
    }
  }
}
