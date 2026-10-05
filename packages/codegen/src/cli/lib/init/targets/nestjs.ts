import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type {
  TargetProfile,
  TargetDetectionResult,
  TargetGenerateOptions,
  RecommendedDependencies,
} from '../types.js'

export class NestJSTargetProfile implements TargetProfile {
  readonly id = 'nestjs' as const
  readonly displayName = 'NestJS'
  readonly description = 'Progressive Node.js framework with modular architecture'
  readonly defaultRuntime = 'node' as const

  async detect(cwd: string): Promise<TargetDetectionResult> {
    try {
      const pkgPath = path.join(cwd, 'package.json')
      const raw = await fs.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      const hasNestCli = await fs.access(path.join(cwd, 'nest-cli.json')).then(() => true).catch(() => false)

      if (deps['@nestjs/core'] || deps['@nestjs/common'] || hasNestCli) {
        return {
          confidence: 0.95,
          matchedMarkers: ['@nestjs/core dependency or nest-cli.json'],
          detectedRuntime: 'node',
          details: { hasNestCore: !!deps['@nestjs/core'], hasNestCli },
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
      id: 'nest-api',
      schemaEntry: '${schemaEntry}',
      outDir: './src/generated',
      target: 'generic',
    },
  ],
})
`
  }

  getRecommendedScripts(_options: TargetGenerateOptions): Record<string, string> {
    return {
      'start:dev': 'nest start --watch',
      'generate:contract': 'oa-gen generate --target generic',
      'mock': 'oa-gen mock --watch',
    }
  }

  getRecommendedDependencies(_options: TargetGenerateOptions): RecommendedDependencies {
    return {
      devDependencies: {},
      oaSdkDevDependencies: ['@oa-sdk/codegen', '@oa-sdk/router'],
    }
  }
}
