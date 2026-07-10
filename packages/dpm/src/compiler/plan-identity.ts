import {
  DPM_DEFAULT_CANONICAL_KEY_ENCODING_VERSION,
  type DpmCanonicalKeyEncodingVersion,
} from '../model/canonical-key-encoding.js'
import { frameWellFormedUtf8 } from '../model/utf8-frame.js'

export function createDpmCompiledPlanIdentity(input: {
  manifestId: string
  registryVersion: string
  canonicalKeyEncodingVersion: DpmCanonicalKeyEncodingVersion
}): string {
  const legacyIdentity = `compiled-plan:${input.manifestId}:${input.registryVersion}`
  return input.canonicalKeyEncodingVersion === DPM_DEFAULT_CANONICAL_KEY_ENCODING_VERSION
    ? legacyIdentity
    : 'dpm.compiled-plan.typed-v2'
      + `|m|${frameWellFormedUtf8(input.manifestId, 'compiled plan manifestId')}`
      + `|r|${frameWellFormedUtf8(input.registryVersion, 'compiled plan registryVersion')}`
}
