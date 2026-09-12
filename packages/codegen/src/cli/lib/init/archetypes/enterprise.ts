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

export class EnterpriseArchetypeProfile implements ArchetypeProfile {
  readonly id: LifecycleArchetypeId = 'enterprise'
  readonly name = 'Enterprise'
  readonly displayName = 'Enterprise'
  readonly description = 'Semantic breaking change CI gates (oa-gen diff --fail-on-breaking), persona capability traits (@oa-sdk/personas), multi-target bundle projections, strict preflight schema linting'
  readonly summaryBullet = 'CI drift defense, personas, strict linting'

  async detect(cwd: string): Promise<ArchetypeDetectionResult> {
    const matchedMarkers: string[] = []
    let confidence = 0.3

    const hasCi = await fs.access(path.join(cwd, '.github', 'workflows')).then(() => true).catch(() => false)
    if (hasCi) {
      matchedMarkers.push('.github/workflows CI detected')
      confidence += 0.25
    }

    const hasSkillYaml = await fs.access(path.join(cwd, 'skill.yaml')).then(() => true).catch(() => false)
    if (hasSkillYaml) {
      matchedMarkers.push('skill.yaml personas manifest detected')
      confidence += 0.3
    }

    const isMonorepo =
      (await fs.access(path.join(cwd, 'pnpm-workspace.yaml')).then(() => true).catch(() => false)) ||
      (await fs.access(path.join(cwd, 'turbo.json')).then(() => true).catch(() => false))
    if (isMonorepo) {
      matchedMarkers.push('monorepo workspace detected')
      confidence += 0.2
    }

    return {
      confidence: Math.min(1.0, confidence),
      matchedMarkers,
    }
  }

  getArchetypeConfig(_options: ArchetypeGenerateOptions): ArchetypeConfigSnippet {
    return {
      rootFields: {
        archetype: 'enterprise',
        governance: {
          failOnBreaking: true,
          require32: true,
          strictLint: true,
          lintCategories: ['structure', 'refs', 'components', 'semantics'],
        },
        personas: {
          enabled: true,
          traitsFile: 'skill.yaml',
        },
      },
      specFields: {
        profile: 'full-api-document',
      },
    }
  }

  generateConfigFragment(options: ArchetypeGenerateOptions): Partial<OaConfig> {
    return {
      archetype: 'enterprise',
      core: {
        dialect: { oasVersion: '3.2.0', jsonSchemaDialect: 'draft-2020-12', canonicalProjection: true },
        contracts: { pureHandlers: true, contractName: 'ApiHandlers', banner: true },
        client: { enabled: true, wireFormatSafety: true },
        typegen: { resolveSymbolCycles: true, discriminatedUnions: true },
        gates: { driftCheck: true, failOnBreaking: true, baseRef: 'origin/main', preflightLint: 'error' },
      },
      product: {
        archetype: 'enterprise',
        framework: options.frameworkId,
        runtime: options.runtime,
        jitSchema: true,
        zeroCopy: true,
        personas: { enforceCoverage: true, minCoverageRatio: 0.8 },
      },
    }
  }

  getRecommendedScripts(options: ArchetypeGenerateOptions): Record<string, string> {
    if (options.runtime === 'bun') {
      return {
        'diff': 'bun x oa-gen diff --base origin/main --head HEAD --fail-on-breaking',
        'lint:spec': 'bun x oa-gen lint --categories structure,refs,components,semantics',
        'audit:csp': 'bun x oa-gen audit:csp --bundle ./dist',
        'audit:shape': 'bun x oa-gen audit:shape --fail-on-unsupported',
        'personas:check': 'bun x oa-gen personas:check',
        'ci:gate': 'bun x oa-gen diff --base origin/main --fail-on-breaking && bun x oa-gen validate --require-32',
      }
    }

    return {
      'diff': 'oa-gen diff --base origin/main --head HEAD --fail-on-breaking',
      'lint:spec': 'oa-gen lint --categories structure,refs,components,semantics',
      'audit:csp': 'oa-gen audit:csp --bundle ./dist',
      'audit:shape': 'oa-gen audit:shape --fail-on-unsupported',
      'personas:check': 'oa-gen personas:check',
      'ci:gate': 'oa-gen diff --base origin/main --fail-on-breaking && oa-gen validate --require-32',
    }
  }

  getRecommendedDependencies(_options: ArchetypeGenerateOptions): RecommendedDependencies {
    return {
      devDependencies: {
        '@oa-sdk/personas': 'workspace:*',
        '@oa-sdk/core': 'workspace:*',
      },
    }
  }
}
