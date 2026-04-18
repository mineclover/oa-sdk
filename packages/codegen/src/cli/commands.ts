import type { Command } from './lib/types.js'
import { typegen } from './commands/typegen.js'
import { router } from './commands/router.js'
import { client } from './commands/client.js'
import { generate } from './commands/generate.js'
import { lint } from './commands/lint.js'
import { validate } from './commands/validate.js'
import { dev } from './commands/dev.js'
import { buildSpecCommand } from './commands/build-spec.js'
import { review } from './commands/review.js'
import { diff } from './commands/diff.js'
import { checkArtifact } from './commands/check-artifact.js'
import { drift } from './commands/drift.js'

export const commands: Command[] = [
  generate,
  typegen,
  router,
  client,
  buildSpecCommand,
  dev,
  lint,
  validate,
  diff,
  checkArtifact,
  drift,
  review,
]
