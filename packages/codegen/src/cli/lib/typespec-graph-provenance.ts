import { z } from 'zod'
import type { TypeSpecGraphProvenance } from '../../typegen/typespec-graph-semantic.js'

/**
 * Validates the fields of `oa-sdk.typespec-ref-provenance.v1` that the graph
 * semantic index reads. Every other field is kept, so the parsed value hashes
 * like the artifact it was read from.
 */
export const typeSpecGraphProvenanceSchema = z.looseObject({
  schemaVersion: z.literal('oa-sdk.typespec-ref-provenance.v1'),
  inputs: z.looseObject({
    restoredOpenApiSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  declarations: z.array(z.looseObject({
    id: z.string().min(1),
    source: z.looseObject({
      file: z.string().min(1),
      start: z.looseObject({
        line: z.number().int().positive(),
        column: z.number().int().nonnegative(),
      }),
    }),
  })),
  edges: z.array(z.looseObject({
    kind: z.enum(['emits', 'restores', 'references']),
    declarationId: z.string().min(1),
    outputPointer: z.string(),
  })),
})

// A schema that accepts values the semantic index cannot read fails to compile here.
type AssertAssignable<T extends TypeSpecGraphProvenance> = T
export type ValidatedTypeSpecGraphProvenance = AssertAssignable<z.infer<typeof typeSpecGraphProvenanceSchema>>
