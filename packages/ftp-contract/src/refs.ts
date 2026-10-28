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
