import Ajv2020 from 'ajv/dist/2020.js'
import { readFileSync } from 'node:fs'

const artifactSchema = readSchema('oa-sdk.logical-erd.v1.schema.json')
const reviewSchema = readSchema('oa-sdk.logical-erd-review.v1.schema.json')

type CompiledSchema = {
  (value: unknown): boolean
  errors?: readonly {
    instancePath: string
    keyword: string
    message?: string
  }[] | null
}

type Ajv2020Constructor = new (options: { allErrors: boolean; strict: boolean }) => {
  compile(value: Record<string, unknown>): CompiledSchema
}

// Ajv publishes this ESM entrypoint with a CommonJS-shaped declaration. The
// constructor is present at runtime; narrow it here without enabling synthetic
// default imports for the whole monorepo.
const Ajv2020Runtime = Ajv2020 as unknown as Ajv2020Constructor
const ajv = new Ajv2020Runtime({ allErrors: true, strict: false })
const validateArtifact = ajv.compile(artifactSchema)
const validateReview = ajv.compile(reviewSchema)

export type LogicalErdSchemaIssue = {
  instancePath: string
  keyword: string
  message: string
}

/** Validate the portable v1 wire shape; use semantic validation for cross-reference invariants. */
export function validateLogicalErdArtifactSchema(value: unknown): LogicalErdSchemaIssue[] {
  return collectIssues(validateArtifact, value)
}

/** Validate the portable review-only envelope emitted by `oa-erd review`. */
export function validateLogicalErdReviewSchema(value: unknown): LogicalErdSchemaIssue[] {
  return collectIssues(validateReview, value)
}

function collectIssues(validate: CompiledSchema, value: unknown): LogicalErdSchemaIssue[] {
  if (validate(value)) return []
  return (validate.errors ?? []).map(error => ({
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? 'schema validation failed',
  }))
}

function readSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>
}
