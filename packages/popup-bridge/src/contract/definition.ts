import { PROTOCOL_VERSION, assertVersionRange } from '../protocol/version.js'
import type { AnyContract } from './define.js'

export type CapabilityRequirement = {
  name: string
  versionRange: string
}

/**
 * The host-facing public definition of a popup: where it lives and what the host needs from it.
 * The URL and the feature contract are separate, so one contract can be served from several
 * origins and one popup can be replaced by another implementation of the same contract.
 */
export interface PopupDefinition<C extends AnyContract = AnyContract> {
  id: string
  url: string
  /** Exact origin messages must come from, e.g. `https://tools.example.com`. */
  expectedOrigin: string
  protocolVersions: string[]
  requiredCapabilities: CapabilityRequirement[]
  /** Static types and schemas; absent for an untyped definition. */
  contract?: C
}

export type DefinePopupOptions = {
  url: string
  /** Defaults to the origin of `url`. Set it when the page legitimately redirects to another origin. */
  expectedOrigin?: string
  protocolVersions?: string[]
  /**
   * Capabilities the popup must advertise. Defaults to every contract method at `^<version>`;
   * pass a narrower list when the host only uses part of the contract.
   */
  requiredCapabilities?: CapabilityRequirement[]
}

function toOrigin(value: string, subject: string): string {
  const origin = new URL(value).origin
  if (origin === 'null') throw new TypeError(`${subject} "${value}" has an opaque origin`)
  return origin
}

export function definePopup<C extends AnyContract>(contract: C, options: DefinePopupOptions): PopupDefinition<C> & { contract: C } {
  const expectedOrigin = options.expectedOrigin === undefined ? toOrigin(options.url, 'url') : toOrigin(options.expectedOrigin, 'expectedOrigin')
  if (options.expectedOrigin !== undefined && options.expectedOrigin !== expectedOrigin) {
    throw new TypeError(`expectedOrigin must be a bare origin such as "${expectedOrigin}", got "${options.expectedOrigin}"`)
  }
  const requiredCapabilities =
    options.requiredCapabilities ??
    Object.entries(contract.methods).map(([name, spec]) => ({ name, versionRange: `^${spec.version}` }))
  for (const requirement of requiredCapabilities) assertVersionRange(requirement.versionRange)
  return {
    id: contract.id,
    url: options.url,
    expectedOrigin,
    protocolVersions: options.protocolVersions ?? [PROTOCOL_VERSION],
    requiredCapabilities,
    contract,
  }
}
