import type {
  TargetProfile,
  TargetDetectionResult,
  TargetGenerateOptions,
  RecommendedDependencies,
} from '../types.js'

export class GenericTargetProfile implements TargetProfile {
  readonly id = 'generic' as const
  readonly displayName = 'Generic / Standalone'
  readonly description = 'Framework-agnostic handler contract & schema validation'
  readonly defaultRuntime = 'node' as const

  async detect(_cwd: string): Promise<TargetDetectionResult> {
    return {
      confidence: 0.1,
      matchedMarkers: ['fallback'],
      detectedRuntime: 'node',
    }
  }

  async generateConfig(options: TargetGenerateOptions): Promise<string> {
    const schemaEntry = options.detectedSchema?.filePath ?? 'openapi.yaml'
    return `import { defineConfig } from '@oa-sdk/codegen'

export default defineConfig({
  rootDir: '.',
  specs: [
    {
      id: 'api-contract',
      schemaEntry: '${schemaEntry}',
      outDir: './src/generated',
    },
  ],
})
`
  }

  getRecommendedScripts(_options: TargetGenerateOptions): Record<string, string> {
    return {
      'generate': 'oa-gen generate',
      'mock': 'oa-gen mock --watch',
    }
  }

  getRecommendedDependencies(_options: TargetGenerateOptions): RecommendedDependencies {
    return {
      devDependencies: {},
      oaSdkDevDependencies: ['@oa-sdk/codegen'],
    }
  }
}
