import {
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_PLAN_STALE_REASONS,
} from '../../src/index.js'
import type { GatewayTaxonomyProjectionCase } from './gateway-schema-lookup.js'

export const compiledPlanTaxonomyProjectionCases = [
  ['DpmCompiledPlan', ['properties', 'planVersion', 'enum'], DPM_COMPILED_PLAN_VERSIONS],
  ['DpmCompiledPlan', ['properties', 'staleReasons', 'items', 'enum'], DPM_PLAN_STALE_REASONS],
] as const satisfies readonly GatewayTaxonomyProjectionCase[]
