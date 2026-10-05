/**
 * Imports the public entry points of packed packages the way a consumer does,
 * for the public runtime smoke (scripts/public-runtime-smoke.mjs) and the
 * release exporter's consumer smoke (scripts/export-release-artifacts.ts).
 *
 * A bare specifier resolves from the module that imports it, so the import
 * has to run in a module inside the consumer directory: `consumerProbeSource`
 * writes that module, which hands its own `import()` to `runConsumerProbe`.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The package a module-not-found `error` says cannot be found, or `undefined`
 * when `error` is another failure or names a file (a package installed without
 * the file, which is a broken package, not a missing one).
 */
export function missingPackageName(error) {
  if (typeof error !== 'object' || error === null) return undefined
  const { code, message } = error
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return undefined
  const match = /Cannot find (?:package|module) '([^']+)'/.exec(String(message))
  if (!match) return undefined
  const segments = match[1].split('/')
  const name = match[1].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  return /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name) ? name : undefined
}

/**
 * Imports public entry points and returns what went wrong, in order.
 *
 * - `imports`: specifiers that must import, each with runtime exports.
 * - `withoutOptionalPeers`: entry points declared to need optional peers
 *   (`{ specifier, peers }`), imported where those peers may be absent. While
 *   one of its peers is not installed (`isInstalled`), an entry point must fail
 *   for the absence of such a peer, so that a declaration that is no longer
 *   needed, or an entry point that needs more than it declares, is reported.
 *   With all of them installed it must import.
 */
export async function probePublicImports({ imports = [], withoutOptionalPeers = [] }, { importModule, isInstalled }) {
  const issues = []
  for (const specifier of imports) {
    try {
      const surface = await importModule(specifier)
      if (Object.keys(surface).length === 0) issues.push(`${specifier} has no runtime exports`)
    } catch (error) {
      const missing = missingPackageName(error)
      issues.push(missing === undefined
        ? `${specifier} failed to import: ${describeError(error)}`
        : `${specifier} cannot be imported without ${missing}, which a consumer does not get with it ` +
          '(an optional peer, or a package it does not declare): make it a dependency or a required peer, ' +
          'or import it only from subpaths that docs/internal/release-policy.json declares under optionalPeerEntryPoints')
    }
  }
  for (const { specifier, peers } of withoutOptionalPeers) {
    const absent = peers.filter(peer => !isInstalled(peer))
    try {
      await importModule(specifier)
      if (absent.length > 0) {
        issues.push(
          `${specifier} imports without ${absent.join(', ')}; ` +
            'remove that peer from its optionalPeerEntryPoints declaration in docs/internal/release-policy.json',
        )
      }
    } catch (error) {
      const missing = missingPackageName(error)
      if (missing === undefined || !absent.includes(missing)) {
        issues.push(
          `${specifier} failed to import for a reason other than its declared optional peers ` +
            `(${peers.join(', ')}): ${describeError(error)}`,
        )
      }
    }
  }
  return issues
}

/**
 * Source of a probe module to write into a consumer directory: it runs `plan`
 * (see `probePublicImports`) there, with its own `import()`.
 */
export function consumerProbeSource(plan) {
  return (
    `import { runConsumerProbe } from ${JSON.stringify(import.meta.url)}\n` +
    `await runConsumerProbe(${JSON.stringify(plan)}, specifier => import(specifier), new URL('./', import.meta.url))\n`
  )
}

/** Runs `plan` in the consumer directory at `consumerUrl`; a failed probe prints why and sets the exit code. */
export async function runConsumerProbe(plan, importModule, consumerUrl) {
  const consumerDirectory = fileURLToPath(consumerUrl)
  const isInstalled = name => existsSync(new URL(`node_modules/${name}/package.json`, consumerUrl))
  const issues = await probePublicImports(plan, { importModule, isInstalled })
  if (issues.length > 0) {
    console.error(`Public import probe failed in ${consumerDirectory}:`)
    for (const issue of issues) console.error(`- ${issue}`)
    process.exitCode = 1
    return
  }
  const withoutPeers = plan.withoutOptionalPeers?.length
    ? `; ${plan.withoutOptionalPeers.length} that need optional peers checked without them`
    : ''
  console.log(`Imported ${plan.imports?.length ?? 0} public root/subpath surfaces${withoutPeers}.`)
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
