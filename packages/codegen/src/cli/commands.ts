import type { Command } from './lib/types.js'
import { typegen } from './commands/typegen.js'
import { generate } from './commands/generate.js'
import { lint } from './commands/lint.js'
import { validate } from './commands/validate.js'
import { buildSpecCommand } from './commands/build-spec.js'
import { review } from './commands/review.js'
import { diff } from './commands/diff.js'
import { checkArtifact, driftCheck } from './commands/check-artifact.js'
import { drift } from './commands/drift.js'
import { inventory } from './commands/inventory.js'
import { normalize } from './commands/normalize.js'
import { upgrade } from './commands/upgrade.js'
import { collect } from './commands/collect.js'
import { scaffoldGovernance } from './commands/scaffold-governance.js'
import { behaviorQuery } from './commands/behavior-query.js'
import { duplicateReview } from './commands/duplicate-review.js'
import { targetCheck } from './commands/target-check.js'
import { reviewBundle } from './commands/review-bundle.js'
import { tspExport } from './commands/tsp-export.js'
import { tspRestore } from './commands/tsp-restore.js'
import { tspBundleCheck } from './commands/tsp-bundle-check.js'
import { tspScaffold } from './commands/tsp-scaffold.js'
import { referenceCheck } from './commands/reference-check.js'
import { parallelEvidence } from './commands/parallel-evidence.js'
import { auditCsp } from './commands/audit-csp.js'
import { generateZod } from './commands/generate-zod.js'
import { tspDiff } from './commands/tsp-diff.js'
import { mock } from './commands/mock.js'
import { auditShapeCommand } from './commands/audit-shape.js'

export const commands: Command[] = [
  generateZod,
  generate,
  typegen,
  buildSpecCommand,
  lint,
  validate,
  normalize,
  upgrade,
  collect,
  tspExport,
  tspRestore,
  tspBundleCheck,
  tspScaffold,
  referenceCheck,
  scaffoldGovernance,
  inventory,
  behaviorQuery,
  duplicateReview,
  targetCheck,
  diff,
  checkArtifact,
  driftCheck,
  drift,
  review,
  reviewBundle,
  parallelEvidence,
  auditCsp,
  tspDiff,
  mock,
  auditShapeCommand,
]

export { generateZod, tspDiff, mock, auditShapeCommand }
