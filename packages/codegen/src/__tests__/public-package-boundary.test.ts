import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commands } from '../cli/commands.js'

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
) as Record<string, Record<string, string> | undefined>

const PRIVATE_DOWNSTREAM_PACKAGES = [
  '@oa-sdk/client',
  '@oa-sdk/router',
  '@oa-sdk/schemas',
] as const

describe('public @oa-sdk/codegen boundary', () => {
  it('does not advertise private downstream commands', () => {
    const names = commands.map(command => command.name)
    expect(names).not.toEqual(expect.arrayContaining(['router', 'client', 'dev']))
  })

  it('does not declare private workspace packages in its runtime package graph', () => {
    for (const section of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ] as const) {
      const dependencies = packageJson[section] ?? {}
      for (const packageName of PRIVATE_DOWNSTREAM_PACKAGES) {
        expect(dependencies, `${section} contains ${packageName}`).not.toHaveProperty(packageName)
      }
    }
  })
})
