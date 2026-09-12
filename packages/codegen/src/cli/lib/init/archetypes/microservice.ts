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

export class MicroserviceArchetypeProfile implements ArchetypeProfile {
  readonly id: LifecycleArchetypeId = 'microservice'
  readonly name = 'Microservice'
  readonly displayName = 'Microservice'
  readonly description = 'High-throughput runtime optimization (Fastify JIT / Bun Elysia zero-copy), strict wire typing (JsonPrimitive<T>), pure handler contracts (*.contract.ts), automated contract tests'
  readonly summaryBullet = 'High throughput, strict wire typing, contract tests'

  async detect(cwd: string): Promise<ArchetypeDetectionResult> {
    const matchedMarkers: string[] = []
    let confidence = 0.4

    const dockerfile = await fs.access(path.join(cwd, 'Dockerfile')).then(() => true).catch(() => false)
    if (dockerfile) {
      matchedMarkers.push('Dockerfile detected')
      confidence += 0.25
    }

    const compose =
      (await fs.access(path.join(cwd, 'docker-compose.yml')).then(() => true).catch(() => false)) ||
      (await fs.access(path.join(cwd, 'docker-compose.yaml')).then(() => true).catch(() => false))
    if (compose) {
      matchedMarkers.push('docker-compose detected')
      confidence += 0.15
    }

    const k8s =
      (await fs.access(path.join(cwd, 'k8s')).then(() => true).catch(() => false)) ||
      (await fs.access(path.join(cwd, 'helm')).then(() => true).catch(() => false))
    if (k8s) {
      matchedMarkers.push('k8s/helm manifests detected')
      confidence += 0.2
    }

    return {
      confidence: Math.min(1.0, confidence),
      matchedMarkers,
    }
  }

  getArchetypeConfig(options: ArchetypeGenerateOptions): ArchetypeConfigSnippet {
    return {
      rootFields: {
        archetype: 'microservice',
        contracts: {
          outDir: './src/contracts',
          wireSafe: true,
        },
      },
      specFields: {
        target: options.frameworkId,
      },
    }
  }

  generateConfigFragment(options: ArchetypeGenerateOptions): Partial<OaConfig> {
    return {
      archetype: 'microservice',
      core: {
        dialect: { oasVersion: '3.2.0', jsonSchemaDialect: 'draft-2020-12', canonicalProjection: true },
        contracts: { pureHandlers: true, contractName: 'ApiHandlers', banner: true, outDir: './src/contracts' },
        client: { enabled: true, wireFormatSafety: true },
        typegen: { resolveSymbolCycles: true, discriminatedUnions: true },
        gates: { driftCheck: true, failOnBreaking: false, preflightLint: 'error' },
      },
      product: {
        archetype: 'microservice',
        framework: options.frameworkId,
        runtime: options.runtime,
        jitSchema: true,
        zeroCopy: true,
      },
    }
  }

  getRecommendedScripts(options: ArchetypeGenerateOptions): Record<string, string> {
    if (options.runtime === 'bun') {
      return {
        'generate:contract': 'bun x oa-gen generate --target generic',
        'test:contract': 'bun test src/__tests__/contracts',
        'audit:wire': 'bun x oa-gen audit:shape --strict',
        'mock': 'bun x oa-gen mock --watch',
      }
    }

    return {
      'generate:contract': 'oa-gen generate --target generic',
      'test:contract': 'vitest run src/__tests__/contracts',
      'audit:wire': 'oa-gen audit:shape --strict',
      'mock': 'oa-gen mock --watch',
    }
  }

  getRecommendedDependencies(options: ArchetypeGenerateOptions): RecommendedDependencies {
    if (options.runtime === 'bun') {
      return {
        devDependencies: {
          '@oa-sdk/core': 'workspace:*',
          '@oa-sdk/router': 'workspace:*',
        },
      }
    }

    return {
      devDependencies: {
        '@oa-sdk/core': 'workspace:*',
        '@oa-sdk/router': 'workspace:*',
        'vitest': '^1.6.0',
      },
    }
  }
}
