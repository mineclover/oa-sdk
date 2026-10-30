import type { ExactRefV1 } from './types.js'

/** Package-relative path of the canonical declaration bytes. */
export const RUN_EVIDENCE_V1_SCHEMA_PATH = 'schema/oa-sdk.ftp.run-evidence.v1.schema.json'

/**
 * SHA-256 of the exact bytes at {@link RUN_EVIDENCE_V1_SCHEMA_PATH}. Any byte
 * change requires a new declaration revision, never an in-place edit.
 */
export const RUN_EVIDENCE_V1_SCHEMA_SHA256 = '43463a82c21255b22023ebc3efb5f7f7536aa674fc2159cad3f4f3693b44f6ca'

/** Exact reference of the RunEvidence exchange declaration owned by oa-sdk. */
export const RUN_EVIDENCE_V1_DECLARATION: ExactRefV1 = Object.freeze({
  kind: 'schema-declaration',
  namespace: 'oa-sdk.ftp',
  id: 'run-evidence',
  revision: '1',
})

/** Exact reference of the mapping from declaration fields to FTP semantic roles. */
export const RUN_EVIDENCE_V1_FTP_MAPPING_REF: ExactRefV1 = Object.freeze({
  kind: 'semantic-mapping',
  namespace: 'oa-sdk.ftp',
  id: 'run-evidence.ftp-core',
  revision: '1',
})

/** FTP semantic contract and profile revisions the mapping was reviewed against. */
export const RUN_EVIDENCE_V1_FTP_TARGET = Object.freeze({
  contract: Object.freeze({ path: 'docs/portable-contract-v0.1.md', revision: '0.1' }),
  profiles: Object.freeze([
    Object.freeze({ id: 'core', revision: '0.1' }),
    Object.freeze({ id: 'request-lifecycle', revision: '0.1' }),
  ]),
})

export const TEST_DEFINITION_V1_SCHEMA_PATH = 'schema/oa-sdk.ftp.test-definition.v1.schema.json'
export const TEST_DEFINITION_V1_SCHEMA_SHA256 = 'fc7220d7ae363affc6c90c82b04f045092c8e905deacf760d9af7d1df31324ff'
export const TEST_DEFINITION_V1_DECLARATION: ExactRefV1 = Object.freeze({ kind: 'schema-declaration', namespace: 'oa-sdk.ftp', id: 'test-definition', revision: '1' })
export const TEST_DEFINITION_V1_FTP_MAPPING_REF: ExactRefV1 = Object.freeze({ kind: 'semantic-mapping', namespace: 'oa-sdk.ftp', id: 'test-definition.ftp-core', revision: '1' })

export const LOCKED_PLAN_V1_SCHEMA_PATH = 'schema/oa-sdk.ftp.locked-plan.v1.schema.json'
export const LOCKED_PLAN_V1_SCHEMA_SHA256 = '274f382171fadb244d9cc809bad9eb3bba9e1bb24d19006cc7b372dd070b267f'
export const LOCKED_PLAN_V1_DECLARATION: ExactRefV1 = Object.freeze({ kind: 'schema-declaration', namespace: 'oa-sdk.ftp', id: 'locked-plan', revision: '1' })
export const LOCKED_PLAN_V1_FTP_MAPPING_REF: ExactRefV1 = Object.freeze({ kind: 'semantic-mapping', namespace: 'oa-sdk.ftp', id: 'locked-plan.ftp-core', revision: '1' })

export const EVALUATION_V1_SCHEMA_PATH = 'schema/oa-sdk.ftp.evaluation.v1.schema.json'
export const EVALUATION_V1_SCHEMA_SHA256 = '08edcf1ab5fce3ff4e80b4c9f0bc016fdb0a3d3257d03738e670310945672645'
export const EVALUATION_V1_DECLARATION: ExactRefV1 = Object.freeze({ kind: 'schema-declaration', namespace: 'oa-sdk.ftp', id: 'evaluation', revision: '1' })
export const EVALUATION_V1_FTP_MAPPING_REF: ExactRefV1 = Object.freeze({ kind: 'semantic-mapping', namespace: 'oa-sdk.ftp', id: 'evaluation.ftp-core', revision: '1' })
