import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type {
  ArchetypeProfile,
  ArchetypeGenerateOptions,
  ArchetypeDetectionResult,
  ArchetypeConfigSnippet,
  LifecycleArchetypeId,
} from './types.js'
import type { RecommendedDependencies } from '../types.js'
import type { OaConfig } from '../../../../config.js'

export class MvpArchetypeProfile implements ArchetypeProfile {
  readonly id: LifecycleArchetypeId = 'mvp'
  readonly name = 'MVP'
  readonly displayName = 'MVP'
  readonly description = 'Rapid iteration, live mock-first (mock --watch), client SDK emission, lightweight validation'
  readonly summaryBullet = 'Rapid iteration, live mock-first, client SDK'

  async detect(cwd: string): Promise<ArchetypeDetectionResult> {
    const matchedMarkers: string[] = []
    let confidence = 0.5

    try {
      const pkgPath = path.join(cwd, 'package.json')
      const raw = await fs.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      if (typeof pkg.version === 'string' && (pkg.version.startsWith('0.0.') || pkg.version.startsWith('0.1.'))) {
        matchedMarkers.push(`early package version: ${pkg.version}`)
        confidence += 0.15
      }
    } catch {
      // ignore
    }

    try {
      const ciDir = path.join(cwd, '.github', 'workflows')
      const hasCi = await fs.access(ciDir).then(() => true).catch(() => false)
      if (!hasCi) {
        matchedMarkers.push('no CI workflows detected')
        confidence += 0.1
      }
    } catch {
      // ignore
    }

    return {
      confidence: Math.min(1.0, confidence),
      matchedMarkers,
    }
  }

  getArchetypeConfig(_options: ArchetypeGenerateOptions): ArchetypeConfigSnippet {
    return {
      rootFields: {
        archetype: 'mvp',
        client: {
          outDir: './src/client',
        },
        mock: {
          port: 4010,
          watch: true,
        },
      },
      specFields: {
        strictValidation: false,
      },
    }
  }

  generateConfigFragment(options: ArchetypeGenerateOptions): Partial<OaConfig> {
    return {
      archetype: 'mvp',
      core: {
        dialect: { oasVersion: '3.2.0', jsonSchemaDialect: 'draft-2020-12', canonicalProjection: true },
        contracts: { pureHandlers: true, contractName: 'ApiHandlers', banner: true },
        client: { enabled: true, wireFormatSafety: false, outDir: './src/client' },
        typegen: { resolveSymbolCycles: false, discriminatedUnions: true },
        gates: { driftCheck: false, failOnBreaking: false, preflightLint: 'warn' },
      },
      product: {
        archetype: 'mvp',
        framework: options.frameworkId,
        runtime: options.runtime,
        jitSchema: false,
        zeroCopy: false,
      },
    }
  }

  getRecommendedScripts(options: ArchetypeGenerateOptions): Record<string, string> {
    if (options.runtime === 'bun') {
      return {
        'mock': 'bun x oa-gen mock --watch',
        'generate:client': 'bun x oa-gen generate --target client',
        'validate': 'bun x oa-gen validate',
      }
    }

    return {
      'mock': 'oa-gen mock --watch',
      'generate:client': 'oa-gen generate --target client',
      'validate': 'oa-gen validate',
    }
  }

  getRecommendedDependencies(_options: ArchetypeGenerateOptions): RecommendedDependencies {
    return {
      devDependencies: {},
      oaSdkDevDependencies: ['@oa-sdk/client', '@oa-sdk/mock-server'],
    }
  }
}
