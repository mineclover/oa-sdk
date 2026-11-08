/** S4 envelope decision pass. S3 records explicit discriminator envelope facts; this pass resolves them. */
import type { PyTypeExpr } from '../ir.js'
import type { PyPass } from './index.js'
import { cloneIr, mapDeclTypes } from './lib/ir-utils.js'

export const envelopePass: PyPass<never> = {
  name: 'envelopes',
  reads: [],
  run(ir, options, analysis) {
    void options
    void analysis
    const result = cloneIr(ir)
    const map = (type: PyTypeExpr): PyTypeExpr => {
      if (type.kind !== 'union' || type.envelope === undefined) return type
      return { ...type, discriminator: type.envelope.discriminator, envelope: { ...type.envelope, decision: 'envelope' } }
    }
    result.decls = result.decls.map(decl => mapDeclTypes(decl, map))
    const targets = new Set(result.decls.flatMap(decl => decl.kind === 'alias' && decl.type.kind === 'union' && decl.type.envelope?.decision === 'envelope'
      ? decl.type.envelope.variants.map(variant => variant.target) : []))
    for (const decl of result.decls) {
      if (decl.kind === 'model' && decl.envelopeVariant === null) decl.envelopeVariant = targets.has(decl.name)
    }
    return result
  },
}
