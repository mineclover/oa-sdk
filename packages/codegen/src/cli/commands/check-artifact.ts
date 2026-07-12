import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { optStr, str } from '../lib/args.js'
import { loadOpenApiOrTarget } from '../lib/target-openapi.js'
import { createArtifactReview } from '../lib/artifact-review.js'
import {
  formatOpenApiDiff,
} from '../lib/openapi-normalized-diff.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'
import { CliExitError } from '../lib/errors.js'

type OutputFormat = 'human' | 'json'

const checkArtifactSpec = commandById(oaGenGovernanceManifest, 'check-artifact')

export const checkArtifact: Command = {
  name: checkArtifactSpec.name,
  description: checkArtifactSpec.summary,
  options: {
    head: {
      type: 'string',
      required: true,
      description: optionDescription(checkArtifactSpec, 'head'),
    },
    artifact: {
      type: 'string',
      required: true,
      description: optionDescription(checkArtifactSpec, 'artifact'),
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(checkArtifactSpec, 'format'),
    },
    target: {
      type: 'string',
      description: optionDescription(checkArtifactSpec, 'target'),
    },
    fragments: {
      type: 'string',
      description: optionDescription(checkArtifactSpec, 'fragments'),
    },
  },
  async run(args) {
    const targetPath = optStr(args, 'target')
    const fragmentsDir = optStr(args, 'fragments')
    const head = loadOpenApiOrTarget({
      specPath: str(args, 'head'),
      ...(targetPath ? { targetPath } : {}),
      ...(fragmentsDir ? { fragmentsDir } : {}),
    })
    const artifact = loadSpecWithPath(str(args, 'artifact'))
    const payload = createArtifactReview({
      headDocument: head.document,
      artifactPath: artifact.path,
      artifactDocument: artifact.document,
    })
    const format = readFormat(optStr(args, 'format'))

    if (format === 'json') {
      console.log(JSON.stringify(payload, null, 2))
    } else if (payload.fresh) {
      console.log(`fresh ${payload.artifact} - ${payload.summary}`)
    } else {
      console.log(`stale ${payload.artifact} - ${payload.summary}`)
      console.log(formatOpenApiDiff(payload.differences))
    }

    if (!payload.fresh) throw new CliExitError(1)
  },
}

function readFormat(format: string | undefined): OutputFormat {
  if (format === undefined) return 'human'
  if (format === 'human' || format === 'json') return format
  throw new Error(`unsupported artifact check format: ${format}`)
}
