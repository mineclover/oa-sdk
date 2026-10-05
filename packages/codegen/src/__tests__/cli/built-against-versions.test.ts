import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILT_AGAINST_VERSIONS, builtAgainstRange } from '../../cli/lib/built-against-versions.js'
import { COMPANION_PACKAGES } from '../../cli/lib/companion-packages.js'

describe('versions this build was built against', () => {
  const packageDirectory = path.resolve(__dirname, '../../..')
  const readVersion = (manifestPath: string): string =>
    (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { version: string }).version
  const linkedVersion = (name: string): string =>
    readVersion(path.join(packageDirectory, 'node_modules', name, 'package.json'))

  it('are the versions of the linked companion packages, which the tests and the build run against', () => {
    for (const name of COMPANION_PACKAGES) {
      expect(BUILT_AGAINST_VERSIONS[name], name).toBe(linkedVersion(name))
      expect(builtAgainstRange(name), name).toBe(`^${linkedVersion(name)}`)
    }
  })

  it('include the version of codegen itself', () => {
    const version = readVersion(path.join(packageDirectory, 'package.json'))
    expect(BUILT_AGAINST_VERSIONS['@oa-sdk/codegen']).toBe(version)
    expect(builtAgainstRange('@oa-sdk/codegen')).toBe(`^${version}`)
  })

  it('are unknown for a package the build did not embed', () => {
    expect(builtAgainstRange('@oa-sdk/not-a-companion')).toBeUndefined()
    expect(builtAgainstRange('@oa-sdk/client', {})).toBeUndefined()
  })
})
