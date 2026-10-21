import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type {
  TargetProfile,
  TargetDetectionResult,
  TargetGenerateOptions,
  RecommendedDependencies,
} from '../types.js'

export class ExpressTargetProfile implements TargetProfile {
  readonly id = 'express' as const
  readonly displayName = 'Express'
  readonly description = 'Fast, unopinionated, minimalist web framework for Node.js'
  readonly defaultRuntime = 'node' as const

  async detect(cwd: string): Promise<TargetDetectionResult> {
    try {
      const pkgPath = path.join(cwd, 'package.json')
      const raw = await fs.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps['express']) {
        return {
          confidence: 0.85,
          matchedMarkers: ['express dependency'],
          detectedRuntime: 'node',
          details: { version: deps['express'] },
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
      id: 'express-api',
      schemaEntry: '${schemaEntry}',
      outDir: './src/generated',
      target: 'express',
    },
  ],
})
`
  }

  getRecommendedScripts(_options: TargetGenerateOptions): Record<string, string> {
    return {
      'dev': 'tsx watch src/app.ts',
      'generate': 'oa-gen generate',
      'mock': 'oa-gen mock --watch',
    }
  }

  getRecommendedDependencies(_options: TargetGenerateOptions): RecommendedDependencies {
    return {
      dependencies: {
        'express': '^4.19.0',
      },
      devDependencies: {
        '@types/express': '^4.17.21',
        'tsx': '^4.7.0',
        '@types/node': '^22.0.0',
      },
      oaSdkDevDependencies: ['@oa-sdk/codegen', '@oa-sdk/router'],
    }
  }
}
