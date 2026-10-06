import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type {
  ArchetypeProfile,
  ArchetypeGenerateOptions,
  ArchetypeDetectionResult,
  ArchetypeConfigSnippet,
  LifecycleArchetypeId,
  ContractBaselinePlan,
  ContractBaselineSkip,
} from './types.js'
import type { RecommendedDependencies } from '../types.js'
import type { OaConfig } from '../../../../config.js'
import {
  CONTRACT_BASELINE_PATH,
  isContractBaselineSkip,
  isSpecDocumentPath,
} from '../common/contract-baseline.js'
import { oaGenScript, schemaEntryOf, scriptPath } from '../common/scripts.js'

export class EnterpriseArchetypeProfile implements ArchetypeProfile {
  readonly id: LifecycleArchetypeId = 'enterprise'
  readonly name = 'Enterprise'
  readonly displayName = 'Enterprise'
  readonly description = 'Breaking change CI gate against a committed contract baseline (oa-gen diff --fail-on-breaking), OpenAPI 3.2 validation, strict spec linting, persona coverage settings (@oa-sdk/personas)'
  readonly summaryBullet = 'Breaking change gate, strict linting, personas'

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

  /**
   * The gate scripts, on the spec entry point: `lint:spec` lints it, `diff` fails on a change
   * that breaks clients of the contract baseline, `baseline:update` makes the spec the baseline,
   * and `ci:gate` runs `oa-gen validate --require-32`, the lint and the diff. They need a spec
   * that `oa-gen lint`/`diff` load (OpenAPI YAML/JSON or TypeSpec); without one the archetype adds
   * none (see `getContractBaseline`).
   */
  getRecommendedScripts(options: ArchetypeGenerateOptions): Record<string, string> {
    const baseline = this.getContractBaseline(options)
    if (isContractBaselineSkip(baseline)) return {}

    const spec = scriptPath(baseline.specPath)
    const lint = oaGenScript(options.runtime, ['lint', '--spec', spec])
    const diff = oaGenScript(options.runtime, ['diff', '--base', baseline.path, '--head', spec, '--fail-on-breaking'])
    const validate = oaGenScript(options.runtime, ['validate', '--spec', spec, '--require-32'])
    return {
      'lint:spec': lint,
      'diff': diff,
      'baseline:update': oaGenScript(options.runtime, ['normalize', '--spec', spec, '--output', baseline.path]),
      'ci:gate': [validate, lint, diff].join(' && '),
    }
  }

  getContractBaseline(options: ArchetypeGenerateOptions): ContractBaselinePlan | ContractBaselineSkip {
    if (options.specEntryUnavailable !== undefined) {
      return { path: CONTRACT_BASELINE_PATH, status: 'no-gate', reason: options.specEntryUnavailable }
    }
    const specPath = schemaEntryOf(options)
    if (!isSpecDocumentPath(specPath)) {
      return {
        path: CONTRACT_BASELINE_PATH,
        status: 'no-gate',
        reason: `the spec entry point ${specPath} is not an OpenAPI YAML/JSON document or a TypeSpec entry point, which oa-gen lint and diff read`,
      }
    }
    return { path: CONTRACT_BASELINE_PATH, specPath }
  }

  getRecommendedDependencies(_options: ArchetypeGenerateOptions): RecommendedDependencies {
    return {
      devDependencies: {},
      oaSdkDevDependencies: ['@oa-sdk/personas', '@oa-sdk/core'],
    }
  }
}
