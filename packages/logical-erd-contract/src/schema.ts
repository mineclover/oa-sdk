import { Ajv2020 } from 'ajv/dist/2020.js'
import { readFileSync } from 'node:fs'

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A bundled JSON Schema document must be a JSON object before Ajv compiles it. */
const SchemaDocument = {
  parse(value: unknown): Record<string, unknown> {
    if (!isJsonObject(value)) throw new TypeError('Bundled logical ERD schema must be a JSON object')
    return value
  },
}

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

// Ajv's CommonJS entrypoint assigns `exports.Ajv2020`, which Node exposes as a
// named ESM export, so no synthetic default import is needed.
const ajv = new Ajv2020({ allErrors: true, strict: false })
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
  return SchemaDocument.parse(JSON.parse(readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8')))
}
