import type {
  OpenApiProjectionProfile,
} from '@oa-sdk/openapi-projection-contract'

export type CatalogSnapshotSource =
  | {
      kind: 'postgresql'
      database: string
      capturedAt?: string
    }
  | {
      /** Read-only structural snapshot captured from a Cloudflare D1 database. */
      kind: 'cloudflare_d1'
      database: string
      databaseId?: string
      accountId?: string
      capturedAt?: string
    }
  | {
      kind: 'openapi_projection'
      profile: OpenApiProjectionProfile
      projectionVersionHash: string
      projectionRef?: string
    }
